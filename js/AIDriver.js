import { wrapAngle } from './TrackPath.js';

// An NPC driver. It reads its car's state directly and answers with the same
// analog input a gamepad gives (Vehicle's car-relative path), so NPCs drive
// with exactly the player's physics.
//
// Skill (0–1) blends the parameters below from a hesitant novice to a clean
// expert. Pace (≤ 1) caps the throttle; the difficulty controller in Race.js
// sets it so each NPC laps near its target time.

// lookBase / lookGain: pure-pursuit lookahead (m) = base + gain · speed.
// gain / damping: steering from heading error, braked by yaw rate. lag:
// steering response time (s). cornerSpeed: speed (m/s) to enter sharp
// corners at, brakeLead: how far ahead (s of travel) braking starts. noise:
// steering wobble. mistake: chance per corner of braking late. line: how much
// they cut toward the inside of corners.
const NOVICE = { lookBase: 1.6, lookGain: 0.2, gain: 2.0, damping: 0.05, lag: 0.25, cornerSpeed: 5.5, brakeLead: 0.3, noise: 0.15, mistake: 0.3, line: 0 };
const EXPERT = { lookBase: 2.2, lookGain: 0.25, gain: 3.5, damping: 0.1, lag: 0.05, cornerSpeed: 13, brakeLead: 0.45, noise: 0.02, mistake: 0.02, line: 1 };

const HALF_ROAD = 2.4; // how far off the centerline they'll aim (m)

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
		this.setSkill( skill );
		this.aggression = aggression;
		this.random = rng( seed );

		this.pace = 1;
		this.boost = 0; // rubber band, ± a few %

		this.steer = 0;
		this.lateral = 0;
		this.noise = 0;
		this.prevHeading = null;
		this.corner = null;
		this.skipBrake = false;

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
		this.stuckTime = 0;
		this.recoverTime = 0;
		this.recoveries.length = 0;
		this.wrongWayTime = 0;
		this.wantsRespawn = false;

	}

	drive( car, cars, dt, time ) {

		const p = this.params;
		const line = this.line;
		const v = car.vehicle;
		const x = v.spherePos.x, z = v.spherePos.z;
		const heading = Math.atan2( car.forward.x, car.forward.z );
		const speed = Math.hypot( v.sphereVel.x, v.sphereVel.z );
		const yawRate = this.prevHeading === null ? 0 : wrapAngle( heading - this.prevHeading ) / dt;
		this.prevHeading = heading;

		const s = car.proj.s;

		// Where on the road to be: toward the inside of the next corner (more
		// for better drivers), or beside a slower car ahead
		let lateralTarget = Math.max( - HALF_ROAD, Math.min( HALF_ROAD, line.turnAhead( s + 2, 8 ) * 1.6 * p.line ) );
		let blocked = false;

		for ( const other of cars ) {

			if ( other === car || other.ghost > 0 ) continue;

			let ds = other.proj.s - s;
			if ( line.closed ) ds -= Math.round( ds / line.length ) * line.length;
			if ( ds <= 0 || ds > 7 ) continue;

			const dl = other.proj.lateral - car.proj.lateral;
			if ( Math.abs( dl ) > 1.5 ) continue;

			// Pass on the side with more room; aggressive drivers squeeze less
			const side = other.proj.lateral > 0 ? - 1 : 1;
			const room = 1.9 * ( 1 - this.aggression * 0.5 );
			lateralTarget = Math.max( - HALF_ROAD - 0.3, Math.min( HALF_ROAD + 0.3, other.proj.lateral + side * room ) );
			if ( ds < 3 && Math.abs( dl ) < 1 ) blocked = true;
			break;

		}

		this.lateral += ( lateralTarget - this.lateral ) * ( 1 - Math.exp( - dt * 2.5 ) );

		// Pure pursuit on that line
		const look = p.lookBase + p.lookGain * speed;
		line.pointAt( s + look, _target );
		const dir = line.directionAt( s + look );
		const tx = _target[ 0 ] - Math.cos( dir ) * this.lateral;
		const tz = _target[ 1 ] + Math.sin( dir ) * this.lateral;
		const error = wrapAngle( Math.atan2( tx - x, tz - z ) - heading );

		this.noise += ( ( this.random() - 0.5 ) * 2 * p.noise - this.noise ) * ( 1 - Math.exp( - dt * 4 ) );
		const command = Math.max( - 1, Math.min( 1, p.gain * error - p.damping * yawRate + this.noise ) );
		this.steer += ( command - this.steer ) * ( 1 - Math.exp( - dt / p.lag ) );

		// Throttle: lift or brake when a sharp corner starts within the braking
		// horizon and they're too fast for it; sometimes they leave it late
		let throttle = Math.min( 1, this.pace * ( 1 + this.boost ) );
		const brakeAt = s + speed * p.brakeLead;
		const sharp = Math.abs( line.turnAhead( brakeAt, 5 ) ) > 1.0;

		if ( sharp ) {

			const corner = Math.round( brakeAt / 8 );

			if ( corner !== this.corner ) {

				this.corner = corner;
				this.skipBrake = this.random() < p.mistake;

			}

			if ( speed > p.cornerSpeed && ! this.skipBrake ) throttle = speed > p.cornerSpeed + 1.5 ? - 1 : 0;

		}

		if ( blocked && this.aggression < 0.6 ) throttle *= 0.6;

		let steer = this.steer;

		// Stuck against a wall or another car: back off and turn the other way,
		// like a person would; after a few tries, ask to be put back on track
		if ( this.recoverTime > 0 ) {

			this.recoverTime -= dt;
			throttle = - 1;
			steer = error > 0 ? - 1 : 1;

		} else if ( speed < 0.5 && throttle > 0.3 ) {

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
