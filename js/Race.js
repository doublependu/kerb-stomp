import * as THREE from 'three';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, updateWorld, rigidBody, box, MotionType } from 'crashcat';
import { Vehicle } from './Vehicle.js';
import { buildWallColliders, buildHillColliders, createSphereBody } from './Physics.js';
import { TrackShape, GROUND_Y, STRIP_IN, KERB_IN } from './TrackShape.js';
import { computeTrackBounds, computeSpawnPosition, TRACK_CELLS } from './Track.js';
import { CELL } from './TrackPath.js';
import { LapCounter } from './LapTimer.js';
import { resolveCarCollisions } from './CarCollisions.js';
import { RUBBER_BAND, CLASSIC_AI_LAPS, FIRST_LAP, ACES, correct, startFor, lean } from './Difficulty.js';
import { racingLine } from './RacingLine.js';

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

// The magic wand: a car that leaves the track (or falls, gets stuck, or
// ends up on its roof) is out for a moment, then lifted and flown back to
// where it last was on the road while everyone else keeps racing
const OUT_BEYOND = 1.5; // m past the road's edge
const OUT_BELOW = 2; // m under the road surface
const OUT_TIME = 0.5;
const FALL_TIME = 1;
const CARRY_TIME = 1.3;
const CARRY_BACK = 3; // m behind where it left the road
const FLIPPED_TIME = 0.7;

// Drag (share of speed per second) from the road's edges: the rumble strip
// and the red-and-white kerb, by wheels on them (kerb counts double), and
// gravel. Heavier cars plough through a little better (÷ √mass).
export const SURFACE = { kerb: 0.8, gravel: 0.3 };
const WHEELS = [ [ 1, 1 ], [ 1, - 1 ], [ - 1, 1 ], [ - 1, - 1 ] ];

function wrapHalf( d, length ) {

	return d - Math.round( d / length ) * length;

}

export class Race {

	constructor( { cells, line, shape = null, classic = false, ai = CLASSIC_AI_LAPS } ) {

		this.cells = cells;
		this.line = line;
		this.shape = shape || new TrackShape( { cells }, line );
		this.racing = racingLine( line, this.shape );
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
		const OL_CARRIED = addObjectLayer( settings, BPL_MOVING ); // collides with nothing

		// Cars only meet walls and ground through physics; car-to-car contact
		// is CarCollisions, sized to each model
		enableCollision( settings, OL_MOVING, OL_STATIC );

		const world = createWorld( settings );
		world._OL_MOVING = OL_MOVING;
		world._OL_STATIC = OL_STATIC;
		world._OL_CARRIED = OL_CARRIED;

		const hills = this.shape.hilly ? buildHillColliders( world, this.shape ) : null;
		if ( ! hills ) buildWallColliders( world, null, this.cells );

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
		this.groundBodies = new Set( [ this.groundBody, ...( hills || [] ) ] );

		this.contactListener = {
			onContactAdded: ( bodyA, bodyB ) => {

				const car = this.bodies.get( bodyA ) || this.bodies.get( bodyB );
				if ( ! car || ! this.events.onWallHit ) return;

				const other = this.bodies.get( bodyA ) ? bodyB : bodyA;
				const v = car.vehicle;
				const impact = Math.abs( v.modelVelocity.x * car.forward.x + v.modelVelocity.z * car.forward.z );
				this.events.onWallHit( car, impact, this.groundBodies.has( other ) );

			},
		};

	}

	// def: a CarList entry. model: the loaded model (a stub with named nodes
	// is enough for the sim). driver: an AIDriver, or null for the player.
	addCar( def, model, { player = false, driver = null, name = def.name } = {} ) {

		const vehicle = new Vehicle();
		vehicle.rigidBody = createSphereBody( this.world, this.spawn.position );
		vehicle.physicsWorld = this.world;
		vehicle.setMass( def.mass ?? 1 );
		vehicle.spawnPosition = this.spawn.position;
		vehicle.spawnAngle = this.spawn.angle;
		vehicle.init( model, def.bodyY );

		const car = {
			def,
			name,
			vehicle,
			driver,
			player,
			counter: Object.assign( new LapCounter( this.cells ), { allowMissing: this.shape.unsealed.size ? 2 : 0 } ),
			forward: new THREE.Vector3( 0, 0, 1 ),
			proj: { s: 0, lateral: 0, index: null },
			distance: 0,
			finished: false,
			finishTime: null,
			ghost: 0,
			wallHits: 0,
			carHits: 0,
			respawns: 0,
			outTime: 0, // how long it's been off the track
			kerb: 0, // 0–1: how much of the car is on the kerbs this step
			gravel: false,
			carry: null, // the wand's flight while it's carried
			lastGood: { s: 0, lateral: 0, distance: 0, index: null }, // last spot on the road
			onRoad: true,
			groundHeight: GROUND_Y,
			paceFactor: null, // NPCs: target lap ÷ reference (Difficulty.planField)
			targetLap: null,
			ace: false, // held at its target lap (Difficulty.ACES)
			lapTimes: [],
			prevPosition: new THREE.Vector3(),
			prevQuaternion: new THREE.Quaternion(),
		};

		vehicle.onFall = () => this.respawn( car );
		if ( driver ) driver.racing = this.racing;

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
		car.carry = null;
		car.outTime = 0;
		this.setCarried( car, false );
		Object.assign( car.lastGood, { s: car.proj.s, lateral: car.proj.lateral, distance: car.distance, index: car.proj.index } );

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
			car.outTime = 0;
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

			this.place( car, [ p[ 0 ] - Math.cos( dir ) * lateral, 0.5 + this.line.heightAt( s ), p[ 1 ] + Math.sin( dir ) * lateral ], dir );

		} );

	}

	start() {

		if ( this.mode === 'race' ) {

			this.phase = 'countdown';
			this.countdown = COUNTDOWN;

		}

	}

	// The magic wand: lift the car out, fly it back to the road and set it
	// down facing forward, ghosted so it can't land on anyone. From the last
	// spot it had on the road (a little behind it), or with inPlace (stuck,
	// on its roof, the R key) from where it is now.
	respawn( car, { inPlace = false } = {} ) {

		if ( car.carry ) return;

		const v = car.vehicle;
		let s, lateral, distance, hint, to, dir;

		if ( this.mode === 'timetrial' && ! this.line.closed ) {

			to = new THREE.Vector3( ...v.spawnPosition );
			dir = v.spawnAngle;
			distance = 0;
			hint = null;

		} else {

			const good = inPlace ? { s: car.proj.s, lateral: car.proj.lateral, distance: car.distance, index: car.proj.index } : car.lastGood;
			const back = inPlace ? 0 : CARRY_BACK;
			s = good.s - back;
			distance = good.distance - back;
			hint = good.index;
			lateral = Math.max( - 2, Math.min( 2, good.lateral ) );
			dir = this.line.directionAt( s );

			const p = this.line.pointAt( s );
			to = new THREE.Vector3( p[ 0 ] - Math.cos( dir ) * lateral, 0.5 + this.line.heightAt( s ), p[ 1 ] + Math.sin( dir ) * lateral );

		}

		car.carry = {
			t: 0,
			from: v.container.position.clone(),
			fromQuaternion: v.container.quaternion.clone(),
			to: to.clone().setY( to.y - SPHERE_RADIUS ),
			sphere: to,
			dir,
			distance,
			hint,
		};

		car.ghost = CARRY_TIME + GHOST_TIME;
		car.outTime = 0;
		car.respawns ++;
		v.resets ++;
		v.linearSpeed = 0;
		v.angularSpeed = 0;
		v.spin = 0;
		this.setCarried( car, true );
		if ( car.driver ) car.driver.reset();
		if ( this.events.onCarry ) this.events.onCarry( car );

	}

	// Out of the physics while carried: no gravity, no contacts
	setCarried( car, carried ) {

		const body = car.vehicle.rigidBody;
		if ( ! body ) return;

		rigidBody.setMotionType( this.world, body, carried ? MotionType.KINEMATIC : MotionType.DYNAMIC, ! carried );
		rigidBody.setObjectLayer( this.world, body, carried ? this.world._OL_CARRIED : this.world._OL_MOVING );
		rigidBody.setLinearVelocity( this.world, body, [ 0, 0, 0 ] );
		rigidBody.setAngularVelocity( this.world, body, [ 0, 0, 0 ] );

	}

	updateCarry( car, dt ) {

		const c = car.carry;
		const v = car.vehicle;
		const container = v.container;

		c.t += dt;
		const u = Math.min( 1, c.t / CARRY_TIME );
		const e = u * u * ( 3 - 2 * u );

		_carryPrev.copy( container.position );
		container.position.lerpVectors( c.from, c.to, e );
		container.position.y += Math.sin( Math.PI * u ) * ( 2.5 + 0.15 * c.from.distanceTo( c.to ) );
		_carryQuaternion.setFromAxisAngle( _up, c.dir );
		container.quaternion.slerpQuaternions( c.fromQuaternion, _carryQuaternion, Math.min( 1, e * 1.4 ) );
		v.modelVelocity.subVectors( container.position, _carryPrev ).divideScalar( dt );
		v.prevModelPos.copy( container.position );

		// Keep the physics sphere with it, out of everyone's way
		rigidBody.setPosition( this.world, v.rigidBody, [ container.position.x, container.position.y + SPHERE_RADIUS, container.position.z ], false );
		v.spherePos.set( container.position.x, container.position.y + SPHERE_RADIUS, container.position.z );
		v.sphereVel.set( 0, 0, 0 );

		if ( u < 1 ) return;

		this.setCarried( car, false );
		v.resetTo( [ c.sphere.x, c.sphere.y, c.sphere.z ], c.dir );
		v.resets --; // counted when the wand came
		car.forward.set( Math.sin( c.dir ), 0, Math.cos( c.dir ) );
		car.proj = this.line.project( c.sphere.x, c.sphere.z, c.hint );
		car.distance = c.distance;
		car.carry = null;
		car.ghost = GHOST_TIME;

		// Keep the lap counter from seeing a jump over the line as a crossing
		car.counter.prevForwardProj = null;

	}

	// Off the track: past the road's edge (over a wall, off a cliff) or
	// fallen well below it. Out long enough, and the wand comes.
	checkOut( car, dt ) {

		const v = car.vehicle;
		const beyond = Math.abs( car.proj.lateral ) - this.shape.roadHalf( car.proj.s );
		const below = GROUND_Y + this.line.heightAt( car.proj.s ) - ( v.spherePos.y - SPHERE_RADIUS );

		if ( beyond <= OUT_BEYOND && below <= OUT_BELOW ) {

			car.outTime = 0;

			if ( car.onRoad && v.grounded && beyond <= 0 ) {

				const good = car.lastGood;
				good.s = car.proj.s;
				good.lateral = car.proj.lateral;
				good.distance = car.distance;
				good.index = car.proj.index;

			}

			return;

		}

		car.outTime += dt;
		if ( car.outTime > ( below > OUT_BELOW ? FALL_TIME : OUT_TIME ) ) this.respawn( car );

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

			if ( car.carry ) {

				this.updateCarry( car, dt );
				if ( car.ghost > 0 ) car.ghost = Math.max( 0, car.ghost - dt );
				continue;

			}

			let input = NO_INPUT;

			if ( moving ) {

				if ( car.driver ) input = car.driver.drive( car, cars, dt, this.time );
				else if ( car.player ) input = playerInput;

			}

			this.ground( car );
			car.vehicle.update( dt, input );
			car.forward.set( 0, 0, 1 ).applyQuaternion( car.vehicle.container.quaternion );
			car.forward.y = 0;
			car.forward.normalize();

			this.track( car, input );
			this.surfaceDrag( car, dt );

			if ( car.ghost > 0 ) car.ghost = Math.max( 0, car.ghost - dt );

			// On its side or roof: the wand rights it where it lies
			car.flipTime = car.vehicle.flipped && car.vehicle.grounded ? ( car.flipTime || 0 ) + dt : 0;

			if ( ( car.driver && car.driver.wantsRespawn ) || car.flipTime > FLIPPED_TIME ) this.respawn( car, { inPlace: true } );
			else if ( moving ) this.checkOut( car, dt );

		}

		if ( moving ) this.time += dt;

		if ( this.mode === 'race' && this.phase === 'racing' ) {

			const everyone = cars.every( ( c ) => c.finished );
			const waited = this.playerFinishedAt !== null && this.time - this.playerFinishedAt > FINISH_GRACE;
			if ( everyone || waited ) this.phase = 'done';

		}

	}

	// Kerbs and gravel slow the car (SURFACE); car.kerb and car.gravel are
	// for the rumble and the dust
	surfaceDrag( car, dt ) {

		const v = car.vehicle;
		car.kerb = 0;
		car.gravel = false;
		v.judder = 0;
		if ( ! v.grounded || ! car.onRoad ) return;

		const s = car.proj.s;

		if ( this.shape.isUnsealed( s ) ) {

			car.gravel = true;
			v.linearSpeed *= Math.max( 0, 1 - SURFACE.gravel * dt / Math.sqrt( v.mass ) );
			return;

		}

		const dir = this.line.directionAt( s );
		const lx = - Math.cos( dir ), lz = Math.sin( dir );
		const f = car.forward;
		const along = car.def.length * 0.38, across = car.def.width * 0.45;
		let units = 0;

		for ( const [ a, b ] of WHEELS ) {

			const ox = f.x * a * along + f.z * b * across, oz = f.z * a * along - f.x * b * across;
			const lateral = Math.abs( car.proj.lateral + ox * lx + oz * lz );
			if ( lateral >= KERB_IN ) units += 2;
			else if ( lateral >= STRIP_IN ) units += 1;

		}

		car.kerb = units / 8;
		v.judder = car.kerb * Math.min( 1, Math.abs( v.linearSpeed ) );
		if ( units ) v.linearSpeed *= Math.max( 0, 1 - SURFACE.kerb * car.kerb * dt / Math.sqrt( v.mass ) );

	}

	// What's under the car: the slope it sits on, or nothing (flying)
	ground( car ) {

		const v = car.vehicle;
		this.shape.surface( v.spherePos.x, v.spherePos.z, car.proj, _surface );
		v.groundNormal.fromArray( _surface.normal );
		v.grounded = v.spherePos.y - SPHERE_RADIUS - _surface.height < AIRBORNE;
		car.onRoad = _surface.road;
		car.groundHeight = _surface.height;

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

		if ( counter.update( STEP, v.spherePos, this.shape.ordered ? this.cells[ this.line.cellAt( car.proj.s ) ] : null ) ) {

			car.lapTimes.push( counter.lastLap );
			this.adjustPace( car );

			// First race on a track (the field aimed at par): the field follows
			// the player's laps, the first one either way, then their best.
			// Later races keep the best lap they started from.
			if ( car.player && this.mode === 'race' && this.reference !== null && ! this.referenceMeasured ) {

				const flying = car.lapTimes.length === 1 ? counter.lastLap * FIRST_LAP : counter.lastLap;
				if ( car.lapTimes.length === 1 || flying < this.reference ) this.aimField( flying, false );

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
	// restarts from the skill and pace the calibration gives for that. Not
	// measured (a first race on the track): the fastest slots go to the aces.
	aimField( reference, measured = true ) {

		this.reference = reference;
		this.referenceMeasured = measured;
		const kinder = 1 + lean( reference, this.ai );
		const npcs = this.cars.filter( ( car ) => ! car.player && car.paceFactor !== null );
		const aces = measured ? [] : npcs.slice().sort( ( a, b ) => a.paceFactor - b.paceFactor ).slice( 0, ACES.length );
		const best = this.ai[ this.ai.length - 1 ];

		for ( const car of npcs ) {

			const ace = aces.indexOf( car );
			car.ace = ace >= 0;
			car.targetLap = car.ace ? ACES[ ace ] * best : car.paceFactor * reference * kinder;
			const start = startFor( car.targetLap, this.ai );
			car.driver.setSkill( start.skill );
			car.driver.pace = start.pace;

		}

	}

	// NPCs with a target lap time: after each flying lap, nudge the pace
	// toward the target (lap 1 includes the standing start)
	adjustPace( car ) {

		const driver = car.driver;
		if ( ! driver || car.player || car.ace || car.targetLap === null || car.lapTimes.length < 2 ) return;

		correct( driver, car.counter.lastLap, car.targetLap );

	}

	// A few % of pace from the gap to the player: NPCs well ahead ease off,
	// ones well behind push, so the field stays in reach without it being
	// obvious. Off once the player has finished, and never for the aces.
	rubberBand() {

		const player = this.player;
		const active = this.mode === 'race' && this.phase === 'racing' && player && ! player.finished;

		for ( const car of this.cars ) {

			if ( ! car.driver || car.player ) continue;
			const gap = active && ! car.ace ? Math.max( - 1, Math.min( 1, ( player.distance - car.distance ) / 40 ) ) : 0;
			car.driver.boost = gap * ( gap > 0 ? RUBBER_BAND.behind : RUBBER_BAND.ahead );

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
const SPHERE_RADIUS = 0.5;

// Clear of the ground by this much (m) counts as flying: no drive, little
// steering. Small hops over bumps keep control.
const AIRBORNE = 0.3;
const _up = new THREE.Vector3( 0, 1, 0 );
const _carryPrev = new THREE.Vector3();
const _carryQuaternion = new THREE.Quaternion();
const _surface = { height: 0, normal: [ 0, 1, 0 ], road: true };
