import * as THREE from 'three';
import { rigidBody } from 'crashcat';

const _tmpVec = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _zAxis = new THREE.Vector3();
const _newZ = new THREE.Vector3();
const _airUp = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3( 0, 1, 0 );

const LINEAR_DAMP = 0.1;
export const MAX_SPEED = 1.5;

// Handling by mass (CarList.js, the yellow truck = 1 drives as the game
// always has): lighter cars pick up speed and stop quicker but coast less
// and bob about; heavier ones the other way round. Top speed is the same
// for every car. The exponents are tunable (?tune).
export const HANDLING = { accel: 0.25, coast: 0.6, brake: 0.3, wobble: 0.5 };

// Collision spin (rad/s) bleeds off at this rate
const SPIN_DECAY = 3;

const WHEEL = /^wheel-(front|back)-(left|right)$/;

function lerpAngle( a, b, t ) {

	let diff = b - a;
	while ( diff > Math.PI ) diff -= Math.PI * 2;
	while ( diff < -Math.PI ) diff += Math.PI * 2;
	return a + diff * t;

}

export class Vehicle {

	constructor() {

		this.linearSpeed = 0;
		this.angularSpeed = 0;
		this.acceleration = 0;

		this.spherePos = new THREE.Vector3( 3.5, 0.5, 5 );
		this.sphereVel = new THREE.Vector3();

		this.rigidBody = null;
		this.physicsWorld = null;

		this.modelVelocity = new THREE.Vector3();
		this.prevModelPos = new THREE.Vector3( 3.5, 0, 5 );

		this.container = new THREE.Group();
		this.model = null;
		this.bodyNode = null;
		this.bodyY = 0.3;
		this.wheels = [];
		this.wheelFL = null;
		this.wheelFR = null;
		this.wheelBL = null;
		this.wheelBR = null;

		this.inputX = 0;
		this.inputZ = 0;

		this.setMass( 1 );

		// After a hard hit: steering gone for a moment (s); flying end over
		// end (rad/s about the car's right and forward axes); or lying on its
		// side or roof
		this.controlLoss = 0;
		this.judder = 0; // 0–1, on the kerbs (Race.js)
		this.tumble = new THREE.Vector3();
		this.tumbling = false;
		this.tumbleTime = 0;
		this.flipped = false;

		this.driftIntensity = 0;

		// Yaw rate from car-to-car hits (CarCollisions), on top of steering
		this.spin = 0;

		// The ground under the sphere (Race.js sets these each step from
		// TrackShape): its normal, and whether the car is on it or flying
		this.groundNormal = new THREE.Vector3( 0, 1, 0 );
		this.grounded = true;
		this.wasGrounded = true;
		this.landing = 0; // vertical speed of the last landing, for effects

		// Where a fall off the world puts the truck back, unless onFall
		// handles it (races put the car back where it left the track)
		this.spawnPosition = [ 3.5, 0.5, 5 ];
		this.spawnAngle = 0;
		this.onFall = null;
		this.resets = 0;

	}

	setMass( mass ) {

		this.mass = mass;
		this.accelRate = 1.5 * Math.pow( mass, - HANDLING.accel );
		this.coastRate = 1.5 * Math.pow( mass, - HANDLING.coast );
		this.brakeRate = 8 * Math.pow( mass, - HANDLING.brake );
		this.wobble = Math.pow( mass, - HANDLING.wobble );

	}

	// bodyY: the body's resting height in model units (CarList.js)
	init( model, bodyY = 0.3 ) {

		if ( this.model ) this.container.remove( this.model );

		const vehicleModel = model.clone();
		this.model = vehicleModel;
		this.bodyY = bodyY;
		this.bodyNode = null;
		this.wheels = [];
		this.wheelFL = this.wheelFR = this.wheelBL = this.wheelBR = null;

		this.container.add( vehicleModel );

		// Find body and wheel nodes
		vehicleModel.traverse( ( child ) => {

			const name = child.name.toLowerCase();

			if ( name === 'body' ) {

				child.rotation.order = 'YXZ';
				this.bodyNode = child;

			} else if ( WHEEL.test( name ) ) {

				child.rotation.order = 'YXZ';
				this.wheels.push( child );

				if ( name.includes( 'front' ) && name.includes( 'left' ) ) this.wheelFL = child;
				if ( name.includes( 'front' ) && name.includes( 'right' ) ) this.wheelFR = child;
				if ( name.includes( 'back' ) && name.includes( 'left' ) ) this.wheelBL = child;
				if ( name.includes( 'back' ) && name.includes( 'right' ) ) this.wheelBR = child;

			}

			if ( child.isMesh ) {

				child.castShadow = true;
				child.receiveShadow = true;

			}

		} );

		return this.container;

	}

	update( dt, controlsInput ) {

		// No driving while flying end over end or lying on the roof
		const helpless = this.tumbling || this.flipped;
		this.inputX = helpless ? 0 : controlsInput.x;
		this.inputZ = helpless ? 0 : controlsInput.z;

		if ( this.controlLoss > 0 ) {

			this.controlLoss -= dt;
			this.inputX = 0;

		}

		const throttle = Math.hypot( this.inputX, this.inputZ );

		if ( controlsInput.mode === 'world' && throttle > 0 ) {

			// Touch joystick: (x, z) is a world-space direction to head in,
			// and its length (0–1) how fast to go
			const targetAngle = Math.atan2( this.inputX, this.inputZ );
			_quat.setFromAxisAngle( _up, targetAngle );
			this.container.quaternion.slerp( _quat, 1 - Math.exp( - 3 * dt ) );

			_forward.set( 0, 0, 1 ).applyQuaternion( this.container.quaternion );
			const cross = ( _forward.x * this.inputZ - _forward.z * this.inputX ) / throttle;
			this.inputX = THREE.MathUtils.clamp( - cross * 2, - 1, 1 );
			this.inputZ = Math.min( 1, throttle );

			const target = MAX_SPEED * this.inputZ;
			this.linearSpeed = THREE.MathUtils.lerp( this.linearSpeed, target, dt * ( target > this.linearSpeed ? this.accelRate : this.coastRate ) );

		} else if ( controlsInput.mode === 'world' ) {

			// Thumb lifted: coast down
			this.inputX = 0;
			this.inputZ = 0;
			this.linearSpeed = THREE.MathUtils.lerp( this.linearSpeed, 0, dt * this.coastRate );

		} else {

			// Keyboard / gamepad: standard steering + throttle
			let direction = Math.sign( this.linearSpeed );
			if ( direction === 0 ) direction = Math.abs( this.inputZ ) > 0.1 ? Math.sign( this.inputZ ) : 1;

			const steeringGrip = THREE.MathUtils.clamp( Math.abs( this.linearSpeed ), 0.2, 1.0 );

			// Barely any steering in the air
			const targetAngular = - this.inputX * steeringGrip * 4 * direction * ( this.grounded ? 1 : 0.3 );
			this.angularSpeed = THREE.MathUtils.lerp( this.angularSpeed, targetAngular, dt * 4 );

			this.container.rotateY( this.angularSpeed * dt );

			const targetSpeed = this.inputZ;

			if ( targetSpeed < 0 && this.linearSpeed > 0.01 ) {

				this.linearSpeed = THREE.MathUtils.lerp( this.linearSpeed, 0.0, dt * this.brakeRate );

			} else if ( targetSpeed < 0 ) {

				this.linearSpeed = THREE.MathUtils.lerp( this.linearSpeed, targetSpeed / 2, dt * 2 );

			} else {

				const target = targetSpeed * MAX_SPEED;
				this.linearSpeed = THREE.MathUtils.lerp( this.linearSpeed, target, dt * ( target > this.linearSpeed ? this.accelRate : this.coastRate ) );

			}

		}

		if ( this.spin !== 0 ) {

			this.container.rotateY( this.spin * dt );
			this.spin *= Math.exp( - SPIN_DECAY * dt );
			if ( Math.abs( this.spin ) < 0.01 ) this.spin = 0;

		}

		// Flying end over end until it lands; then it lands on its wheels
		// (the upright pull below takes over) or on its side or roof
		if ( this.tumbling ) {

			this.tumbleTime += dt;

			if ( this.grounded && this.sphereVel.y < 0.5 && this.tumbleTime > 0.25 ) {

				this.tumbling = false;
				this.tumble.set( 0, 0, 0 );

			} else {

				this.container.rotateX( this.tumble.x * dt );
				this.container.rotateZ( this.tumble.z * dt );

			}

		}

		_tmpVec.set( 0, 1, 0 ).applyQuaternion( this.container.quaternion );
		this.flipped = ! this.tumbling && _tmpVec.y <= 0.5;

		if ( _tmpVec.y > 0.5 && ! this.tumbling ) {

			// Sit on the slope; in the air, hold the nose along the flight path
			if ( this.grounded ) {

				const targetQuat = this.alignWithY( this.container.quaternion, this.groundNormal );
				this.container.quaternion.slerp( targetQuat, 1 - Math.pow( 0.8, dt * 60 ) );

			} else {

				_forward.set( 0, 0, 1 ).applyQuaternion( this.container.quaternion );
				_forward.y = 0;
				_forward.normalize();
				const v = this.sphereVel;
				const pitch = THREE.MathUtils.clamp( Math.atan2( v.y, Math.max( 0.5, Math.hypot( v.x, v.z ) ) ), - 0.45, 0.45 );
				_airUp.set( 0, Math.cos( pitch ), 0 ).addScaledVector( _forward, - Math.sin( pitch ) );
				const targetQuat = this.alignWithY( this.container.quaternion, _airUp );
				this.container.quaternion.slerp( targetQuat, 1 - Math.exp( - 3 * dt ) );

			}

		}

		this.linearSpeed *= Math.max( 0, 1 - LINEAR_DAMP * dt );

		if ( this.rigidBody && this.grounded ) {

			_forward.set( 0, 0, 1 ).applyQuaternion( this.container.quaternion );
			_forward.y = 0;
			_forward.normalize();

			_right.set( 1, 0, 0 ).applyQuaternion( this.container.quaternion );
			_right.y = 0;
			_right.normalize();

			const angvel = this.rigidBody.motionProperties.angularVelocity;
			const drive = this.linearSpeed * 100 * dt;

			rigidBody.setAngularVelocity( this.physicsWorld, this.rigidBody, [
				angvel[ 0 ] + _right.x * drive,
				angvel[ 1 ],
				angvel[ 2 ] + _right.z * drive
			] );

		}

		if ( this.rigidBody ) {

			const pos = this.rigidBody.position;
			this.spherePos.set( pos[ 0 ], pos[ 1 ], pos[ 2 ] );

			const vel = this.rigidBody.motionProperties.linearVelocity;
			this.sphereVel.set( vel[ 0 ], vel[ 1 ], vel[ 2 ] );

		}

		this.acceleration = THREE.MathUtils.lerp(
			this.acceleration,
			this.linearSpeed + ( 0.25 * this.linearSpeed * Math.abs( this.linearSpeed ) ),
			dt
		);

		if ( this.spherePos.y < - 10 ) {

			if ( this.onFall ) this.onFall();
			else this.reset();

		}

		this.container.position.set(
			this.spherePos.x,
			this.spherePos.y - 0.5,
			this.spherePos.z
		);

		if ( dt > 0 ) {

			this.modelVelocity.subVectors( this.container.position, this.prevModelPos ).divideScalar( dt );
			this.prevModelPos.copy( this.container.position );

		}

		// A landing squashes the body for a moment
		if ( this.grounded && ! this.wasGrounded && this.sphereVel.y < - 2 && this.bodyNode ) {

			this.landing = - this.sphereVel.y;
			this.bodyNode.position.y -= Math.min( 0.25, this.landing * 0.03 );

		}

		this.wasGrounded = this.grounded;

		this.updateBody( dt );
		this.updateWheels( dt );

		this.driftIntensity = Math.abs( this.linearSpeed - this.acceleration ) +
			( this.bodyNode ? Math.abs( this.bodyNode.rotation.z ) * 2 : 0 );

	}

	reset() {

		this.resetTo( this.spawnPosition, this.spawnAngle );

	}

	resetTo( position, angle ) {

		const [ x, y, z ] = position;

		if ( this.rigidBody ) {

			rigidBody.setPosition( this.physicsWorld, this.rigidBody, [ x, y, z ], false );
			rigidBody.setLinearVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );
			rigidBody.setAngularVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );

		}

		this.spherePos.set( x, y, z );
		this.sphereVel.set( 0, 0, 0 );
		this.prevModelPos.set( x, y - 0.5, z );
		this.container.position.set( x, y - 0.5, z );
		this.linearSpeed = 0;
		this.angularSpeed = 0;
		this.acceleration = 0;
		this.spin = 0;
		this.controlLoss = 0;
		this.tumbling = false;
		this.tumble.set( 0, 0, 0 );
		this.flipped = false;
		this.container.quaternion.setFromAxisAngle( _up, angle );
		this.resets ++;

	}

	alignWithY( quaternion, newY ) {

		_zAxis.set( 0, 0, 1 ).applyQuaternion( quaternion );
		const xAxis = _tmpVec.crossVectors( _zAxis, newY ).negate().normalize();
		_newZ.crossVectors( xAxis, newY ).normalize();

		_mat4.makeBasis( xAxis, newY, _newZ );
		return _quat.setFromRotationMatrix( _mat4 );

	}

	updateBody( dt ) {

		if ( ! this.bodyNode ) return;

		this.bodyNode.rotation.x = lerpAngle(
			this.bodyNode.rotation.x,
			-( this.linearSpeed - this.acceleration ) / 6 * this.wobble,
			dt * 10
		);

		this.bodyNode.rotation.z = lerpAngle(
			this.bodyNode.rotation.z,
			-( this.inputX / 5 ) * this.linearSpeed * this.wobble,
			dt * 5
		);

		this.bodyNode.position.y = THREE.MathUtils.lerp( this.bodyNode.position.y, this.bodyY, dt * 5 );

		// Juddering over the kerbs
		if ( this.judder > 0 ) {

			this.bodyNode.rotation.x += ( Math.random() - 0.5 ) * 0.04 * this.judder;
			this.bodyNode.rotation.z += ( Math.random() - 0.5 ) * 0.05 * this.judder;

		}

	}

	updateWheels( dt ) {

		for ( const wheel of this.wheels ) {

			wheel.rotation.x += this.acceleration * dt * 60;

		}

		if ( this.wheelFL ) {

			this.wheelFL.rotation.y = lerpAngle( this.wheelFL.rotation.y, -this.inputX / 1.5, dt * 10 );

		}

		if ( this.wheelFR ) {

			this.wheelFR.rotation.y = lerpAngle( this.wheelFR.rotation.y, -this.inputX / 1.5, dt * 10 );

		}

	}

}
