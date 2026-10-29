import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { LightProbeGridHelper } from 'three/addons/helpers/LightProbeGridHelper.js';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, registerAll, updateWorld, rigidBody, box, MotionType } from 'crashcat';
import { Vehicle, MAX_SPEED } from './Vehicle.js';
import { Camera } from './Camera.js';
import { Controls } from './Controls.js';
import { buildTrack, decodeCells, computeSpawnPosition, computeTrackBounds, TRACK_CELLS } from './Track.js';
import { buildWallColliders, createSphereBody } from './Physics.js';
import { SmokeTrails } from './Particles.js';
import { DriftMarks } from './DriftMarks.js';
import { GameAudio } from './Audio.js';
import { LapTimer } from './LapTimer.js';
import { ColorMapGLTFLoader } from './Loader.js';
import { MODEL_URLS } from './Assets.js';
import { PRESETS, detectTier, loadSetting, saveSetting, loadAutoTier, saveAutoTier, lowerTier, FrameMonitor } from './Quality.js';
import { Shell, lockViewport } from './Shell.js';

const params = new URLSearchParams( window.location.search );

// Playtest hooks (scripts/playtest): read-only state on window.__kerb, plus a
// frame-rate cap (?fps=30) and virtual frames per display frame (?frames=2
// renders like a 120Hz display) for checking frame-rate independence.
const PLAYTEST = params.has( 'playtest' );
const FPS_LIMIT = PLAYTEST ? Number( params.get( 'fps' ) ) || 0 : 0;
const VIRTUAL_FRAMES = PLAYTEST ? Math.max( 1, Number( params.get( 'frames' ) ) || 1 ) : 1;

lockViewport();

let game = null;

const shell = new Shell( {
	onStart: () => game.start(),
	onPause: () => game.pause(),
	onResume: () => game.resume(),
	onQuality: ( setting ) => game.setQuality( setting ),
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

const modelNames = [
	'vehicle-truck-yellow', 'vehicle-truck-green', 'vehicle-truck-purple', 'vehicle-truck-red',
	'track-straight', 'track-corner', 'track-bump', 'track-finish',
	'decoration-empty', 'decoration-forest', 'decoration-tents',
];

async function loadModels( onProgress ) {

	const loader = new ColorMapGLTFLoader();
	const models = {};
	const fractions = new Array( modelNames.length ).fill( 0 );

	const report = ( i, f ) => {

		fractions[ i ] = f;
		onProgress( fractions.reduce( ( a, b ) => a + b, 0 ) / fractions.length );

	};

	const promises = modelNames.map( ( name, i ) =>
		new Promise( ( resolve, reject ) => {

			loader.load( MODEL_URLS[ name ], ( gltf ) => {

				const meshes = [];
				gltf.scene.traverse( ( child ) => {

					if ( child.isMesh ) {

						child.material.side = THREE.FrontSide;
						meshes.push( child );

					}

				} );

				// Godot imports vehicle models at root_scale=0.5
				if ( name.startsWith( 'vehicle-' ) ) {

					gltf.scene.scale.setScalar( 0.5 );

				}

				if ( meshes.length === 1 ) {

					const mesh = meshes[ 0 ];
					mesh.removeFromParent();
					models[ name ] = mesh;

				} else {

					models[ name ] = gltf.scene;

				}

				report( i, 1 );
				resolve();

			}, ( e ) => {

				if ( e.lengthComputable ) report( i, 0.95 * e.loaded / e.total );

			}, reject );

		} )
	);

	await Promise.all( promises );

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
	dirLight.shadow.camera.near = 0.5;
	dirLight.shadow.camera.far = 60;
	dirLight.shadow.radius = 4;
	scene.add( dirLight );

	const hemiLight = new THREE.HemisphereLight( 0xc8d8e8, 0x7a8a5a, 2 );
	hemiLight.position.copy( dirLight.position )
	scene.add( hemiLight );

	const cam = new Camera();
	scene.add( cam.debug );

	// Sizing: one path for window resize, rotation, visual-viewport changes and
	// pixel-ratio changes. Polled every frame from the canvas' CSS size, which
	// also catches the stale sizes iOS reports mid-rotation.

	let probes = null;
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

		}

		// Materials recompile once without the probe grid (a single hitch)
		if ( probes ) probes.visible = preset.probes > 0;

		resize();

		const needsReload = preset.antialias !== boot.antialias || preset.halfFloat !== boot.halfFloat || ( preset.probes > 0 && ( ! probes || preset.probes !== boot.probes ) );
		shell.setQuality( qualitySetting, tier, needsReload );

	}

	shell.setQuality( qualitySetting, tier, false );

	// Loading

	shell.setProgress( 0, 'Loading models…' );

	registerAll();
	const models = await loadModels( ( f ) => shell.setProgress( f * 0.8, 'Loading models… ' + Math.round( f * 100 ) + '%' ) );
	performance.mark( 'kerb:models' );

	shell.setProgress( 0.82, 'Building track…' );
	await nextPaint();

	const mapParam = params.get( 'map' );
	let customCells = null;
	let spawn = null;

	if ( mapParam ) {

		try {

			customCells = decodeCells( mapParam );
			spawn = computeSpawnPosition( customCells );

		} catch ( e ) {

			console.warn( 'Invalid map parameter, using default track' );

		}

	}

	// Compute track bounds and size physics/shadows to fit
	const bounds = computeTrackBounds( customCells );
	const hw = bounds.halfWidth;
	const hd = bounds.halfDepth;
	const groundSize = Math.max( hw, hd ) * 2 + 20;

	const shadowExtent = Math.max( hw, hd ) + 10;
	dirLight.shadow.camera.left = - shadowExtent;
	dirLight.shadow.camera.right = shadowExtent;
	dirLight.shadow.camera.top = shadowExtent;
	dirLight.shadow.camera.bottom = - shadowExtent;
	dirLight.shadow.camera.updateProjectionMatrix();

	fogNear = groundSize * 0.4;
	fogFar = groundSize * 0.8;
	scene.fog.near = fogNear + cam.extraDistance;
	scene.fog.far = fogFar + cam.extraDistance;

	buildTrack( scene, models, customCells );
	performance.mark( 'kerb:track' );

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

		// scene.add( new LightProbeGridHelper( probes, 0.5 ) );

	}

	//

	const worldSettings = createWorldSettings();
	worldSettings.gravity = [ 0, - 9.81, 0 ];

	const BPL_MOVING = addBroadphaseLayer( worldSettings );
	const BPL_STATIC = addBroadphaseLayer( worldSettings );
	const OL_MOVING = addObjectLayer( worldSettings, BPL_MOVING );
	const OL_STATIC = addObjectLayer( worldSettings, BPL_STATIC );

	enableCollision( worldSettings, OL_MOVING, OL_STATIC );
	enableCollision( worldSettings, OL_MOVING, OL_MOVING );

	const world = createWorld( worldSettings );
	world._OL_MOVING = OL_MOVING;
	world._OL_STATIC = OL_STATIC;

	buildWallColliders( world, null, customCells );

	const roadHalf = groundSize / 2;
	const groundBody = rigidBody.create( world, {
		shape: box.create( { halfExtents: [ roadHalf, 0.01, roadHalf ] } ),
		motionType: MotionType.STATIC,
		objectLayer: OL_STATIC,
		position: [ bounds.centerX, - 0.125, bounds.centerZ ],
		friction: 5.0,
		restitution: 0.0,
	} );

	const sphereBody = createSphereBody( world, spawn ? spawn.position : null );

	const vehicle = new Vehicle();
	vehicle.rigidBody = sphereBody;
	vehicle.physicsWorld = world;

	if ( spawn ) {

		const [ sx, sy, sz ] = spawn.position;
		vehicle.spherePos.set( sx, sy, sz );
		vehicle.prevModelPos.set( sx, 0, sz );
		vehicle.container.rotation.y = spawn.angle;
		vehicle.spawnPosition = spawn.position;
		vehicle.spawnAngle = spawn.angle;

	}

	const vehicleGroup = vehicle.init( models[ 'vehicle-truck-yellow' ] );
	scene.add( vehicleGroup );

	dirLight.target = vehicleGroup;

	const controls = new Controls();

	const particles = new SmokeTrails( scene );
	const driftMarks = new DriftMarks( scene, mapParam );

	// Audio is initialised after the start screen is up (see the end of
	// init): it renders its synth buffers up front (~170ms of main thread),
	// and nothing can play before the first gesture anyway.
	const audio = new GameAudio();

	const lapTimer = new LapTimer( customCells, mapParam );

	const _forward = new THREE.Vector3();
	const _camLead = new THREE.Vector3();

	let wallImpacts = 0;
	let maxWallImpact = 0;

	const contactListener = {
		onContactAdded( bodyA, bodyB ) {

			if ( bodyA !== sphereBody && bodyB !== sphereBody ) return;

			_forward.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion );
			_forward.y = 0;
			_forward.normalize();

			const impactVelocity = Math.abs( vehicle.modelVelocity.dot( _forward ) );
			audio.playImpact( impactVelocity );

			if ( bodyA !== groundBody && bodyB !== groundBody ) {

				wallImpacts ++;
				maxWallImpact = Math.max( maxWallImpact, impactVelocity );

			}

		}
	};

	// Warm up shaders so the first driven frames don't hitch

	shell.setProgress( 0.95, 'Compiling shaders…' );
	await nextPaint();

	cam.update( 0, vehicle.spherePos, _camLead );
	performance.mark( 'kerb:setup' );
	await renderer.compileAsync( scene, cam.camera );
	performance.mark( 'kerb:compiled' );

	// Game state: the shell owns the screen state (ready / playing / paused);
	// the loop only simulates while not paused.

	const timer = new THREE.Timer();
	const frameMonitor = new FrameMonitor();
	const frameStats = new FrameMonitor();
	let warmupFrames = 0;
	let adaptDone = qualitySetting !== 'auto';
	let needsRender = true;
	let pendingDt = 0;

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

	game = {

		start() {

			warmupFrames = 0;

		},

		pause,
		resume,

		setQuality( setting ) {

			qualitySetting = setting;
			saveSetting( setting );

			tier = setting === 'auto' ? ( loadAutoTier( detected.gpu ) || detected.tier ) : setting;
			adaptDone = setting !== 'auto';
			applyPreset();
			needsRender = true;

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

	// Fixed-step simulation. The truck's drive torque fights per-step physics
	// damping, so a variable step made it accelerate ~10% harder at 240Hz than
	// at 30fps (scripts/playtest/framerate.mjs). 60Hz steps keep the feel of
	// the original 60fps tuning everywhere; the truck is drawn interpolated
	// between the last two steps so faster displays stay smooth, and slow
	// devices catch up with several steps per frame down to 15fps.

	const STEP = 1 / 60;
	const MAX_STEPS = 4;
	let accumulator = 0;

	const prevPosition = vehicle.container.position.clone();
	const prevQuaternion = vehicle.container.quaternion.clone();
	const simPosition = new THREE.Vector3();
	const simQuaternion = new THREE.Quaternion();
	const _camTarget = new THREE.Vector3();

	function step( input ) {

		prevPosition.copy( vehicle.container.position );
		prevQuaternion.copy( vehicle.container.quaternion );

		updateWorld( world, contactListener, STEP );

		vehicle.update( STEP, input );

		particles.update( STEP, vehicle );
		driftMarks.update( STEP, vehicle );

		const hasInput = input.touchActive || Math.abs( input.x ) > 0.05 || Math.abs( input.z ) > 0.05;
		lapTimer.update( STEP, vehicle.spherePos, hasInput );

	}

	function frame( frameDt, input ) {

		accumulator = Math.min( accumulator + frameDt, STEP * MAX_STEPS );

		while ( accumulator >= STEP ) {

			step( input );
			accumulator -= STEP;

		}

		const container = vehicle.container;
		simPosition.copy( container.position );
		simQuaternion.copy( container.quaternion );

		container.position.lerpVectors( prevPosition, simPosition, accumulator / STEP );
		container.quaternion.slerpQuaternions( prevQuaternion, simQuaternion, accumulator / STEP );

		dirLight.position.set(
			container.position.x + 11.4,
			15,
			container.position.z - 5.3
		);

		const mv = vehicle.modelVelocity;
		_camLead.set( 0, 0, 1 ).applyQuaternion( container.quaternion ).multiplyScalar( Math.sqrt( mv.x * mv.x + mv.z * mv.z ) );
		_camTarget.copy( container.position ).y += 0.5;
		cam.update( frameDt, _camTarget, _camLead );
		audio.update( frameDt, vehicle.linearSpeed / MAX_SPEED, input.z, vehicle.driftIntensity );

		renderer.render( scene, cam.camera );

		container.position.copy( simPosition );
		container.quaternion.copy( simQuaternion );

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

		if ( shell.state === 'ready' && input.anyButton ) {

			shell.start();

		} else if ( input.pause ) {

			if ( shell.state === 'playing' ) pause();
			else if ( shell.state === 'paused' ) resume();

		}

		if ( shell.state === 'paused' || shell.state === 'error' ) {

			if ( resized || needsRender ) renderer.render( scene, cam.camera );
			needsRender = false;
			return;

		}

		if ( shell.state === 'playing' ) {

			adaptQuality( frameDt );
			frameStats.push( frameDt );

		}

		for ( let i = 0; i < VIRTUAL_FRAMES; i ++ ) frame( frameDt / VIRTUAL_FRAMES, input );

	}

	if ( PLAYTEST || import.meta.env.DEV ) {

		const _projected = new THREE.Vector3();

		window.__kerb = {
			cells: customCells || TRACK_CELLS,
			spawn: spawn || { position: vehicle.spawnPosition, angle: vehicle.spawnAngle },
			// World point → normalised device coords, to check what's on screen
			project( x, y, z ) {

				_projected.set( x, y, z ).project( cam.camera );
				return [ _projected.x, _projected.y ];

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

				_forward.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion );
				const canvas = renderer.domElement;

				return {
					t: performance.now(),
					screen: shell.state,
					x: vehicle.spherePos.x,
					y: vehicle.spherePos.y,
					z: vehicle.spherePos.z,
					heading: Math.atan2( _forward.x, _forward.z ),
					speed: Math.hypot( vehicle.sphereVel.x, vehicle.sphereVel.z ),
					linearSpeed: vehicle.linearSpeed,
					lap: lapTimer.lap,
					lapTime: lapTimer.currentLapTime,
					lastLap: lapTimer.lastLap,
					bestLap: lapTimer.bestLap,
					timerRunning: lapTimer.running,
					visited: lapTimer.visitedCells.size,
					required: lapTimer.requiredCells.size,
					wallImpacts,
					maxWallImpact,
					resets: vehicle.resets,
					frameP50: frameStats.percentile( 0.5 ),
					frameP95: frameStats.percentile( 0.95 ),
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
		};

	}

	shell.ready();
	performance.mark( 'kerb:interactive' );

	requestAnimationFrame( animate );

	setTimeout( () => audio.init( cam.camera, vehicleGroup ), 0 );

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
