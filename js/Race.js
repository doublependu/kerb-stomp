import * as THREE from 'three';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, updateWorld, rigidBody, box, MotionType } from 'crashcat';
import { Vehicle } from './Vehicle.js';
import { buildWallColliders, createSphereBody } from './Physics.js';
import { computeTrackBounds, computeSpawnPosition, TRACK_CELLS } from './Track.js';
import { CELL } from './TrackPath.js';
import { LapCounter } from './LapTimer.js';
import { resolveCarCollisions } from './CarCollisions.js';
import { RUBBER_BAND, CLASSIC_AI_LAPS, correct, startFor } from './Difficulty.js';

// The simulation: physics world, cars, laps and race order. No rendering or
// DOM, so scripts/sim can run whole races in Node; main.js draws it.
//
// Modes: 'timetrial' (one car, endless laps, the clock starts on the first
// input, as the game always was) and 'race' (a grid, a countdown, N laps).
// Phases: 'grid' → 'countdown' → 'racing' → 'done'.

export const STEP = 1 / 60;
export const COUNTDOWN = 3;

// After the player finishes, wait this long for the rest before calling it
const FINISH_GRACE = 15;
const GHOST_TIME = 1.5;

function wrapHalf( d, length ) {

	return d - Math.round( d / length ) * length;

}

export class Race {

	constructor( { cells, line, classic = false, ai = CLASSIC_AI_LAPS } ) {

		this.cells = cells;
		this.line = line;
		this.classic = classic;
		this.ai = ai;

		this.mode = 'timetrial';
		this.phase = 'grid';
		this.laps = 3;
		this.time = 0;
		this.countdown = 0;
		this.finishOrder = [];
		this.playerFinishedAt = null;

		// The lap the NPC field is aimed at (aimField). Not measured: the
		// track's par, or the player's laps in their first race here.
		this.reference = null;
		this.referenceMeasured = false;

		this.cars = [];
		this.player = null;

		this.onCarHit = ( a, b, speed, x, z ) => {

			a.carHits ++;
			b.carHits ++;
			if ( this.events.onCarHit ) this.events.onCarHit( a, b, speed, x, z );

		};

		// onLap( car ), onFinish( car ), onWallHit( car, speed, ground ),
		// onCarHit( a, b, speed, x, z )
		this.events = {};

		// The finish line sits mid-cell; the centerline starts at the cell's
		// entry edge (TrackPath.centerline)
		this.lineS = CELL / 2;

		// Time trial on the Starter Kit track keeps its original spawn
		this.spawn = classic && cells === TRACK_CELLS
			? { position: [ 3.5, 0.5, 5 ], angle: 0 }
			: computeSpawnPosition( cells );

		this.buildWorld();

	}

	buildWorld() {

		const settings = createWorldSettings();
		settings.gravity = [ 0, - 9.81, 0 ];

		const BPL_MOVING = addBroadphaseLayer( settings );
		const BPL_STATIC = addBroadphaseLayer( settings );
		const OL_MOVING = addObjectLayer( settings, BPL_MOVING );
		const OL_STATIC = addObjectLayer( settings, BPL_STATIC );

		// Cars only meet walls and ground through physics; car-to-car contact
		// is CarCollisions, sized to each model
		enableCollision( settings, OL_MOVING, OL_STATIC );

		const world = createWorld( settings );
		world._OL_MOVING = OL_MOVING;
		world._OL_STATIC = OL_STATIC;

		buildWallColliders( world, null, this.cells );

		const bounds = computeTrackBounds( this.classic ? null : this.cells );
		const groundHalf = Math.max( bounds.halfWidth, bounds.halfDepth ) + 10;

		this.groundBody = rigidBody.create( world, {
			shape: box.create( { halfExtents: [ groundHalf, 0.01, groundHalf ] } ),
			motionType: MotionType.STATIC,
			objectLayer: OL_STATIC,
			position: [ bounds.centerX, - 0.125, bounds.centerZ ],
			friction: 5.0,
			restitution: 0.0,
		} );

		this.world = world;
		this.bodies = new Map();

		this.contactListener = {
			onContactAdded: ( bodyA, bodyB ) => {

				const car = this.bodies.get( bodyA ) || this.bodies.get( bodyB );
				if ( ! car || ! this.events.onWallHit ) return;

				const other = this.bodies.get( bodyA ) ? bodyB : bodyA;
				const v = car.vehicle;
				const impact = Math.abs( v.modelVelocity.x * car.forward.x + v.modelVelocity.z * car.forward.z );
				this.events.onWallHit( car, impact, other === this.groundBody );

			},
		};

	}

	// def: a CarList entry. model: the loaded model (a stub with named nodes
	// is enough for the sim). driver: an AIDriver, or null for the player.
	addCar( def, model, { player = false, driver = null, name = def.name } = {} ) {

		const vehicle = new Vehicle();
		vehicle.rigidBody = createSphereBody( this.world, this.spawn.position );
		vehicle.physicsWorld = this.world;
		vehicle.spawnPosition = this.spawn.position;
		vehicle.spawnAngle = this.spawn.angle;
		vehicle.init( model, def.bodyY );

		const car = {
			def,
			name,
			vehicle,
			driver,
			player,
			counter: new LapCounter( this.cells ),
			forward: new THREE.Vector3( 0, 0, 1 ),
			proj: { s: 0, lateral: 0, index: null },
			distance: 0,
			finished: false,
			finishTime: null,
			ghost: 0,
			wallHits: 0,
			carHits: 0,
			respawns: 0,
			paceFactor: null, // NPCs: target lap ÷ reference (Difficulty.planField)
			targetLap: null,
			lapTimes: [],
			prevPosition: new THREE.Vector3(),
			prevQuaternion: new THREE.Quaternion(),
		};

		vehicle.onFall = () => this.respawn( car );

		this.cars.push( car );
		this.bodies.set( vehicle.rigidBody, car );
		if ( player ) this.player = car;

		this.place( car, this.spawn.position, this.spawn.angle );

		return car;

	}

	removeCar( car ) {

		rigidBody.remove( this.world, car.vehicle.rigidBody );
		this.bodies.delete( car.vehicle.rigidBody );
		this.cars.splice( this.cars.indexOf( car ), 1 );

	}

	place( car, position, angle ) {

		car.vehicle.resetTo( position, angle );
		car.vehicle.resets --;
		car.prevPosition.copy( car.vehicle.container.position );
		car.prevQuaternion.copy( car.vehicle.container.quaternion );
		car.forward.set( Math.sin( angle ), 0, Math.cos( angle ) );
		car.proj = this.line.project( position[ 0 ], position[ 2 ] );
		car.distance = this.line.closed ? wrapHalf( car.proj.s - this.lineS, this.line.length ) : car.proj.s - this.lineS;

	}

	// Line up for a new session. order: cars front to back.
	setup( mode, order = this.cars, laps = this.laps ) {

		this.mode = mode;
		this.laps = laps;
		this.phase = mode === 'race' ? 'grid' : 'racing';
		this.time = 0;
		this.finishOrder = [];
		this.playerFinishedAt = null;

		for ( const car of this.cars ) {

			car.counter.reset();
			car.finished = false;
			car.finishTime = null;
			car.ghost = 0;
			car.wallHits = 0;
			car.carHits = 0;
			car.respawns = 0;
			car.lapTimes = [];
			if ( car.driver ) car.driver.reset();

		}

		if ( mode === 'timetrial' ) {

			for ( const car of this.cars ) this.place( car, this.spawn.position, this.spawn.angle );
			return;

		}

		// Two staggered columns behind the line, along the centerline, spaced
		// for the longest car
		const row = Math.max( 2.4, Math.max( ...order.map( ( c ) => c.def.length ) ) + 1.1 );
		const p = [ 0, 0 ];

		order.forEach( ( car, i ) => {

			const s = this.lineS - 2.2 - Math.floor( i / 2 ) * row - ( i % 2 ) * row / 2;
			const lateral = i % 2 ? - 1.4 : 1.4;
			const dir = this.line.directionAt( s );
			this.line.pointAt( s, p );

			this.place( car, [ p[ 0 ] - Math.cos( dir ) * lateral, 0.5, p[ 1 ] + Math.sin( dir ) * lateral ], dir );

		} );

	}

	start() {

		if ( this.mode === 'race' ) {

			this.phase = 'countdown';
			this.countdown = COUNTDOWN;

		}

	}

	// Put a car back on the centerline where it left it, facing forward,
	// briefly ghosted so it can't land on someone
	respawn( car ) {

		const s = car.proj.s;
		const p = this.line.pointAt( s );
		const dir = this.line.directionAt( s );
		const distance = car.distance;

		if ( this.mode === 'timetrial' && ! this.line.closed ) {

			car.vehicle.reset();

		} else {

			car.vehicle.resetTo( [ p[ 0 ], 0.5, p[ 1 ] ], dir );

		}

		car.forward.set( Math.sin( dir ), 0, Math.cos( dir ) );
		car.ghost = GHOST_TIME;
		car.distance = distance;
		car.respawns ++;
		if ( car.driver ) car.driver.reset();

		// Keep the lap counter from seeing a jump over the line as a crossing
		car.counter.prevForwardProj = null;

	}

	step( playerInput ) {

		const dt = STEP;
		const cars = this.cars;

		for ( const car of cars ) {

			car.prevPosition.copy( car.vehicle.container.position );
			car.prevQuaternion.copy( car.vehicle.container.quaternion );

		}

		if ( this.phase === 'countdown' ) {

			this.countdown -= dt;

			if ( this.countdown <= 0 ) {

				this.phase = 'racing';
				for ( const car of cars ) car.counter.running = true;

			}

		}

		const moving = this.phase === 'racing' || this.phase === 'done';

		updateWorld( this.world, this.contactListener, dt );

		if ( moving ) resolveCarCollisions( this.world, cars, this.onCarHit );

		this.rubberBand();

		for ( const car of cars ) {

			let input = NO_INPUT;

			if ( moving ) {

				if ( car.driver ) input = car.driver.drive( car, cars, dt, this.time );
				else if ( car.player ) input = playerInput;

			}

			car.vehicle.update( dt, input );
			car.forward.set( 0, 0, 1 ).applyQuaternion( car.vehicle.container.quaternion );
			car.forward.y = 0;
			car.forward.normalize();

			this.track( car, input );

			if ( car.ghost > 0 ) car.ghost = Math.max( 0, car.ghost - dt );
			if ( car.driver && car.driver.wantsRespawn ) this.respawn( car );

		}

		if ( moving ) this.time += dt;

		if ( this.mode === 'race' && this.phase === 'racing' ) {

			const everyone = cars.every( ( c ) => c.finished );
			const waited = this.playerFinishedAt !== null && this.time - this.playerFinishedAt > FINISH_GRACE;
			if ( everyone || waited ) this.phase = 'done';

		}

	}

	track( car, input ) {

		const v = car.vehicle;
		const prevS = car.proj.s;
		car.proj = this.line.project( v.spherePos.x, v.spherePos.z, car.proj.index );
		car.distance += this.line.closed ? wrapHalf( car.proj.s - prevS, this.line.length ) : car.proj.s - prevS;

		const counter = car.counter;

		// Time trial: the clock starts with the first input, as it always has
		if ( this.mode === 'timetrial' && ! counter.running ) {

			const hasInput = input.mode === 'world' ? input.x !== 0 || input.z !== 0 : Math.abs( input.x ) > 0.05 || Math.abs( input.z ) > 0.05;
			if ( hasInput ) counter.running = true;

		}

		if ( car.finished ) return;

		if ( counter.update( STEP, v.spherePos ) ) {

			car.lapTimes.push( counter.lastLap );
			this.adjustPace( car );

			// First race on a track (the field aimed at par): the field follows
			// the player's laps, the first one either way, then their best.
			// Later races keep the best lap they started from.
			if ( car.player && this.mode === 'race' && this.reference !== null && ! this.referenceMeasured && ( car.lapTimes.length === 1 || counter.lastLap < this.reference ) ) {

				this.aimField( counter.lastLap, false );

			}

			if ( this.events.onLap ) this.events.onLap( car );

			if ( this.mode === 'race' && counter.lap > this.laps ) {

				car.finished = true;
				car.finishTime = this.time;
				this.finishOrder.push( car );
				if ( car.player ) this.playerFinishedAt = this.time;
				if ( this.events.onFinish ) this.events.onFinish( car );

			}

		}

	}

	// Aim the NPCs at a reference lap: each targets its pace factor of it, and
	// restarts from the skill and pace the calibration gives for that
	aimField( reference, measured = true ) {

		this.reference = reference;
		this.referenceMeasured = measured;

		for ( const car of this.cars ) {

			if ( car.player || car.paceFactor === null ) continue;

			car.targetLap = car.paceFactor * reference;
			const start = startFor( car.targetLap, this.ai );
			car.driver.setSkill( start.skill );
			car.driver.pace = start.pace;

		}

	}

	// NPCs with a target lap time: after each flying lap, nudge the pace
	// toward the target (lap 1 includes the standing start)
	adjustPace( car ) {

		const driver = car.driver;
		if ( ! driver || car.player || car.targetLap === null || car.lapTimes.length < 2 ) return;

		correct( driver, car.counter.lastLap, car.targetLap );

	}

	// A few % of pace from the gap to the player: NPCs well ahead ease off,
	// ones well behind push, so the field stays in reach without it being
	// obvious. Off once the player has finished.
	rubberBand() {

		const player = this.player;
		const active = this.mode === 'race' && this.phase === 'racing' && player && ! player.finished;

		for ( const car of this.cars ) {

			if ( ! car.driver || car.player ) continue;
			car.driver.boost = active ? Math.max( - 1, Math.min( 1, ( player.distance - car.distance ) / 40 ) ) * RUBBER_BAND : 0;

		}

	}

	// Race order: finishers by finishing order, then by distance covered
	standings() {

		return this.cars.slice().sort( ( a, b ) => {

			if ( a.finished || b.finished ) {

				if ( a.finished && b.finished ) return a.finishTime - b.finishTime;
				return a.finished ? - 1 : 1;

			}

			return b.distance - a.distance;

		} );

	}

	position( car ) {

		return this.standings().indexOf( car ) + 1;

	}

}

const NO_INPUT = { x: 0, z: 0, mode: 'car' };
