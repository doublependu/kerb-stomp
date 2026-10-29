import * as THREE from 'three';
import { createImpactBuffer } from './ImpactSound.js';
import { SKID_URL } from './Assets.js';
// Loaded as source text and handed to the worklet as a Blob / data URL, so the
// same code path works in dev, the hashed build and the single-file offline build.
import engineWorkletSource from './EngineWorklet.js?raw';
// RPM range is owned by the engine synth; import it so the 0..1 gear model
// here and the worklet's normalization can't drift apart.
import { RPM_IDLE, RPM_MAX } from './EngineWorklet.js';

function remap( value, inMin, inMax, outMin, outMax ) {

	return outMin + ( outMax - outMin ) * ( ( value - inMin ) / ( inMax - inMin ) );

}

const NUM_GEARS = 3;
const UPSHIFT_RPM = 0.92;
const DOWNSHIFT_RPM = 0.35;
const SHIFT_COOLDOWN = 0.35;
const SHIFT_CUT = 0.12; // throttle-cut at the start of a shift ("bra-ap braap")

// Collisions below this velocity use the dull-knock buffer set, above it the
// crunch set; velocity also drives per-hit volume and tone up to the ceiling.
const IMPACT_HARD_VELOCITY = 2.5;
const IMPACT_MAX_VELOCITY = 6;

// Camera follows at ~16 units. refDistance well below that puts a source
// ~7 dB down at nominal distance — the environment should sound "over there".
const REF_DISTANCE = 7;

// The engine is the player's own car: a reference distance below the camera
// distance keeps it fairly present, but not right at the ear.
const ENGINE_REF_DISTANCE = 11;

// Fixed high-end rolloff on the engine — a touch of air-absorption "distance"
// without the full perspective lowpass the environment sources get.
const ENGINE_CUTOFF = 5500;

// PannerNode only attenuates and pans, so a distance lowpass (exaggerated air
// absorption) is added separately: open when close, darkening with distance.
const _listenerPos = new THREE.Vector3();
const _targetPos = new THREE.Vector3();

function distanceCutoff( distance ) {

	return THREE.MathUtils.clamp(
		24000 * Math.pow( 6 / Math.max( distance, 6 ), 1.9 ),
		1200, 24000
	);

}

// Outdoor "air" impulse response: sparse early reflections + a short dark tail.
function createOutdoorIR( context ) {

	const sr = context.sampleRate;
	const length = Math.floor( 1.1 * sr );
	const buffer = context.createBuffer( 2, length, sr );

	for ( let ch = 0; ch < 2; ch ++ ) {

		const data = buffer.getChannelData( ch );

		// Early reflections: ground bounce + scattered distant objects
		for ( let r = 0; r < 8; r ++ ) {

			const t = 0.015 + Math.random() * 0.08;
			const idx = Math.floor( t * sr );
			data[ idx ] += ( Math.random() * 2 - 1 ) * ( 0.5 - r * 0.05 );

		}

		// Diffuse tail: lowpassed noise, exponential decay
		let lp = 0;
		const lpCoeff = 1 - Math.exp( - 2 * Math.PI * 2200 / sr );
		const start = Math.floor( 0.05 * sr );

		for ( let i = start; i < length; i ++ ) {

			const t = ( i - start ) / sr;
			lp += ( Math.random() * 2 - 1 - lp ) * lpCoeff;
			data[ i ] += lp * Math.exp( - t / 0.32 ) * 0.35;

		}

	}

	return buffer;

}

export class GameAudio {

	constructor() {

		this.listener = null;
		this.target = null;
		this.reverbSend = null;
		this.impactReverbSend = null;
		this.engineReverbSend = null;
		this.engineGain = null;
		this.engineRpmParam = null;
		this.engineLoadParam = null;
		this.skidSound = null;
		this.skidTone = null;
		this.impactBuffers = [];
		this.impactPlayers = [];
		this.impactIndex = 0;
		this.worldImpactPlayers = [];
		this.worldImpactIndex = 0;
		this.distanceFilters = [];
		this.unlocked = false;
		this.paused = false;

		this.rpm = 0;
		this.gear = 0;
		this.shiftCooldown = 0;

	}

	// `target` is the object the sounds live on (the vehicle container):
	// every source is a PositionalAudio child of it, panned and attenuated
	// relative to the camera-mounted listener.
	// `scene` holds the anchors for sounds that play where they happen
	// (opponents hitting each other or a wall).
	init( camera, target, scene ) {

		this.listener = new THREE.AudioListener();
		camera.add( this.listener );

		this.target = target;
		this.scene = scene;

		// Shared outdoor reverb: sources send into one convolver. Impacts get
		// a hotter send — a crash reads as "in the world" mainly through its
		// environmental tail, which a brief transient otherwise barely excites.
		const ctx = this.listener.context;
		const convolver = ctx.createConvolver();
		convolver.buffer = createOutdoorIR( ctx );
		convolver.connect( this.listener.getInput() );

		this.reverbSend = ctx.createGain();
		this.reverbSend.gain.value = 0.15;
		this.reverbSend.connect( convolver );

		this.impactReverbSend = ctx.createGain();
		this.impactReverbSend.gain.value = 0.35;
		this.impactReverbSend.connect( convolver );

		this.engineReverbSend = ctx.createGain();
		this.engineReverbSend.gain.value = 0.11;
		this.engineReverbSend.connect( convolver );

		this.initEngine().catch( ( e ) => {

			console.warn( 'Engine synth unavailable:', e );

		} );

		this.initSurface();

		// Skid loop: sample player with a tone filter that opens as the
		// drift intensifies
		const skid = this.createSampleSource( this.reverbSend );
		this.skidSound = skid.sound;
		this.skidTone = skid.tone;

		// Collision one-shots: two hardness sets of three seeded variations
		// each (soft knocks dully, hard crunches). Three shared players swap
		// in a random buffer per hit and add rate/tone variation on top.
		for ( let i = 0; i < 3; i ++ ) this.impactBuffers.push( createImpactBuffer( ctx, i + 1, 0.4 ) );
		for ( let i = 0; i < 3; i ++ ) this.impactBuffers.push( createImpactBuffer( ctx, i + 4, 1.0 ) );
		for ( let i = 0; i < 3; i ++ ) this.impactPlayers.push( this.createSampleSource( this.impactReverbSend ) );
		for ( let i = 0; i < 4; i ++ ) this.worldImpactPlayers.push( this.createWorldSource( this.impactReverbSend ) );

		const loader = new THREE.AudioLoader();

		loader.load( SKID_URL, ( buffer ) => {

			this.skidSound.setBuffer( buffer );
			this.skidSound.setLoop( true );
			this.skidSound.setVolume( 0 );

			if ( this.unlocked ) this.startSounds();

		} );

		const unlock = () => {

			if ( this.unlocked ) return;
			this.unlocked = true;

			if ( ctx.state === 'suspended' ) ctx.resume();

			this.startSounds();

			window.removeEventListener( 'keydown', unlock );
			window.removeEventListener( 'click', unlock );
			window.removeEventListener( 'touchstart', unlock );

		};

		window.addEventListener( 'keydown', unlock );
		window.addEventListener( 'click', unlock );
		window.addEventListener( 'touchstart', unlock );

		// init() may run after the first gesture (main.js defers it past the
		// start screen); sticky activation still allows resuming then
		if ( navigator.userActivation && navigator.userActivation.hasBeenActive ) unlock();

		// Pause all audio when the tab is hidden; resume once it's visible
		// again (only if the user has already interacted to unlock playback).
		document.addEventListener( 'visibilitychange', () => {

			if ( document.hidden ) {

				if ( ctx.state === 'running' ) ctx.suspend();

			} else if ( this.unlocked && ! this.paused && ctx.state === 'suspended' ) {

				ctx.resume();

			}

		} );

	}

	// The player's tyres on the kerbs (a buzzing rumble that rises with
	// speed) and on gravel (filtered noise, a crunch). Silent until set.
	initSurface() {

		const ctx = this.listener.context;

		this.rumble = ctx.createOscillator();
		this.rumble.type = 'sawtooth';
		this.rumble.frequency.value = 40;
		const rumbleTone = ctx.createBiquadFilter();
		rumbleTone.type = 'lowpass';
		rumbleTone.frequency.value = 260;
		this.rumbleGain = ctx.createGain();
		this.rumbleGain.gain.value = 0;
		this.rumble.connect( rumbleTone ).connect( this.rumbleGain ).connect( this.listener.getInput() );

		const noise = ctx.createBuffer( 1, ctx.sampleRate, ctx.sampleRate );
		const data = noise.getChannelData( 0 );
		for ( let i = 0; i < data.length; i ++ ) data[ i ] = Math.random() * 2 - 1;
		this.crunch = ctx.createBufferSource();
		this.crunch.buffer = noise;
		this.crunch.loop = true;
		const crunchTone = ctx.createBiquadFilter();
		crunchTone.type = 'bandpass';
		crunchTone.frequency.value = 1600;
		crunchTone.Q.value = 0.8;
		this.crunchGain = ctx.createGain();
		this.crunchGain.gain.value = 0;
		this.crunch.connect( crunchTone ).connect( this.crunchGain ).connect( this.listener.getInput() );

	}

	// kerb: 0–1 of the car on the kerbs; gravel: on gravel; speed: m/s
	setSurface( kerb, gravel, speed ) {

		if ( ! this.rumbleGain || ! this.unlocked ) return;

		const t = this.listener.context.currentTime;
		const pace = Math.min( 1, speed / 12 );
		this.rumble.frequency.setTargetAtTime( 28 + speed * 4, t, 0.05 );
		this.rumbleGain.gain.setTargetAtTime( this.paused ? 0 : kerb * pace * 0.22, t, 0.03 );
		this.crunchGain.gain.setTargetAtTime( this.paused || ! gravel ? 0 : pace * 0.12, t, 0.05 );

	}

	async initEngine() {

		const ctx = this.listener.context;

		// Blob URL normally; a file:// page (the offline build) has an opaque
		// origin that rejects blob:null worklets, so fall back to a data: URL
		const blob = new Blob( [ engineWorkletSource ], { type: 'text/javascript' } );
		const url = URL.createObjectURL( blob );

		try {

			await ctx.audioWorklet.addModule( url );

		} catch {

			await ctx.audioWorklet.addModule( 'data:text/javascript,' + encodeURIComponent( engineWorkletSource ) );

		} finally {

			URL.revokeObjectURL( url );

		}

		const node = new AudioWorkletNode( ctx, 'engine-sound', {
			numberOfInputs: 0,
			outputChannelCount: [ 1 ],
		} );

		this.engineGain = ctx.createGain();
		this.engineGain.gain.value = 0;
		node.connect( this.engineGain );

		// Fairly present: a moderate reference distance, a fixed high-end
		// rolloff instead of the environment's distance-driven lowpass, and a
		// light reverb send. It pans with the car but sits a little back.
		const tone = this.neutralLowpass();
		tone.frequency.value = ENGINE_CUTOFF;

		const audio = new THREE.PositionalAudio( this.listener );
		audio.setRefDistance( ENGINE_REF_DISTANCE );
		audio.panner.panningModel = 'equalpower';
		audio.setFilter( tone );
		audio.setNodeSource( this.engineGain );
		this.target.add( audio );

		this.engineGain.connect( this.engineReverbSend );

		this.engineRpmParam = node.parameters.get( 'rpm' );
		this.engineLoadParam = node.parameters.get( 'load' );

	}

	// A transparent-until-driven lowpass. filters[0] on each source is the
	// perspective/distance filter; sample sources add a second for tone.
	neutralLowpass() {

		const filter = this.listener.context.createBiquadFilter();
		filter.type = 'lowpass';
		filter.Q.value = 0.0001;
		filter.frequency.value = 24000;

		return filter;

	}

	// Positional source on the vehicle. filters[0] is registered as the
	// distance filter; it must be set before the source connects.
	makePositional( filters ) {

		const audio = new THREE.PositionalAudio( this.listener );
		audio.setRefDistance( REF_DISTANCE );
		audio.panner.panningModel = 'equalpower';
		audio.setFilters( filters );
		this.distanceFilters.push( filters[ 0 ] );
		this.target.add( audio );

		return audio;

	}

	// Sample player: distance filter + a tone filter for per-sound variation,
	// reverb tapped post-gain so the send tracks the sound's own volume.
	createSampleSource( reverbSend ) {

		const tone = this.neutralLowpass();
		const audio = this.makePositional( [ this.neutralLowpass(), tone ] );
		audio.gain.connect( reverbSend );

		return { sound: audio, tone };

	}

	// A sample player at a point in the world (moved per sound), with its own
	// distance filter, set when it plays
	createWorldSource( reverbSend ) {

		const anchor = new THREE.Object3D();
		this.scene.add( anchor );

		const distance = this.neutralLowpass();
		const tone = this.neutralLowpass();
		const audio = new THREE.PositionalAudio( this.listener );
		audio.setRefDistance( REF_DISTANCE );
		audio.panner.panningModel = 'equalpower';
		audio.setFilters( [ distance, tone ] );
		audio.gain.connect( reverbSend );
		anchor.add( audio );

		return { sound: audio, tone, distance, anchor };

	}

	// Start-light beep: short square blip, GO is higher and longer
	beep( frequency, duration ) {

		if ( ! this.unlocked || this.paused ) return;

		const ctx = this.listener.context;
		const t = ctx.currentTime;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();

		osc.type = 'square';
		osc.frequency.value = frequency;
		gain.gain.setValueAtTime( 0.0001, t );
		gain.gain.exponentialRampToValueAtTime( 0.08, t + 0.01 );
		gain.gain.setValueAtTime( 0.08, t + duration * 0.7 );
		gain.gain.exponentialRampToValueAtTime( 0.0001, t + duration );

		osc.connect( gain ).connect( this.listener.getInput() );
		osc.start( t );
		osc.stop( t + duration + 0.05 );

	}

	// The magic wand: a rising sparkle of sine bells. volume: 1 for the
	// player's car, less for others further away.
	chime( volume = 1 ) {

		if ( ! this.unlocked || this.paused || volume < 0.03 ) return;

		const ctx = this.listener.context;
		const t0 = ctx.currentTime;

		[ 1319, 1568, 1976, 2637 ].forEach( ( frequency, i ) => {

			const t = t0 + i * 0.07;
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();

			osc.type = 'sine';
			osc.frequency.value = frequency;
			gain.gain.setValueAtTime( 0.0001, t );
			gain.gain.exponentialRampToValueAtTime( 0.06 * volume, t + 0.01 );
			gain.gain.exponentialRampToValueAtTime( 0.0001, t + 0.6 );

			osc.connect( gain ).connect( this.listener.getInput() );
			osc.start( t );
			osc.stop( t + 0.65 );

		} );

	}

	startSounds() {

		if ( this.skidSound.buffer && ! this.skidSound.isPlaying ) this.skidSound.play();

		if ( this.rumble && ! this.surfaceStarted ) {

			this.surfaceStarted = true;
			this.rumble.start();
			this.crunch.start();

		}

	}

	update( dt, speed, throttle, driftIntensity ) {

		if ( ! this.listener ) return;

		const absSpeed = THREE.MathUtils.clamp( Math.abs( speed ), 0, 1 );
		// Only forward throttle counts as engine load. Brake/reverse (throttle < 0)
		// should let RPM fall so downshifts can fire as the car decelerates.
		const load = THREE.MathUtils.clamp( Math.max( 0, throttle ), 0, 1 );

		const gearWindow = 1 / NUM_GEARS;
		const gearStart = this.gear * gearWindow;
		const inGear = THREE.MathUtils.clamp( ( absSpeed - gearStart ) / gearWindow, 0, 1 );

		let targetRpm = inGear * 0.85 + load * 0.2;
		targetRpm = THREE.MathUtils.clamp( targetRpm, 0, 1.05 );

		// Rise rate is deliberately gentle so each gear holds long enough to be
		// audible given the car's ~1.5s 0→max acceleration curve.
		const riseRate = 4;
		const fallRate = 4;
		const rate = targetRpm > this.rpm ? ( riseRate * ( 0.3 + load ) ) : fallRate;
		this.rpm = THREE.MathUtils.lerp( this.rpm, targetRpm, Math.min( 1, dt * rate ) );

		this.shiftCooldown = Math.max( 0, this.shiftCooldown - dt );

		if ( this.shiftCooldown === 0 ) {

			if ( this.rpm > UPSHIFT_RPM && this.gear < NUM_GEARS - 1 && load > 0.1 ) {

				this.gear ++;
				this.rpm = 0.45;
				this.shiftCooldown = SHIFT_COOLDOWN;

			} else if ( this.rpm < DOWNSHIFT_RPM && this.gear > 0 ) {

				this.gear --;
				this.rpm = 0.78;
				this.shiftCooldown = SHIFT_COOLDOWN;

			}

		}

		const now = this.listener.context.currentTime;

		// Perspective filtering: all sources sit on the car, so one distance
		// drives every filter
		this.listener.getWorldPosition( _listenerPos );
		this.target.getWorldPosition( _targetPos );
		const cutoff = distanceCutoff( _listenerPos.distanceTo( _targetPos ) );

		for ( const filter of this.distanceFilters ) {

			filter.frequency.setTargetAtTime( cutoff, now, 0.1 );

		}

		if ( this.engineRpmParam ) {

			// Cut throttle at the start of each shift so the synth sputters
			const shifting = this.shiftCooldown > SHIFT_COOLDOWN - SHIFT_CUT;

			this.engineRpmParam.value = RPM_IDLE + ( RPM_MAX - RPM_IDLE ) * this.rpm;
			this.engineLoadParam.value = shifting ? 0 : load;

			const targetVol = remap( absSpeed + load * 0.5, 0, 1.5, 0.06, 0.3 );
			this.engineGain.gain.setTargetAtTime( targetVol, now, 0.08 );

		}

		if ( this.skidSound.buffer ) {

			const shouldSkid = driftIntensity > 0.5;
			let skidVol = 0;

			if ( shouldSkid ) {

				skidVol = remap(
					THREE.MathUtils.clamp( driftIntensity, 0.5, 2.0 ),
					0.5, 2.0, 0.08, 0.35
				);

			}

			this.skidSound.gain.gain.setTargetAtTime( skidVol, now, 0.05 );

			const skidPitch = THREE.MathUtils.clamp( Math.abs( speed ), 1, 3 );
			const curPitch = this.skidSound.getPlaybackRate();
			this.skidSound.setPlaybackRate( THREE.MathUtils.lerp( curPitch, skidPitch, 1 - Math.pow( 0.9, dt * 60 ) ) );

			// Tone opens as the drift digs in: light slides stay dull,
			// hard drifts scream
			const intensity01 = THREE.MathUtils.clamp(
				remap( driftIntensity, 0.5, 1.6, 0, 1 ), 0, 1
			);
			this.skidTone.frequency.setTargetAtTime( 2500 + intensity01 * 7500, now, 0.1 );

		}

	}

	// Game pause: silence everything (the context also suspends while the tab
	// is hidden, and must stay suspended on return if the game is paused)
	setPaused( paused ) {

		this.paused = paused;
		if ( ! this.listener ) return;
		const ctx = this.listener.context;

		if ( paused ) {

			if ( ctx.state === 'running' ) ctx.suspend();

		} else if ( this.unlocked && ctx.state === 'suspended' ) {

			ctx.resume();

		}

	}

	// position: where it happened, for hits away from the player's car
	playImpact( impactVelocity, position = null ) {

		if ( ! this.unlocked ) return;

		// Round-robin a player; swap in a random buffer from the soft or hard
		// set so repeated hits of the same strength still differ.
		let player;

		if ( position ) {

			player = this.worldImpactPlayers[ this.worldImpactIndex ++ % this.worldImpactPlayers.length ];
			player.anchor.position.copy( position );
			player.anchor.updateMatrixWorld( true );
			this.listener.getWorldPosition( _listenerPos );
			player.distance.frequency.value = distanceCutoff( _listenerPos.distanceTo( position ) );

		} else {

			player = this.impactPlayers[ this.impactIndex ++ % this.impactPlayers.length ];

		}

		const { sound, tone } = player;

		const set = impactVelocity < IMPACT_HARD_VELOCITY ? 0 : 3;
		const buffer = this.impactBuffers[ set + ( Math.random() * 3 | 0 ) ];

		if ( sound.isPlaying ) sound.stop();
		sound.setBuffer( buffer );

		const volume = THREE.MathUtils.clamp(
			remap( impactVelocity, 0, IMPACT_MAX_VELOCITY, 0.01, 1.0 ), 0.01, 1.0 );
		sound.setVolume( volume );

		// Variation on top of the seeded buffers: pitch jitter per hit,
		// tone tracks hit strength
		sound.setPlaybackRate( 0.9 + Math.random() * 0.2 );

		const brightness = THREE.MathUtils.clamp( impactVelocity / IMPACT_MAX_VELOCITY, 0, 1 );
		tone.frequency.value = ( 2500 + brightness * 9000 ) * ( 0.8 + Math.random() * 0.4 );

		sound.play();

		// PositionalAudio only tracks the panner while playing, so a one-shot
		// otherwise starts at a stale position. Snap it to the car now that
		// it's playing, so the crash attack is localised from the first sample.
		sound.updateMatrixWorld( true );

	}

}
