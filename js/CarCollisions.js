import { rigidBody } from 'crashcat';

// Car-to-car contact. Every car drives on the same 1m physics sphere;
// bumping uses a separate 2D footprint per model instead (a capsule along
// the car, from CarList.js bounds), so a kart is small and a fire truck
// long. Mass (CarList.js) decides who shoves whom. Off-centre hits also spin
// the car, so a tap on the rear quarter can turn someone round.
//
// How hard a hit is for each car is its velocity change, which comes from
// the closing speed and the two masses alone. Across its heading: under
// spinAt it's knocked aside, up to launchAt it spins and loses its steering
// for a moment, beyond that it's sent flying, tumbling, and lands on its
// wheels, side or roof depending on how far it turned over. Nose or tail on
// only costs speed.
//
// The sphere-sphere physics contact is off (Race.js), so this is the only
// thing that makes cars collide.

export const COLLISION = {
	restitution: 0.35,
	friction: 0.15,
	// How much of the off-centre impulse becomes yaw spin
	yaw: 0.7,
	// Mass ∝ area ^ exponent (0 = all equal)
	massExponent: 1,
	// How much of a frontal hit comes off the car's drive speed
	speedLoss: 0.6,
	// Sideways velocity change (m/s) that spins a car / sends it flying
	spinAt: 4,
	launchAt: 9.5,
	// Upward m/s per m/s over launchAt; roll rate (rad/s) per m/s, from
	// tumbleBase below launchAt: a launch just over the line lands back on
	// its wheels, a harder one on its roof, harder still all the way round
	lift: 0.8,
	tumble: 2.1,
	tumbleBase: 1.05,
};

const SPHERE_RADIUS = 0.5;

// Cars further apart in height don't meet (one on a bridge, one under it)
const HEIGHT_APART = 1.2;

// linearSpeed (Vehicle) per m/s of ground speed, measured at top speed
export const LINEAR_SPEED_PER_MS = 0.1;

const _a0 = [ 0, 0 ], _a1 = [ 0, 0 ], _b0 = [ 0, 0 ], _b1 = [ 0, 0 ];
const _pa = [ 0, 0 ], _pb = [ 0, 0 ];

export function carMass( def ) {

	return Math.pow( def.mass ?? 1, COLLISION.massExponent );

}

// Footprint segment (2D, x/z) and radius for a car this step
function footprint( car, p0, p1 ) {

	const v = car.vehicle;
	const fx = car.forward.x, fz = car.forward.z;
	const def = car.def;
	const radius = def.width / 2;
	const half = Math.max( 0, def.length / 2 - radius );
	const cx = v.spherePos.x + fx * def.centerZ;
	const cz = v.spherePos.z + fz * def.centerZ;

	p0[ 0 ] = cx - fx * half; p0[ 1 ] = cz - fz * half;
	p1[ 0 ] = cx + fx * half; p1[ 1 ] = cz + fz * half;

	return radius;

}

// Closest points between segments p0-p1 and q0-q1 (2D), into out0 / out1
function closestPoints( p0, p1, q0, q1, out0, out1 ) {

	const d1x = p1[ 0 ] - p0[ 0 ], d1z = p1[ 1 ] - p0[ 1 ];
	const d2x = q1[ 0 ] - q0[ 0 ], d2z = q1[ 1 ] - q0[ 1 ];
	const rx = p0[ 0 ] - q0[ 0 ], rz = p0[ 1 ] - q0[ 1 ];
	const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z, f = d2x * rx + d2z * rz;
	let s, t;

	if ( a < 1e-9 && e < 1e-9 ) {

		s = t = 0;

	} else if ( a < 1e-9 ) {

		s = 0;
		t = Math.min( 1, Math.max( 0, f / e ) );

	} else {

		const c = d1x * rx + d1z * rz;

		if ( e < 1e-9 ) {

			t = 0;
			s = Math.min( 1, Math.max( 0, - c / a ) );

		} else {

			const b = d1x * d2x + d1z * d2z;
			const denom = a * e - b * b;
			s = denom > 1e-9 ? Math.min( 1, Math.max( 0, ( b * f - c * e ) / denom ) ) : 0;
			t = ( b * s + f ) / e;

			if ( t < 0 ) {

				t = 0;
				s = Math.min( 1, Math.max( 0, - c / a ) );

			} else if ( t > 1 ) {

				t = 1;
				s = Math.min( 1, Math.max( 0, ( b - c ) / a ) );

			}

		}

	}

	out0[ 0 ] = p0[ 0 ] + d1x * s; out0[ 1 ] = p0[ 1 ] + d1z * s;
	out1[ 0 ] = q0[ 0 ] + d2x * t; out1[ 1 ] = q0[ 1 ] + d2z * t;

}

// Push a velocity change into the sphere, keeping it rolling (not skidding)
// in its new direction
function addVelocity( world, car, dvx, dvz ) {

	const body = car.vehicle.rigidBody;
	const lv = body.motionProperties.linearVelocity;
	const av = body.motionProperties.angularVelocity;

	rigidBody.setLinearVelocity( world, body, [ lv[ 0 ] + dvx, lv[ 1 ], lv[ 2 ] + dvz ] );
	rigidBody.setAngularVelocity( world, body, [ av[ 0 ] + dvz / SPHERE_RADIUS, av[ 1 ], av[ 2 ] - dvx / SPHERE_RADIUS ] );
	car.vehicle.sphereVel.x += dvx;
	car.vehicle.sphereVel.z += dvz;

}

// onHit( carA, carB, speed, x, z ): closing speed (m/s) and contact point
export function resolveCarCollisions( world, cars, onHit ) {

	for ( let i = 0; i < cars.length; i ++ ) {

		const A = cars[ i ];
		if ( A.ghost > 0 ) continue;
		const rA = footprint( A, _a0, _a1 );

		for ( let j = i + 1; j < cars.length; j ++ ) {

			const B = cars[ j ];
			if ( B.ghost > 0 ) continue;

			// Cheap reject before the segment test
			const dx = B.vehicle.spherePos.x - A.vehicle.spherePos.x;
			const dz = B.vehicle.spherePos.z - A.vehicle.spherePos.z;
			const reach = ( A.def.length + B.def.length ) / 2 + 0.2;
			if ( dx * dx + dz * dz > reach * reach ) continue;
			if ( Math.abs( B.vehicle.spherePos.y - A.vehicle.spherePos.y ) > HEIGHT_APART ) continue;

			const rB = footprint( B, _b0, _b1 );
			closestPoints( _a0, _a1, _b0, _b1, _pa, _pb );

			let nx = _pb[ 0 ] - _pa[ 0 ], nz = _pb[ 1 ] - _pa[ 1 ];
			let dist = Math.hypot( nx, nz );
			const depth = rA + rB - dist;
			if ( depth <= 0 ) continue;

			if ( dist < 1e-6 ) {

				// Exactly overlapping centres: push apart along the cars' offset
				nx = dx; nz = dz;
				dist = Math.hypot( nx, nz );

				if ( dist < 1e-6 ) {

					nx = 1; nz = 0; dist = 1;

				}

			}

			nx /= dist;
			nz /= dist;

			const mA = carMass( A.def ), mB = carMass( B.def );
			const wA = 1 / mA, wB = 1 / mB;
			const contactX = ( _pa[ 0 ] + nx * rA + _pb[ 0 ] - nx * rB ) / 2;
			const contactZ = ( _pa[ 1 ] + nz * rA + _pb[ 1 ] - nz * rB ) / 2;

			// Separate the spheres so the footprints just touch
			const pushA = depth * wA / ( wA + wB ), pushB = depth * wB / ( wA + wB );
			const pa = A.vehicle.rigidBody.position, pb = B.vehicle.rigidBody.position;
			rigidBody.setPosition( world, A.vehicle.rigidBody, [ pa[ 0 ] - nx * pushA, pa[ 1 ], pa[ 2 ] - nz * pushA ], false );
			rigidBody.setPosition( world, B.vehicle.rigidBody, [ pb[ 0 ] + nx * pushB, pb[ 1 ], pb[ 2 ] + nz * pushB ], false );
			A.vehicle.spherePos.x -= nx * pushA; A.vehicle.spherePos.z -= nz * pushA;
			B.vehicle.spherePos.x += nx * pushB; B.vehicle.spherePos.z += nz * pushB;

			const rvx = B.vehicle.sphereVel.x - A.vehicle.sphereVel.x;
			const rvz = B.vehicle.sphereVel.z - A.vehicle.sphereVel.z;
			const vn = rvx * nx + rvz * nz;
			if ( vn >= 0 ) continue; // already separating

			// Normal impulse with restitution, plus a little sideways friction
			const jn = - ( 1 + COLLISION.restitution ) * vn / ( wA + wB );
			const tx = rvx - vn * nx, tz = rvz - vn * nz;
			const tLen = Math.hypot( tx, tz );
			const jt = tLen > 1e-6 ? Math.min( COLLISION.friction * jn, tLen / ( wA + wB ) ) / tLen : 0;

			const jx = nx * jn + tx * jt;
			const jz = nz * jn + tz * jt;

			addVelocity( world, A, - jx * wA, - jz * wA );
			addVelocity( world, B, jx * wB, jz * wB );

			// Yaw from the lever arm: τy = rz·Fx − rx·Fz, over a box's inertia
			spin( A, contactX, contactZ, - jx, - jz, mA );
			spin( B, contactX, contactZ, jx, jz, mB );

			// The drive gives way to a frontal hit (else it keeps pushing)
			slow( A, - jx * wA, - jz * wA );
			slow( B, jx * wB, jz * wB );

			react( world, A, - jx * wA, - jz * wA, contactX, contactZ );
			react( world, B, jx * wB, jz * wB, contactX, contactZ );

			if ( onHit ) onHit( A, B, - vn, contactX, contactZ );

		}

	}

}

function spin( car, cx, cz, jx, jz, mass ) {

	const v = car.vehicle;
	const rx = cx - v.spherePos.x, rz = cz - v.spherePos.z;
	const inertia = mass * ( car.def.length ** 2 + car.def.width ** 2 ) / 12;
	v.spin += COLLISION.yaw * ( rz * jx - rx * jz ) / inertia;
	v.spin = Math.max( - 8, Math.min( 8, v.spin ) );

}

// A hard sideways hit: a spin and a moment without steering, or a launch
function react( world, car, dvx, dvz, cx, cz ) {

	const v = car.vehicle;
	const f = car.forward;

	// + pushed toward the car's right
	const across = dvx * f.z - dvz * f.x;
	const size = Math.abs( across );
	if ( size < COLLISION.spinAt ) return;

	v.controlLoss = Math.max( v.controlLoss, 0.35 );
	if ( size < COLLISION.launchAt || v.tumbling ) return;

	const lift = Math.min( 6, 2 + ( size - COLLISION.launchAt ) * COLLISION.lift );
	const body = v.rigidBody;
	const lv = body.motionProperties.linearVelocity;
	rigidBody.setLinearVelocity( world, body, [ lv[ 0 ], lv[ 1 ] + lift, lv[ 2 ] ] );
	v.sphereVel.y += lift;

	// Rolls away from the hit, and pitches if it was struck near an end
	const along = ( cx - v.spherePos.x ) * f.x + ( cz - v.spherePos.z ) * f.z;
	v.tumble.set( along / Math.max( 0.3, car.def.length / 2 ) * 2.5, 0, - Math.sign( across ) * ( size - COLLISION.launchAt + COLLISION.tumbleBase ) * COLLISION.tumble );
	v.tumbling = true;
	v.tumbleTime = 0;

}

function slow( car, dvx, dvz ) {

	const along = dvx * car.forward.x + dvz * car.forward.z;
	const v = car.vehicle;

	// Only a push against the direction of travel
	if ( along * Math.sign( v.linearSpeed ) < 0 ) {

		v.linearSpeed += along * LINEAR_SPEED_PER_MS * COLLISION.speedLoss;

	}

}
