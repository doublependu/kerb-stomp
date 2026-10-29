// A bot that drives the way a person does: it reads the truck's state with a
// reaction delay, predicts forward imperfectly, and works the controls through
// real input events (keyboard keys or a dragged touch joystick). Nothing is
// injected into the game; window.__kerb is only read.

import { wrapAngle } from './track.mjs';

// delay: reaction time (s). predict: how much of the delay the driver
// compensates for. look*: pure-pursuit lookahead = base + gain·speed (m).
// steerOn/Off: key hysteresis (rad). damping: brakes steering by yaw rate.
// cornerSpeed: speed they try to enter sharp corners at. slip: chance per
// tick of holding a steering key too long, for slipHold seconds.
export const SKILLS = {
	expert: { delay: 0.1, predict: 0.9, lookBase: 2.4, lookGain: 0.3, steerOn: 0.05, steerOff: 0.015, damping: 0.14, cornerSpeed: 99, brakeLead: 0.45, slip: 0, slipHold: 0, forgetBrake: 0, thumbNoise: 0.03 },
	average: { delay: 0.18, predict: 0.7, lookBase: 2.0, lookGain: 0.28, steerOn: 0.09, steerOff: 0.03, damping: 0.1, cornerSpeed: 6.2, brakeLead: 0.35, slip: 0.012, slipHold: 0.15, forgetBrake: 0.2, thumbNoise: 0.07 },
	novice: { delay: 0.27, predict: 0.45, lookBase: 1.6, lookGain: 0.22, steerOn: 0.14, steerOff: 0.05, damping: 0.06, cornerSpeed: 5.2, brakeLead: 0.25, slip: 0.035, slipHold: 0.25, forgetBrake: 0.4, thumbNoise: 0.12 },
};

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

// What the driver "sees": the state from `delay` ago, extrapolated forward by
// the part of the delay they anticipate.
function perceive( history, skill ) {

	const now = history[ history.length - 1 ];
	const target = now.t - skill.delay * 1000;

	let i = history.length - 1;
	while ( i > 0 && history[ i ].t > target ) i --;

	const seen = history[ i ];
	const before = history[ Math.max( 0, i - 3 ) ];
	const dt = ( seen.t - before.t ) / 1000 || 1 / 30;

	const vx = ( seen.x - before.x ) / dt;
	const vz = ( seen.z - before.z ) / dt;
	const yawRate = wrapAngle( seen.heading - before.heading ) / dt;
	const ahead = skill.delay * skill.predict;

	return {
		x: seen.x + vx * ahead,
		z: seen.z + vz * ahead,
		heading: seen.heading + yawRate * ahead,
		yawRate,
		speed: seen.speed,
	};

}

class BaseDriver {

	constructor( page, line, { skill = 'average', seed = 1 } = {} ) {

		this.page = page;
		this.line = line;
		this.skillName = skill;
		this.skill = SKILLS[ skill ];
		this.random = rng( seed );
		this.hint = null;
		this.slipUntil = 0;
		this.stuckSince = null;
		this.recoverUntil = 0;
		this.stuckEvents = 0;

	}

	target( p ) {

		const proj = this.line.project( p.x, p.z, this.hint );
		this.hint = proj.index;

		const look = this.skill.lookBase + this.skill.lookGain * p.speed;
		const [ tx, tz ] = this.line.pointAt( proj.s + look );
		const angle = wrapAngle( Math.atan2( tx - p.x, tz - p.z ) - p.heading );

		return { proj, tx, tz, angle };

	}

	trackStuck( now, speed, throttling ) {

		if ( speed < 0.4 && throttling ) {

			if ( this.stuckSince === null ) this.stuckSince = now.t;

			if ( now.t - this.stuckSince > 1200 ) {

				this.stuckEvents ++;
				this.stuckSince = null;
				return true;

			}

		} else {

			this.stuckSince = null;

		}

		return false;

	}

}

export class KeyboardDriver extends BaseDriver {

	constructor( page, line, options ) {

		super( page, line, options );
		this.input = 'keyboard';
		this.steer = 0; // +1 = turn left (heading increases, KeyA), -1 = right (KeyD)
		this.throttle = 0;
		this.down = new Set();

	}

	async start() {

		// Pressing W both dismisses the start screen and starts driving
		await this.setKeys( 0, 1 );

	}

	async update( history ) {

		const now = history[ history.length - 1 ];
		const s = this.skill;
		const p = perceive( history, s );
		const { proj, angle } = this.target( p );

		// Steering: bang-bang on the heading error, damped by the yaw rate so
		// the key comes off before the nose swings past
		const e = angle - s.damping * p.yawRate;

		if ( now.t < this.slipUntil ) {

			// holding the key too long

		} else if ( this.steer === 0 ) {

			if ( e > s.steerOn ) this.steer = 1;
			else if ( e < - s.steerOn ) this.steer = - 1;

		} else if ( this.steer * e < s.steerOff ) {

			this.steer = Math.abs( e ) > s.steerOn ? Math.sign( e ) : 0;

		}

		if ( this.steer !== 0 && this.random() < s.slip ) this.slipUntil = now.t + s.slipHold * 1000;

		// Throttle: lift or brake when a sharp turn starts within the braking
		// horizon (speed · brakeLead metres ahead) and they're too fast for it
		let throttle = 1;
		const brakeAt = proj.s + p.speed * s.brakeLead;
		const sharp = this.line.turnAhead( brakeAt, 5 ) > 1.0;

		if ( sharp && p.speed > s.cornerSpeed && this.random() > s.forgetBrake ) {

			throttle = p.speed > s.cornerSpeed + 1 ? - 1 : 0;

		}

		// Stuck against a wall: back off and turn the other way, like a person would
		if ( this.trackStuck( now, now.speed, this.throttle === 1 ) ) this.recoverUntil = now.t + 900;

		let steer = this.steer;

		if ( now.t < this.recoverUntil ) {

			throttle = - 1;
			steer = angle > 0 ? - 1 : 1;

		}

		await this.setKeys( steer, throttle );

		return proj;

	}

	async setKeys( steer, throttle ) {

		this.throttle = throttle;

		const want = new Set();
		if ( steer > 0 ) want.add( 'KeyA' );
		if ( steer < 0 ) want.add( 'KeyD' );
		if ( throttle > 0 ) want.add( 'KeyW' );
		if ( throttle < 0 ) want.add( 'KeyS' );

		for ( const key of this.down ) if ( ! want.has( key ) ) await this.page.keyboard.up( key );
		for ( const key of want ) if ( ! this.down.has( key ) ) await this.page.keyboard.down( key );

		this.down = want;

	}

	async release() {

		await this.setKeys( 0, 0 );

	}

}

// Touch: the joystick points the truck in a world direction (the game maps it
// through the 45° camera) with automatic throttle. The thumb rests at an anchor
// and drags toward where the driver wants to go.
export class TouchDriver extends BaseDriver {

	constructor( page, line, options ) {

		super( page, line, options );
		this.input = 'touch';
		this.cdp = null;
		this.anchor = null;
		this.thumb = null;
		this.touching = false;

	}

	async start() {

		this.cdp = await this.page.context().newCDPSession( this.page );
		const { width, height } = await this.page.evaluate( () => ( { width: innerWidth, height: innerHeight } ) );

		// Tap to dismiss the start screen, then put the thumb down
		await this.touch( 'touchStart', width / 2, height / 2 );
		await this.touch( 'touchEnd' );
		await this.place( width, height );

	}

	async place( width, height ) {

		this.anchor = [ width * 0.5, height * 0.72 ];
		this.thumb = this.anchor.slice();
		await this.touch( 'touchStart', ...this.anchor );
		this.touching = true;

	}

	async touch( type, x, y ) {

		await this.cdp.send( 'Input.dispatchTouchEvent', {
			type,
			touchPoints: type === 'touchEnd' ? [] : [ { x: Math.round( x ), y: Math.round( y ), id: 1, radiusX: 8, radiusY: 8, force: 1 } ],
		} );

	}

	async update( history ) {

		const now = history[ history.length - 1 ];
		const p = perceive( history, this.skill );
		const { proj, tx, tz } = this.target( p );

		this.trackStuck( now, now.speed, true );

		// World direction → joystick vector (inverse of Controls' 45° mapping)
		const heading = Math.atan2( tx - p.x, tz - p.z ) + ( this.random() - 0.5 ) * 2 * this.skill.thumbNoise;
		const wx = Math.sin( heading ), wz = Math.cos( heading );
		const jx = ( wx - wz ) * Math.SQRT1_2;
		const jy = ( wx + wz ) * Math.SQRT1_2;

		const thumb = [ this.anchor[ 0 ] + jx * 48, this.anchor[ 1 ] + jy * 48 ];

		if ( Math.hypot( thumb[ 0 ] - this.thumb[ 0 ], thumb[ 1 ] - this.thumb[ 1 ] ) > 1.5 ) {

			this.thumb = thumb;
			await this.touch( 'touchMove', ...thumb );

		}

		return proj;

	}

	// After a rotation the anchor may be off-screen: lift and put the thumb back
	async replace() {

		if ( this.touching ) await this.touch( 'touchEnd' );
		const { width, height } = await this.page.evaluate( () => ( { width: innerWidth, height: innerHeight } ) );
		await this.place( width, height );

	}

	async release() {

		if ( this.touching ) await this.touch( 'touchEnd' );
		this.touching = false;

	}

}

// Drive until `laps` laps are completed (or timeout / until() returns true),
// collecting gameplay metrics. Each tick is one state read + input update,
// about 30 per second.
export async function drive( page, driver, { laps = 3, timeout = 120, until = null, onTick = null } = {} ) {

	const history = [];
	const lapTimes = [];
	const lateral = [];
	const visibility = { checks: 0, near: 0, far: 0 };
	let lastLap = null;
	let project = [];
	let ticks = 0;
	const start = Date.now();

	await driver.start();

	for ( ;; ) {

		const { state, projected } = await page.evaluate( ( points ) => ( {
			state: window.__kerb.state(),
			projected: points.map( ( p ) => window.__kerb.project( p[ 0 ], 0, p[ 1 ] ) ),
		} ), project );

		history.push( state );
		if ( history.length > 120 ) history.shift();

		// Is the road 0.6s and 1.2s ahead on screen? (a person can only react
		// to what they can see)
		if ( projected.length === 2 && state.speed > 2 ) {

			const onScreen = ( q ) => Math.abs( q[ 0 ] ) < 0.95 && Math.abs( q[ 1 ] ) < 0.95;
			visibility.checks ++;
			if ( onScreen( projected[ 0 ] ) ) visibility.near ++;
			if ( onScreen( projected[ 1 ] ) ) visibility.far ++;

		}

		if ( state.lap > ( history.length > 1 ? history[ history.length - 2 ].lap : 1 ) && state.lastLap !== lastLap ) {

			lastLap = state.lastLap;
			lapTimes.push( state.lastLap );

		}

		if ( state.screen === 'playing' ) {

			const proj = await driver.update( history );
			lateral.push( Math.abs( proj.lateral ) );

			project = ticks % 3 === 0 ? [ driver.line.pointAt( proj.s + state.speed * 0.6 ), driver.line.pointAt( proj.s + state.speed * 1.2 ) ] : [];

		}

		ticks ++;
		if ( onTick ) await onTick( state, ticks, driver );

		if ( lapTimes.length >= laps ) break;
		if ( until && until( state, history ) ) break;
		if ( Date.now() - start > timeout * 1000 ) break;

		await page.waitForTimeout( 25 );

	}

	await driver.release();

	const final = history[ history.length - 1 ];
	const sorted = lateral.slice().sort( ( a, b ) => a - b );

	return {
		skill: driver.skillName,
		input: driver.input,
		lapTimes,
		completedLaps: lapTimes.length,
		seconds: ( Date.now() - start ) / 1000,
		wallImpacts: final.wallImpacts,
		maxWallImpact: final.maxWallImpact,
		resets: final.resets,
		stuckEvents: driver.stuckEvents,
		lateralP50: sorted[ Math.floor( sorted.length * 0.5 ) ] || 0,
		lateralP95: sorted[ Math.floor( sorted.length * 0.95 ) ] || 0,
		roadVisibleNear: visibility.checks ? visibility.near / visibility.checks : null,
		roadVisibleFar: visibility.checks ? visibility.far / visibility.checks : null,
		frameP50: final.frameP50,
		frameP95: final.frameP95,
		tier: final.tier,
		ticksPerSecond: ticks / ( ( Date.now() - start ) / 1000 ),
		final,
	};

}
