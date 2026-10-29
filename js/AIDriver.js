import { wrapAngle } from './TrackPath.js';
import { racingLine, DRIVE } from './RacingLine.js';

// An NPC driver. It reads its car's state directly and answers with the same
// analog input a gamepad gives (Vehicle's car-relative path), so NPCs drive
// with exactly the player's physics.
//
// It follows the track's racing line (RacingLine.js) at the speeds that
// line allows, braking where its own car needs to. Skill (0–1) blends the
// parameters below from a hesitant novice to a clean expert, and shows in
// the corners: how much of the grip they dare use, how much of the racing
// line they take, when they brake and how often they get it wrong. Every
// NPC goes flat out on the straights. Pace (≤ 1) scales all their speeds,
// for targets slower than a novice (and the lap of honour); the difficulty
// controller in Race.js sets skill and pace so each NPC laps near its
// target time.

// lookBase / lookGain: pure-pursuit lookahead (m) = base + gain · speed.
// gain / damping: steering from heading error, braked by yaw rate. lag:
// steering and reaction time (s). grip: share of the line's corner speed
// (squared, as grip goes). line: how much of the racing line they take.
// brakeError: how far (m) off the braking point they are, either way.
// mistake: chance per braking zone of braking late. noise: steering wobble.
const NOVICE = { lookBase: 1.6, lookGain: 0.2, gain: 2.0, damping: 0.05, lag: 0.2, grip: 0.4, line: 0.25, brakeError: 3, mistake: 0.12, noise: 0.1 };
const EXPERT = { lookBase: 2.2, lookGain: 0.25, gain: 3.5, damping: 0.1, lag: 0.05, grip: 1, line: 1, brakeError: 0.5, mistake: 0.02, noise: 0.02 };

const HALF_ROAD = 2.4; // how far off the centerline they'll go to pass (m)

function blend( skill ) {

	const params = {};
	for ( const key in NOVICE ) params[ key ] = NOVICE[ key ] + ( EXPERT[ key ] - NOVICE[ key ] ) * skill;
	return params;

}

export function rng( seed ) {

	let a = seed >>> 0;

	return () => {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

const _target = [ 0, 0 ];

export class AIDriver {

	constructor( line, { skill = 0.5, seed = 1, aggression = 0.5 } = {} ) {

		this.line = line;
		this.racing = null; // set by Race.addCar (with the track's shape), else built here
		this.setSkill( skill );
		this.aggression = aggression;
		this.random = rng( seed );

		this.pace = 1;
		this.boost = 0; // rubber band, ± a few %

		this.steer = 0;
		this.lateral = 0;
		this.noise = 0;
		this.prevHeading = null;
		this.braking = false;
		this.late = 0;

		this.stuckTime = 0;
		this.recoverTime = 0;
		this.recoveries = [];
		this.wrongWayTime = 0;
		this.wantsRespawn = false;

		this.input = { x: 0, z: 0, mode: 'car' };

	}

	// The difficulty controller (Race.adjustPace) moves this between laps
	setSkill( skill ) {

		this.skill = Math.max( 0, Math.min( 1, skill ) );
		this.params = blend( this.skill );

	}

	reset() {

		this.steer = 0;
		this.lateral = 0;
		this.prevHeading = null;
		this.braking = false;
		this.late = 0;
		this.stuckTime = 0;
		this.recoverTime = 0;
		this.recoveries.length = 0;
		this.wrongWayTime = 0;
		this.wantsRespawn = false;

	}

	drive( car, cars, dt, time ) {

		const p = this.params;
		const line = this.line;
		const racing = this.racing || ( this.racing = racingLine( line ) );
		const v = car.vehicle;
		const x = v.spherePos.x, z = v.spherePos.z;
		const heading = Math.atan2( car.forward.x, car.forward.z );
		const speed = Math.hypot( v.sphereVel.x, v.sphereVel.z );
		const yawRate = this.prevHeading === null ? 0 : wrapAngle( heading - this.prevHeading ) / dt;
		this.prevHeading = heading;

		const s = car.proj.s;

		// Where on the road to be: on the racing line (as much of it as they
		// take, read where they're looking), or beside a slower car ahead
		const look = p.lookBase + p.lookGain * speed;
		const onLine = racing.offsetAt( s + look ) * p.line;
		let passing = 0;
		let blocked = false;

		for ( const other of cars ) {

			if ( other === car || other.ghost > 0 ) continue;

			let ds = other.proj.s - s;
			if ( line.closed ) ds -= Math.round( ds / line.length ) * line.length;
			if ( ds <= 0 || ds > 12 ) continue;

			const dl = other.proj.lateral - car.proj.lateral;
			if ( Math.abs( dl ) > 1.6 ) continue;

			// Only cars they're catching matter, and sooner the faster they close
			const closing = speed - Math.hypot( other.vehicle.sphereVel.x, other.vehicle.sphereVel.z );
			if ( ds > 3 + Math.max( 0, closing ) * 0.9 ) continue;

			// Pass on the side with more room; aggressive drivers squeeze closer
			const side = other.proj.lateral > 0 ? - 1 : 1;
			const room = 1.8 * ( 1 - this.aggression * 0.45 );
			passing = Math.max( - HALF_ROAD, Math.min( HALF_ROAD, other.proj.lateral + side * room ) ) - onLine;
			if ( ds < 2.5 && Math.abs( dl ) < 1 && closing > 1 ) blocked = true;
			break;

		}

		// Moving out to pass is eased; the line itself isn't (it'd lag)
		this.lateral += ( passing - this.lateral ) * ( 1 - Math.exp( - dt * 3 ) );
		const lateral = onLine + this.lateral;

		// Pure pursuit on that line
		line.pointAt( s + look, _target );
		const dir = line.directionAt( s + look );
		const tx = _target[ 0 ] - Math.cos( dir ) * lateral;
		const tz = _target[ 1 ] + Math.sin( dir ) * lateral;
		const error = wrapAngle( Math.atan2( tx - x, tz - z ) - heading );

		this.noise += ( ( this.random() - 0.5 ) * 2 * p.noise - this.noise ) * ( 1 - Math.exp( - dt * 4 ) );
		const command = Math.max( - 1, Math.min( 1, p.gain * error - p.damping * yawRate + this.noise ) );
		this.steer += ( command - this.steer ) * ( 1 - Math.exp( - dt / p.lag ) );

		// Speed: the line's, for this car's brakes and this driver's nerve,
		// looked up a reaction time ahead. Each braking zone they find a
		// little early or late, now and then badly late.
		const brake = DRIVE.brake * Math.sqrt( v.brakeRate / 8 );
		const profile = racing.profile( DRIVE.grip * p.grip * p.grip, brake );
		const want = Math.min( DRIVE.top, racing.speedAt( profile, s + speed * p.lag + this.late ) ) * this.pace * ( 1 + this.boost );
		const slowing = want < speed - 0.3;

		if ( slowing && ! this.braking ) this.late = this.random() < p.mistake ? 3 + this.random() * 5 : ( this.random() - 0.5 ) * 2 * p.brakeError;
		if ( ! slowing && this.braking ) this.late = 0;
		this.braking = slowing;

		let throttle = speed > want + 0.8 ? - 1 : speed > want ? 0 : 1;
		if ( blocked && this.aggression < 0.6 ) throttle = Math.min( throttle, 0.4 );

		let steer = this.steer;

		// Stuck against a wall or another car: back off and turn the other way,
		// like a person would; after a few tries, ask to be put back on track
		if ( this.recoverTime > 0 ) {

			this.recoverTime -= dt;
			throttle = - 1;
			steer = error > 0 ? - 1 : 1;

		} else if ( speed < 0.5 && throttle > 0.3 && v.grounded ) {

			this.stuckTime += dt;

			if ( this.stuckTime > 1.2 ) {

				this.stuckTime = 0;
				this.recoverTime = 0.9;
				this.recoveries.push( time );
				while ( this.recoveries.length && this.recoveries[ 0 ] < time - 12 ) this.recoveries.shift();
				if ( this.recoveries.length >= 3 ) this.wantsRespawn = true;

			}

		} else {

			this.stuckTime = 0;

		}

		// Facing the wrong way for long (spun and wedged): respawn too
		if ( Math.abs( wrapAngle( line.directionAt( s ) - heading ) ) > 2.2 ) this.wrongWayTime += dt;
		else this.wrongWayTime = 0;
		if ( this.wrongWayTime > 4 ) this.wantsRespawn = true;

		// Car-relative input: +x steers right (heading decreases)
		this.input.x = - steer;
		this.input.z = throttle;
		return this.input;

	}

}
