import { rigidBody } from 'crashcat';
import { wrapAngle } from './TrackPath.js';
import { GRAVITY_FACTOR, SPHERE_DRAG } from './Physics.js';

// Ramps (Tracks.js ramps, TrackShape.ramps): a car crossing a ramp's lip fast
// enough takes off, and flies for 1–3 s, longer the faster it came, with no
// control till it lands (Vehicle.flying).
//
// A ramp can't do that alone: a second in the air takes a 50% slope at top
// speed and three seconds would go 16 m high. So the sphere gets a small
// launch and its own low gravity for the flight, worked out to bring it down
// on the road at the planned moment. The height stays small and the road
// falling away below does the rest. Everything else about the flight is the
// physics': walls and cars still get in the way.
//
// The flight also keeps the car's speed: no air drag, and the sphere's spin
// kept matched to it (Vehicle), or it lands on a stopped wheel and loses a
// third. Airtime is capped by the straight road ahead (no steering, so it
// has to come down before the corner). minSpeed, fullSpeed: m/s, for 1 s and
// the longest flight. lift: m/s up at the lip. longest: s. straighten: degrees
// the lip can turn the car's travel toward the road, or a flight that starts
// a few degrees off ends on a wall. margin: m left to the corner.
export const TAKEOFF = { minSpeed: 9.5, fullSpeed: 12.5, lift: 3.2, longest: 3, straighten: 8, margin: 5 };

const GRAVITY = 9.81; // Race.buildWorld
const LEAST_GRAVITY = 0.5; // m/s²
const ACROSS = Math.PI / 3; // further off the road's direction than this, it isn't going over the lip
const LANDED = 0.06; // m off the road (a tile sits 4 cm above GROUND_Y)
const OVERDUE = 1.5; // s past the planned landing: something went wrong, gravity comes back

// Seconds in the air from the lip, at speed (m/s), with `ahead` m of straight
export function airtime( speed, ahead ) {

	const { minSpeed, fullSpeed, longest, margin } = TAKEOFF;
	const bySpeed = 1 + ( longest - 1 ) * Math.max( 0, speed - minSpeed ) / ( fullSpeed - minSpeed );
	return Math.max( 1, Math.min( longest, bySpeed, ( ahead - margin ) / speed ) );

}

// Off the lip of `ramp`, if it's going fast enough. Returns the flight
// (for land and flightOver), or null.
export function launch( world, car, ramp, line ) {

	const v = car.vehicle;
	const vx = v.sphereVel.x, vz = v.sphereVel.z;
	const speed = Math.hypot( vx, vz );
	if ( speed < TAKEOFF.minSpeed ) return null;

	const travel = Math.atan2( vx, vz );
	const off = wrapAngle( line.directionAt( ramp.s ) - travel );
	if ( Math.abs( off ) > ACROSS ) return null;

	const most = TAKEOFF.straighten * Math.PI / 180;
	const heading = travel + Math.max( - most, Math.min( most, off ) );
	const time = airtime( speed, ramp.ahead );
	const up = Math.max( v.sphereVel.y, TAKEOFF.lift );

	// y = up · t − g · t² / 2 meets the road, `drop` under the lip, at t = time
	const drop = line.heightAt( ramp.s ) - line.heightAt( ramp.s + speed * time );
	const gravity = Math.max( LEAST_GRAVITY, 2 * ( up * time + drop ) / ( time * time ) );

	const body = v.rigidBody;
	const velocity = [ Math.sin( heading ) * speed, up, Math.cos( heading ) * speed ];
	rigidBody.setLinearVelocity( world, body, velocity );
	body.motionProperties.gravityFactor = gravity / GRAVITY;
	body.motionProperties.linearDamping = 0;
	v.sphereVel.fromArray( velocity );
	v.angularSpeed = 0;
	v.flying = true;

	return { planned: time, time: 0, speed };

}

// One step of a flight, with the sphere `gap` m off the ground under it:
// is it down?
export function flightOver( flight, gap, vy, dt ) {

	flight.time += dt;
	return ( gap < LANDED && vy < 0.5 ) || flight.time > flight.planned + OVERDUE;

}

export function land( car ) {

	const v = car.vehicle;
	const motion = v.rigidBody.motionProperties;
	motion.gravityFactor = GRAVITY_FACTOR;
	motion.linearDamping = SPHERE_DRAG;
	v.flying = false;
	car.flight = null;

}
