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
// target time. Aces (a first race's two fastest) also race harder: they
// see traffic sooner, pass on the inside and never lift.

// Steering follows the line: the turn rate its curvature needs at this
// speed (read `lead` s ahead, as the car eases into a turn rate over about
// a quarter of a second), plus feedback that turns the car's direction of
// travel (the sphere's, not the nose's) toward the line and back onto it.
// gain: 1/s on the travel direction's error; track: how hard (m/s) a
// lateral miss bends the wanted direction (atan( track · miss / speed ));
// preview: s ahead the line's heading is read. yaw: 1/s on the nose's
// error. Fitted with `npm run sim -- --steer`.
export const STEER = { gain: 2, track: 1, lead: 0.45, preview: 0.15, yaw: 7 };

// The slip (rad) the nose leads the travel by at a steady turn rate ω:
// max · ω / ( half + ω ), measured at full throttle
const SLIP = { max: 2, half: 2.1 };

// Skill blends the rest. lag: steering and reaction time (s). grip: share
// of the line's corner speed (squared, as grip goes). line: how much of the
// racing line they take. brakeError: how far (m) off the braking point
// they are, either way. mistake: chance per braking zone of braking late.
// noise: steering wobble.
const NOVICE = { lag: 0.2, grip: 0.2, line: 0.25, brakeError: 3, mistake: 0.12, noise: 0.1 };
const EXPERT = { lag: 0.03, grip: 1, line: 1, brakeError: 0.5, mistake: 0.02, noise: 0 };

const HALF_ROAD = 2.4; // how far off the centerline they'll go to pass (m)
// Aces: how far ahead (m) they look for cars to pass, how much room (m,
// centre to centre) they leave, how far out (m) they'll go, how quickly
// (1/s) they move out, how close (m, along and across) they'll turn toward
// a car alongside, and how long (s) after the start they keep their lane
const ACE = { sight: 25, room: 1.4, reach: 2.6, move: 6, alongside: 1.8, beside: 1.1, lane: 2 };

function blend( skill ) {

	const params = {};
	for ( const key in NOVICE ) params[ key ] = NOVICE[ key ] + ( EXPERT[ key ] - NOVICE[ key ] ) * skill;

	// Time through a corner goes as 1 / grip: blend that, so lap times
	// spread evenly over the skills
	params.grip = 1 / ( 1 / NOVICE.grip + ( 1 / EXPERT.grip - 1 / NOVICE.grip ) * skill );
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

const _pose = { heading: 0, curvature: 0 };
const _ahead = { heading: 0, curvature: 0 };

export class AIDriver {

	constructor( line, { skill = 0.5, seed = 1, aggression = 0.5 } = {} ) {

		this.line = line;
		this.racing = null; // set by Race.addCar (with the track's shape), else built here
		this.setSkill( skill );
		this.aggression = aggression;
		this.random = rng( seed );

		this.pace = 1;
		this.boost = 0; // rubber band, ± a few %
		this.ace = false; // set by Race.aimField: sharper racecraft, never lifts

		this.overtaking = null; // the car an ace is passing, and on which side
		this.side = 1;
		this.lane = null; // where on the road it started

		this.steer = 0;
		this.lateral = 0;
		this.noise = 0;
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
		this.overtaking = null;
		this.lane = null;
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
		const vx = v.sphereVel.x, vz = v.sphereVel.z;
		const heading = Math.atan2( car.forward.x, car.forward.z );
		const speed = Math.hypot( vx, vz );
		const travel = speed > 1.5 ? Math.atan2( vx, vz ) : heading;

		const s = car.proj.s;

		// Where on the road to be: on the racing line (as much of it as they
		// take), or beside the nearest slower car ahead. Aces see further,
		// pass on the inside of the next turn with more room and stick to
		// that side till they're past.
		const onLine = racing.offsetAt( s ) * p.line;
		const ace = this.ace;
		const aggression = ace ? 1 : this.aggression;
		let other = null, ds = ace ? ACE.sight : 12, closing = 0;

		for ( const c of cars ) {

			if ( c === car || c.ghost > 0 ) continue;

			let d = c.proj.s - s;
			if ( line.closed ) d -= Math.round( d / line.length ) * line.length;
			if ( d <= 0 || d >= ds ) continue;

			// In the way: near them, or for an ace, near its line where that car is
			const dl = c.proj.lateral - ( ace ? racing.offsetAt( c.proj.s ) * p.line : car.proj.lateral );
			if ( Math.abs( dl ) > 1.6 ) continue;

			// Only cars they're catching matter, and sooner the faster they close
			const close = speed - Math.hypot( c.vehicle.sphereVel.x, c.vehicle.sphereVel.z );
			if ( d > ( ace ? 4 + Math.max( 0, close ) * 1.6 : 3 + Math.max( 0, close ) * 0.9 ) ) continue;

			other = c;
			ds = d;
			closing = close;

		}

		let passing = 0;
		let blocked = false, behind = false;

		if ( other ) {

			// The side with more room (aces: the inside of the turn after it, if
			// there's room there); aggressive drivers squeeze closer
			const room = ace ? ACE.room : 1.8 * ( 1 - aggression * 0.45 );
			const reach = ace ? ACE.reach : HALF_ROAD;
			let side = other.proj.lateral > 0 ? - 1 : 1;

			if ( ace && this.overtaking === other ) {

				side = this.side;

			} else if ( ace ) {

				const turn = line.turnAhead( other.proj.s, 15 );
				if ( Math.abs( turn ) > 0.2 && Math.abs( other.proj.lateral - Math.sign( turn ) * room ) <= reach ) side = - Math.sign( turn );
				this.side = side;

			}

			passing = Math.max( - reach, Math.min( reach, other.proj.lateral + side * room ) ) - onLine;
			const dl = Math.abs( other.proj.lateral - car.proj.lateral );
			if ( ds < 2.5 && dl < 1 && closing > 1 ) blocked = true;

			// An ace right behind it and closing fast eases off rather than
			// running into it (that'd spin them both); alongside it leans on it
			if ( ace && ds < 2 + closing * 0.35 && dl < 0.9 && closing > 2 ) behind = true;

		}

		this.overtaking = other;

		// Moving out to pass is eased; the line itself isn't (it'd lag)
		this.lateral += ( passing - this.lateral ) * ( 1 - Math.exp( - dt * ( ace ? ACE.move : 3 ) ) );
		let aim = onLine + this.lateral;

		// Off the grid, aces keep to their lane at first (where everyone's
		// still side by side); then they don't turn into a car alongside
		if ( this.lane === null ) this.lane = car.proj.lateral;
		if ( ace && time < ACE.lane ) aim = this.lane;

		if ( ace ) for ( const c of cars ) {

			if ( c === car || c.ghost > 0 ) continue;

			let d = c.proj.s - s;
			if ( line.closed ) d -= Math.round( d / line.length ) * line.length;
			if ( Math.abs( d ) > ACE.alongside ) continue;

			const dl = c.proj.lateral - car.proj.lateral;
			if ( dl > 0 ) aim = Math.min( aim, c.proj.lateral - ACE.beside );
			else aim = Math.max( aim, c.proj.lateral + ACE.beside );

		}

		const miss = car.proj.lateral - aim; // + is left of where they want to be

		// How fast the direction of travel should turn: as the line does
		// (read ahead), plus enough to bring it back onto the line (a
		// heading increase moves the car right)
		racing.pose( s + speed * STEER.preview, p.line, _pose );
		racing.pose( s + speed * STEER.lead, p.line, _ahead );
		const wanted = _pose.heading + Math.atan( STEER.track * miss / Math.max( speed, 4 ) );
		const error = wrapAngle( wanted - travel );
		const turn = speed * _ahead.curvature + STEER.gain * error;

		// The sphere slides through a turn, so the nose has to lead the
		// travel by the slip that turn rate takes (Vehicle at full throttle:
		// 0.3 rad at 0.4 rad/s, 1.3 at 4); steer the nose to that
		const slip = Math.sign( turn ) * SLIP.max * Math.abs( turn ) / ( SLIP.half + Math.abs( turn ) );
		const rate = turn + STEER.yaw * wrapAngle( travel + slip - heading );

		// As a share of what the car can turn at (Vehicle: 4 rad/s at speed)
		const reach = 4 * Math.max( 0.2, Math.min( 1, Math.abs( v.linearSpeed ) ) );
		this.noise += ( ( this.random() - 0.5 ) * 2 * p.noise - this.noise ) * ( 1 - Math.exp( - dt * 4 ) );
		const command = Math.max( - 1, Math.min( 1, rate / reach + this.noise ) );
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
		if ( blocked && aggression < 0.6 ) throttle = Math.min( throttle, 0.4 );
		if ( behind ) throttle = Math.min( throttle, 0 );

		let steer = this.steer;

		// Stuck against a wall or another car: back off and turn the other way,
		// like a person would; after a few tries, ask to be put back on track
		if ( this.recoverTime > 0 ) {

			this.recoverTime -= dt;
			throttle = - 1;
			steer = wrapAngle( wanted - heading ) > 0 ? - 1 : 1;

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
