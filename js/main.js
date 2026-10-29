import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { registerAll } from 'crashcat';
import { MAX_SPEED } from './Vehicle.js';
import { Camera } from './Camera.js';
import { Controls } from './Controls.js';
import { buildTrack, computeTrackBounds, encodeCells } from './Track.js';
import { centerline } from './TrackPath.js';
import { resolveTrack, rememberTrack } from './Tracks.js';
import { Race, STEP } from './Race.js';
import { AIDriver, rng } from './AIDriver.js';
import { planField } from './Difficulty.js';
import { CARS, getCar } from './CarList.js';
import { SmokeTrails } from './Particles.js';
import { DriftMarks } from './DriftMarks.js';
import { GameAudio } from './Audio.js';
import { loadBest, saveBest } from './LapTimer.js';
import { Hud } from './Hud.js';
import { ColorMapGLTFLoader, colormapLoaded } from './Loader.js';
import { MODEL_URLS } from './Assets.js';
import { PRESETS, detectTier, loadSetting, saveSetting, loadAutoTier, saveAutoTier, lowerTier, FrameMonitor } from './Quality.js';
import { Shell, lockViewport } from './Shell.js';
import { Settings } from './Settings.js';
import { SunShadow } from './SunShadow.js';
import { setLambert } from './Materials.js';
import { Debris } from './Debris.js';

const params = new URLSearchParams( window.location.search );

// Playtest hooks (scripts/playtest): read-only state on window.__kerb, plus a
// frame-rate cap (?fps=30) and virtual frames per display frame (?frames=2
// renders like a 120Hz display) for checking frame-rate independence.
const PLAYTEST = params.has( 'playtest' );
const FPS_LIMIT = PLAYTEST ? Number( params.get( 'fps' ) ) || 0 : 0;
const VIRTUAL_FRAMES = PLAYTEST ? Math.max( 1, Number( params.get( 'frames' ) ) || 1 ) : 1;

lockViewport();

const settings = new Settings();
const track = resolveTrack( params );

// Classic keeps the best-lap / drift-mark storage key it always had
const trackKey = track.id === 'classic' ? null : track.id;

let game = null;

const shell = new Shell( {
	onStart: () => game.start(),
	onPause: () => game.pause(),
	onResume: () => game.resume(),
	onQuality: ( setting ) => game.setQuality( setting ),
	onCar: ( id ) => game.setCar( id ),
	onNpcs: ( count ) => game.setNpcs( count ),
	onTouch: ( scheme ) => game.setTouch( scheme ),
	onTrack: ( id ) => game.setTrack( id ),
	onRestart: () => game.restart(),
	onSetup: () => game.setup(),
	onReset: () => game.resetCar(),
} );

// Let the loading screen paint before a blocking step (track build, probe bake)
function nextPaint() {

	return new Promise( ( resolve ) => {

		const timeout = setTimeout( resolve, 100 );
		requestAnimationFrame( () => setTimeout( () => {

			clearTimeout( timeout );
			resolve();

		}, 0 ) );

	} );

}

// Models load once and are shared; vehicles get Godot's root_scale 0.5

const loader = new ColorMapGLTFLoader();
const modelCache = new Map();

function loadModel( name, onProgress ) {

	if ( ! modelCache.has( name ) ) {

		modelCache.set( name, new Promise( ( resolve, reject ) => {

			loader.load( MODEL_URLS[ name ], ( gltf ) => {

				gltf.scene.traverse( ( child ) => {

					if ( child.isMesh ) child.material.side = THREE.FrontSide;

				} );

				const car = CARS.find( ( c ) => c.id === name );
				if ( car ) gltf.scene.scale.setScalar( 0.5 );

				// Models are only drawable once their kit's colormap is in
				const kit = car ? car.kit : name === 'debris' ? 'cars' : 'starter';
				colormapLoaded( kit ).then( () => resolve( gltf.scene ) );

			}, ( e ) => {

				if ( onProgress && e.lengthComputable ) onProgress( 0.95 * e.loaded / e.total );

			}, reject );

		} ) );

	}

	return modelCache.get( name );

}

const TRACK_MODELS = [
	'track-straight', 'track-corner', 'track-bump', 'track-finish',
	'decoration-empty', 'decoration-forest', 'decoration-tents',
];

// Everything the first frame needs: the track and the player's car. The
// opponents' cars load after the setup screen is up.
async function loadStartModels( onProgress ) {

	const names = [ ...TRACK_MODELS, settings.car ];
	const fractions = new Array( names.length ).fill( 0 );
	const models = {};

	await Promise.all( names.map( async ( name, i ) => {

		models[ name ] = await loadModel( name, ( f ) => {

			fractions[ i ] = f;
			onProgress( fractions.reduce( ( a, b ) => a + b, 0 ) / names.length );

		} );

		fractions[ i ] = 1;
		onProgress( fractions.reduce( ( a, b ) => a + b, 0 ) / names.length );

	} ) );

	return models;

}

async function init() {

	let qualitySetting = loadSetting();
	let tier = qualitySetting === 'auto' ? ( loadAutoTier( detected.gpu ) || detected.tier ) : qualitySetting;

	// Antialias, the HalfFloat output buffer (bloom) and the probe bake are
	// fixed for this page load; the rest of the preset is applied live, and
	// the probes can be dropped live (stepping down) but not re-baked.
	const boot = PRESETS[ tier ];
	let preset = boot;

	const renderer = new THREE.WebGLRenderer( {
		antialias: boot.antialias,
		outputBufferType: boot.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
	} );
	renderer.shadowMap.enabled = true;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;

	let bloomPass = null;

	if ( boot.halfFloat ) {

		bloomPass = new UnrealBloomPass( new THREE.Vector2( window.innerWidth, window.innerHeight ) );
		bloomPass.strength = 0.02;
		bloomPass.radius = 0.02;
		bloomPass.threshold = 0.5;

		renderer.setEffects( [ bloomPass ] );

	}

	document.body.appendChild( renderer.domElement );

	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0xadb2ba );
	scene.fog = new THREE.Fog( 0xadb2ba, 30, 55 );

	const dirLight = new THREE.DirectionalLight( 0xffffff, 3 );
	dirLight.position.set( 11.4, 15, -5.3 );
	dirLight.castShadow = true;
	dirLight.shadow.mapSize.setScalar( boot.shadowMapSize );
	dirLight.shadow.radius = 4;
	scene.add( dirLight );

	const sun = new SunShadow( dirLight );
	scene.add( sun.target );

	const hemiLight = new THREE.HemisphereLight( 0xc8d8e8, 0x7a8a5a, 2 );
	hemiLight.position.copy( dirLight.position );
	scene.add( hemiLight );

	const cam = new Camera();
	scene.add( cam.debug );

	// Sizing: one path for window resize, rotation, visual-viewport changes and
	// pixel-ratio changes. Polled every frame from the canvas' CSS size, which
	// also catches the stale sizes iOS reports mid-rotation.

	let probes = null;
	let debris = null;
	let fogNear = 30, fogFar = 55;
	let viewWidth = 0, viewHeight = 0, viewPixelRatio = 0;

	function resize() {

		const canvas = renderer.domElement;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		const pixelRatio = Math.min( window.devicePixelRatio || 1, preset.pixelRatio );

		if ( width === 0 || height === 0 ) return false;
		if ( width === viewWidth && height === viewHeight && pixelRatio === viewPixelRatio ) return false;

		viewWidth = width;
		viewHeight = height;
		viewPixelRatio = pixelRatio;

		renderer.setPixelRatio( pixelRatio );
		renderer.setSize( width, height, false );
		cam.setViewport( width, height );
		sun.fit( cam.footprint );

		scene.fog.near = fogNear + cam.extraDistance;
		scene.fog.far = fogFar + cam.extraDistance;

		return true;

	}

	resize();

	function applyPreset() {

		preset = PRESETS[ tier ];

		if ( bloomPass ) bloomPass.enabled = preset.bloom;

		if ( dirLight.shadow.mapSize.x !== preset.shadowMapSize ) {

			dirLight.shadow.mapSize.setScalar( preset.shadowMapSize );

			if ( dirLight.shadow.map ) {

				dirLight.shadow.map.dispose();
				dirLight.shadow.map = null;

			}

			sun.fit( cam.footprint );

		}

		// Materials recompile once without the probe grid (a single hitch)
		if ( probes ) probes.visible = preset.probes > 0;
		setLambert( scene, preset.lambert );
		if ( debris ) debris.lambert = preset.lambert;

		resize();

		const needsReload = preset.antialias !== boot.antialias || preset.halfFloat !== boot.halfFloat || ( preset.probes > 0 && ( ! probes || preset.probes !== boot.probes ) );
		shell.setQuality( qualitySetting, tier, needsReload );

	}

	shell.setQuality( qualitySetting, tier, false );

	// Loading

	shell.setProgress( 0, 'Loading models…' );

	registerAll();
	const models = await loadStartModels( ( f ) => shell.setProgress( f * 0.8, 'Loading models… ' + Math.round( f * 100 ) + '%' ) );
	performance.mark( 'kerb:models' );

	shell.setProgress( 0.82, 'Building track…' );
	await nextPaint();

	// Classic is drawn from the Starter Kit's hand-placed layout (null cells)
	const classic = track.id === 'classic';
	const bounds = computeTrackBounds( classic ? null : track.cells );
	const hw = bounds.halfWidth;
	const hd = bounds.halfDepth;
	const groundSize = Math.max( hw, hd ) * 2 + 20;

	fogNear = groundSize * 0.4;
	fogFar = groundSize * 0.8;
	scene.fog.near = fogNear + cam.extraDistance;
	scene.fog.far = fogFar + cam.extraDistance;

	const trackGroups = buildTrack( scene, models, classic ? null : track.cells, PLAYTEST && params.has( 'chunk' ) ? { chunk: Number( params.get( 'chunk' ) ) } : {} );
	performance.mark( 'kerb:track' );

	// The simulation, with the player's car on the start line

	const line = centerline( track.cells );
	const race = new Race( { cells: track.cells, line, classic, ai: track.ai } );
	const player = race.addCar( getCar( settings.car ), models[ settings.car ], { player: true, name: 'You' } );
	scene.add( player.vehicle.container );

	// Probes (grid density scales with the tier; low skips the bake and relies
	// on the hemisphere light)

	if ( boot.probes > 0 ) {

		shell.setProgress( 0.88, 'Baking lighting…' );
		await nextPaint();

		const probeHeight = 6;
		probes = new LightProbeGrid(
			hw * 2, probeHeight, hd * 2,
			Math.max( 4 * boot.probes, Math.round( hw / 4 * boot.probes ) ),
			2,
			Math.max( 4 * boot.probes, Math.round( hd / 4 * boot.probes ) ),
		);
		probes.position.set( bounds.centerX, probeHeight / 2, bounds.centerZ );
		probes.bake( renderer, scene, { cubemapSize: boot.probeCubemapSize, near: 0.1, far: groundSize } );
		scene.add( probes );
		performance.mark( 'kerb:probes' );

	}

	setLambert( scene, preset.lambert );

	const controls = new Controls( settings.touch );
	const hud = new Hud();

	const particles = new SmokeTrails( scene );
	debris = new Debris( scene, tier === 'low' ? 6 : 14 );
	debris.lambert = preset.lambert;
	const driftMarks = new DriftMarks( scene, trackKey );
	const npcMarks = new DriftMarks( scene, null, { shared: true } );

	// Audio is initialised after the start screen is up (see the end of
	// init): it renders its synth buffers up front (~170ms of main thread),
	// and nothing can play before the first gesture anyway.
	const audio = new GameAudio();

	let bestLap = loadBest( trackKey );
	let wallImpacts = 0;
	let maxWallImpact = 0;
	let shake = 0;
	const hitTimes = new Map();
	const _point = new THREE.Vector3();

	race.events.onWallHit = ( car, speed, ground ) => {

		if ( car.player ) {

			audio.playImpact( speed );

			if ( ! ground ) {

				wallImpacts ++;
				maxWallImpact = Math.max( maxWallImpact, speed );

			}

		} else if ( ! ground && speed > 1.5 ) {

			audio.playImpact( speed * 0.8, _point.copy( car.vehicle.container.position ) );

		}

	};

	race.events.onCarHit = ( a, b, speed, x, z ) => {

		// Sustained shoving re-triggers contact every step: one sound per
		// pair every quarter second
		const key = a.vehicle.container.id + ':' + b.vehicle.container.id;
		const last = hitTimes.get( key ) || - 1;
		if ( speed < 0.6 || race.time - last < 0.25 ) return;
		hitTimes.set( key, race.time );

		const withPlayer = a.player || b.player;
		if ( withPlayer ) audio.playImpact( speed * 1.2 );
		else audio.playImpact( speed, _point.set( x, 0.5, z ) );

		if ( speed > 2 ) particles.puff( x, 0.3, z, Math.min( 10, Math.round( speed * 2 ) ) );
		if ( speed > 3.5 ) debris.burst( x, z, speed );
		if ( withPlayer ) shake = Math.min( 0.35, shake + speed * 0.04 );

	};

	race.events.onLap = ( car ) => {

		if ( ! car.player ) return;

		const isBest = bestLap === null || car.counter.lastLap < bestLap;

		if ( isBest ) {

			bestLap = car.counter.lastLap;
			saveBest( trackKey, bestLap );

		}

		hud.flashLap( isBest );

	};

	race.events.onFinish = ( car ) => {

		if ( ! car.player ) return;

		// A gentle lap of honour behind the results
		const cooldown = new AIDriver( line, { skill: 0.6, seed: 3 } );
		cooldown.pace = 0.55;
		car.driver = cooldown;

	};

	// The opponents: a field planned for the settings, with models loading
	// after the setup screen is up. Kept for "race again"; replaced when the
	// count or the player's car changes.

	let field = null;
	let fieldToken = 0;
	let fieldDirty = true;

	function npcCount() {

		return track.raceable ? settings.npcs : 0;

	}

	async function buildField() {

		const token = ++ fieldToken;
		const count = npcCount();
		const random = rng( ( Date.now() & 0xffff ) + count );
		const plan = planField( count, random );

		// Different cars from each other and from the player's
		const pool = CARS.filter( ( c ) => c.id !== settings.car );
		const defs = plan.map( () => pool.splice( Math.floor( random() * pool.length ), 1 )[ 0 ] );

		shell.setBusy( count > 0 );
		const loaded = await Promise.all( defs.map( ( def ) => loadModel( def.id ) ) );
		if ( token !== fieldToken ) return false;

		for ( const car of race.cars.slice() ) {

			if ( car.player ) continue;
			scene.remove( car.vehicle.container );
			race.removeCar( car );

		}

		field = plan.map( ( p, i ) => {

			const driver = new AIDriver( line, { seed: Math.floor( random() * 1e6 ), aggression: p.aggression } );
			const car = race.addCar( defs[ i ], loaded[ i ], { driver } );
			car.paceFactor = p.factor;
			setLambert( car.vehicle.container, preset.lambert );
			scene.add( car.vehicle.container );
			return car;

		} );

		fieldDirty = false;
		shell.setBusy( false );
		return true;

	}

	// Line everyone up for the current settings (grid, or the time trial
	// spawn) and show it behind the setup screen. The field is paced from
	// the player's best lap so far.
	function lineUp() {

		player.driver = null;

		for ( const car of field || [] ) {

			driftMarks.lift( car.vehicle );
			npcMarks.lift( car.vehicle );

		}

		driftMarks.lift( player.vehicle );
		race.aimField( bestLap ?? track.par, bestLap !== null );

		if ( field && field.length ) race.setup( 'race', [ ...field, player ], track.laps );
		else race.setup( 'timetrial' );

		hud.setMode( race.mode );
		hitTimes.clear();
		snapCamera();

	}

	async function refreshField() {

		if ( fieldDirty && await buildField() === false ) return;
		lineUp();

	}

	const _forward = new THREE.Vector3();
	const _camLead = new THREE.Vector3();
	const _camTarget = new THREE.Vector3();

	function snapCamera() {

		cam.initialized = false;
		_camTarget.copy( player.vehicle.container.position ).y += 0.5;
		cam.update( 0, _camTarget, _camLead.set( 0, 0, 0 ) );
		sun.update( cam.lookPoint );
		needsRender = true;

	}

	// Warm up shaders so the first driven frames don't hitch

	shell.setProgress( 0.95, 'Compiling shaders…' );
	await nextPaint();

	cam.update( 0, player.vehicle.spherePos, _camLead );
	sun.update( cam.lookPoint );
	performance.mark( 'kerb:setup' );
	await renderer.compileAsync( scene, cam.camera );
	performance.mark( 'kerb:compiled' );

	// Game state: the shell owns the screen state (ready / playing / paused /
	// finished); the loop only simulates while playing or showing results.

	const timer = new THREE.Timer();
	const frameMonitor = new FrameMonitor();
	const frameStats = new FrameMonitor();
	const stepStats = new FrameMonitor();
	let warmupFrames = 0;
	let adaptDone = qualitySetting !== 'auto';
	let needsRender = true;
	let pendingDt = 0;
	let lastCountdown = null;
	let resultsTimer = 0;

	function pause() {

		if ( shell.state !== 'playing' ) return;

		controls.reset();
		audio.setPaused( true );
		shell.pause();
		needsRender = true;

	}

	function resume() {

		if ( shell.state !== 'paused' ) return;

		shell.resume();
		audio.setPaused( false );
		frameMonitor.reset();
		warmupFrames = 0;

	}

	let starting = false;

	async function go() {

		if ( starting ) return;
		starting = true;

		await refreshField();
		starting = false;

		// Keys stay held: W both starts and drives, as it always has
		lastCountdown = null;
		wallImpacts = 0;
		maxWallImpact = 0;
		race.start();
		audio.setPaused( false );
		shell.play();
		warmupFrames = 0;

	}

	game = {

		start: go,
		restart: go,
		pause,
		resume,

		setup() {

			audio.setPaused( true );
			shell.setup();
			refreshField();

		},

		setQuality( setting ) {

			qualitySetting = setting;
			saveSetting( setting );

			tier = setting === 'auto' ? ( loadAutoTier( detected.gpu ) || detected.tier ) : setting;
			adaptDone = setting !== 'auto';
			applyPreset();
			needsRender = true;

		},

		async setCar( id ) {

			settings.setCar( id );
			shell.setCar( id );

			const def = getCar( id );
			const model = await loadModel( id );
			if ( settings.car !== id ) return;

			player.def = def;
			player.vehicle.init( model, def.bodyY );
			setLambert( player.vehicle.container, preset.lambert );

			// An opponent may have had this car
			if ( field && field.some( ( c ) => c.def.id === id ) ) fieldDirty = true;
			if ( shell.state === 'ready' ) refreshField();
			needsRender = true;

		},

		setNpcs( count ) {

			settings.setNpcs( count );
			shell.setNpcs( settings.npcs, track.raceable );
			fieldDirty = true;
			if ( shell.state === 'ready' ) refreshField();

		},

		setTouch( scheme ) {

			settings.setTouch( scheme );
			controls.setScheme( scheme );
			shell.setTouch( scheme );

		},

		setTrack( id ) {

			rememberTrack( id );
			const next = new URLSearchParams( location.search );
			next.delete( 'map' );
			next.set( 'track', id );
			location.search = next.toString();

		},

		resetCar() {

			if ( shell.state === 'paused' ) resume();
			race.respawn( player );
			driftMarks.lift( player.vehicle );

		},

	};

	document.getElementById( 'pause-btn' ).addEventListener( 'click', pause );

	document.addEventListener( 'visibilitychange', () => {

		if ( document.hidden ) pause();

	} );

	window.addEventListener( 'blur', pause );

	// Auto quality: if the device can't hold ~45fps once driving, step down a
	// tier (live knobs only) and remember it for the next load.
	function adaptQuality( frameDt ) {

		if ( adaptDone ) return;

		if ( warmupFrames < 30 ) {

			warmupFrames ++;
			return;

		}

		frameMonitor.push( frameDt );
		if ( ! frameMonitor.full() ) return;

		if ( frameMonitor.percentile( 0.5 ) > 1 / 45 && tier !== 'low' ) {

			tier = lowerTier( tier );
			saveAutoTier( detected.gpu, tier );
			applyPreset();
			frameMonitor.reset();
			warmupFrames = 0;

		} else {

			adaptDone = true;

		}

	}

	// Fixed-step simulation (Race.STEP, 60Hz). The truck's drive torque fights
	// per-step physics damping, so a variable step made it accelerate ~10%
	// harder at 240Hz than at 30fps (scripts/playtest/framerate.mjs). Cars
	// are drawn interpolated between the last two steps so faster displays
	// stay smooth, and slow devices catch up with several steps per frame
	// down to 15fps.

	const MAX_STEPS = 4;
	const RESULTS_DELAY = 1.2;
	let accumulator = 0;

	function step( input ) {

		const t0 = performance.now();
		race.step( input );
		stepStats.push( ( performance.now() - t0 ) / 1000 );

		for ( const car of race.cars ) {

			particles.emit( car.vehicle );
			if ( car.player ) driftMarks.update( STEP, car.vehicle );
			else npcMarks.update( STEP, car.vehicle );

		}

		particles.update( STEP );

		// 3 · 2 · 1 · GO
		if ( race.phase === 'countdown' ) {

			const n = Math.ceil( race.countdown );
			if ( n !== lastCountdown ) audio.beep( 440, 0.15 );
			lastCountdown = n;

		} else if ( lastCountdown !== null && race.mode === 'race' ) {

			audio.beep( 880, 0.45 );
			lastCountdown = null;

		}

	}

	function frame( frameDt, input ) {

		accumulator = Math.min( accumulator + frameDt, STEP * MAX_STEPS );

		while ( accumulator >= STEP ) {

			step( input );
			accumulator -= STEP;

		}

		const alpha = accumulator / STEP;

		for ( const car of race.cars ) {

			const container = car.vehicle.container;
			car.simPosition = ( car.simPosition || new THREE.Vector3() ).copy( container.position );
			car.simQuaternion = ( car.simQuaternion || new THREE.Quaternion() ).copy( container.quaternion );
			container.position.lerpVectors( car.prevPosition, car.simPosition, alpha );
			container.quaternion.slerpQuaternions( car.prevQuaternion, car.simQuaternion, alpha );

			// Respawned cars blink while they can't be hit
			container.visible = ! ( car.ghost > 0 && Math.floor( car.ghost * 10 ) % 2 );

		}

		const vehicle = player.vehicle;
		const container = vehicle.container;
		const mv = vehicle.modelVelocity;
		_camLead.set( 0, 0, 1 ).applyQuaternion( container.quaternion ).multiplyScalar( Math.sqrt( mv.x * mv.x + mv.z * mv.z ) );
		_camTarget.copy( container.position ).y += 0.5;
		cam.update( frameDt, _camTarget, _camLead );

		// A jolt on hard hits
		if ( shake > 0.005 ) {

			cam.camera.position.x += ( Math.random() - 0.5 ) * shake;
			cam.camera.position.y += ( Math.random() - 0.5 ) * shake;
			shake *= Math.exp( - frameDt * 10 );

		}

		sun.update( cam.lookPoint );
		debris.update( frameDt );
		audio.update( frameDt, vehicle.linearSpeed / MAX_SPEED, vehicle.inputZ, vehicle.driftIntensity );
		hud.update( race, bestLap );

		renderer.render( scene, cam.camera );

		for ( const car of race.cars ) {

			car.vehicle.container.position.copy( car.simPosition );
			car.vehicle.container.quaternion.copy( car.simQuaternion );

		}

	}

	function animate( timestamp ) {

		requestAnimationFrame( animate );

		timer.update( timestamp );
		let frameDt = timer.getDelta();

		if ( FPS_LIMIT ) {

			pendingDt += frameDt;
			if ( pendingDt < 1 / FPS_LIMIT - 0.002 ) return;
			frameDt = pendingDt;
			pendingDt = 0;

		}

		const resized = resize();
		const input = controls.update();

		if ( shell.state === 'ready' && input.anyButton && shell.view === 'setup' ) {

			shell.start();

		} else if ( input.pause ) {

			if ( shell.state === 'playing' ) pause();
			else if ( shell.state === 'paused' ) resume();

		}

		if ( input.reset && shell.state === 'playing' ) game.resetCar();

		if ( shell.state === 'playing' || shell.state === 'finished' ) {

			if ( shell.state === 'playing' ) {

				adaptQuality( frameDt );
				frameStats.push( frameDt );

			}

			for ( let i = 0; i < VIRTUAL_FRAMES; i ++ ) frame( frameDt / VIRTUAL_FRAMES, input );

			// Results come up a moment after the player crosses the line (race
			// time, so a pause in between only delays them), then fill in as
			// the rest of the field finishes
			const resultsDue = shell.state === 'playing' && player.finished && race.time - player.finishTime > RESULTS_DELAY;

			if ( resultsDue || ( shell.state === 'finished' && ( resultsTimer -= frameDt ) <= 0 ) ) {

				shell.showResults( race );
				resultsTimer = 0.5;

			}

			return;

		}

		// Menus: draw only when something changed
		if ( resized || needsRender ) {

			if ( resized ) snapCamera();
			renderer.render( scene, cam.camera );

		}

		needsRender = false;

	}

	if ( PLAYTEST || import.meta.env.DEV ) {

		const _projected = new THREE.Vector3();

		window.__kerb = {
			three: { THREE, scene, renderer, camera: cam.camera, dirLight, trackGroups },
			race,
			cells: track.cells,
			spawn: race.spawn,
			// World point → normalised device coords, to check what's on screen
			project( x, y, z ) {

				_projected.set( x, y, z ).project( cam.camera );
				return [ _projected.x, _projected.y ];

			},
			// Hide parts of the scene to attribute frame cost (scripts/bench.mjs)
			toggle( part, visible ) {

				if ( part === 'shadows' ) {

					dirLight.castShadow = visible;

				} else if ( part === 'cars' ) {

					for ( const car of race.cars ) car.vehicle.container.visible = visible;

				} else {

					const group = { decorations: trackGroups.decoGroup, track: trackGroups.trackPieceGroup }[ part ];
					if ( group ) group.visible = visible;

				}

			},
			// GPU-inclusive cost per frame: rAF intervals are vsync-quantised,
			// so render synchronously and force completion with a 1px readback
			benchmark( frames = 60 ) {

				const gl = renderer.getContext();
				const pixel = new Uint8Array( 4 );
				renderer.render( scene, cam.camera );
				gl.readPixels( 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel );

				const t0 = performance.now();

				for ( let i = 0; i < frames; i ++ ) {

					renderer.render( scene, cam.camera );
					gl.readPixels( 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel );

				}

				return ( performance.now() - t0 ) / frames;

			},
			state() {

				const vehicle = player.vehicle;
				_forward.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion );
				const canvas = renderer.domElement;
				const counter = player.counter;

				return {
					t: performance.now(),
					screen: shell.state,
					track: track.id,
					car: settings.car,
					touch: settings.touch,
					mode: race.mode,
					phase: race.phase,
					raceTime: race.time,
					laps: race.laps,
					position: race.position( player ),
					cars: race.cars.length,
					finished: player.finished,
					x: vehicle.spherePos.x,
					y: vehicle.spherePos.y,
					z: vehicle.spherePos.z,
					heading: Math.atan2( _forward.x, _forward.z ),
					speed: Math.hypot( vehicle.sphereVel.x, vehicle.sphereVel.z ),
					linearSpeed: vehicle.linearSpeed,
					lap: counter.lap,
					lapTime: counter.currentLapTime,
					lastLap: counter.lastLap,
					bestLap,
					lapTimes: player.lapTimes,
					timerRunning: counter.running,
					visited: counter.visitedCells.size,
					required: counter.requiredCells.size,
					wallImpacts,
					maxWallImpact,
					carHits: player.carHits,
					resets: vehicle.resets,
					frameP50: frameStats.percentile( 0.5 ),
					frameP95: frameStats.percentile( 0.95 ),
					stepP50: stepStats.percentile( 0.5 ),
					stepP95: stepStats.percentile( 0.95 ),
					tier,
					qualitySetting,
					gpu: detected.gpu,
					clientWidth: canvas.clientWidth,
					clientHeight: canvas.clientHeight,
					canvasWidth: canvas.width,
					canvasHeight: canvas.height,
					pixelRatio: renderer.getPixelRatio(),
					aspect: cam.camera.aspect,
					fov: cam.camera.fov,
					zoomOut: cam.zoomOut,
					viewportScale: window.visualViewport ? window.visualViewport.scale : 1,
					audioState: audio.listener ? audio.listener.context.state : 'uninitialized',
					engineReady: audio.engineRpmParam !== null,
				};

			},
			standings() {

				return race.standings().map( ( car ) => ( {
					name: car.name,
					car: car.def.id,
					player: car.player,
					skill: car.driver && ! car.player ? car.driver.skill : null,
					target: car.targetLap,
					pace: car.driver ? car.driver.pace : null,
					lap: car.counter.lap,
					lapTimes: car.lapTimes,
					distance: car.distance,
					finished: car.finished,
					finishTime: car.finishTime,
					respawns: car.respawns,
					carHits: car.carHits,
				} ) );

			},
		};

	}

	if ( params.has( 'tune' ) && import.meta.env.MODE !== 'offline' ) import( './Tune.js' ).then( ( { tune } ) => tune( race ) );

	// The setup screen

	shell.buildPickers( track, encodeCells( track.cells ) );
	shell.setCar( settings.car );
	shell.setNpcs( settings.npcs, track.raceable );
	shell.setTouch( settings.touch );

	race.setup( 'timetrial' );
	hud.setMode( 'timetrial' );
	snapCamera();

	// Pick a car first, the first time round
	if ( ! settings.hasCar ) shell.setView( 'cars' );

	shell.ready();
	performance.mark( 'kerb:interactive' );

	requestAnimationFrame( animate );

	setTimeout( () => audio.init( cam.camera, player.vehicle.container, scene ), 0 );

	// Opponents (and crash debris) load in the background behind the setup
	// screen
	refreshField();
	loadModel( 'debris' ).then( ( model ) => debris.setModel( model ) ).catch( () => {} );

}

const detected = detectTier();

if ( detected.tier === null ) {

	shell.showError( 'Kerb Stomp needs WebGL 2, which this browser or device does not provide.' );

} else {

	init().catch( ( e ) => {

		console.error( e );
		shell.showError( 'Something went wrong while loading the game. Reload to try again.' );

	} );

}
