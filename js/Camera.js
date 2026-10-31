import * as THREE from 'three';

const _desired = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _lookPoint = new THREE.Vector3();
const _ray = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _probe = new THREE.PerspectiveCamera();

const BASE_FOV = 40;
const MAX_FOV = 60;
export const BASE_NEAR = 0.1;
const BASE_FAR = 60;

// Narrowest ground half-width (world units) the view may show across the
// screen. A 16:9 landscape view shows ~10; portrait phones fall far below
// that at the base FOV, so they widen the FOV and then pull the camera back.
const MIN_GROUND_HALF_WIDTH = 7;

export class Camera {

	constructor() {

		this.camera = new THREE.PerspectiveCamera( BASE_FOV, window.innerWidth / window.innerHeight, BASE_NEAR, BASE_FAR );

		// Matches Godot View: 45° azimuth, 35° elevation, distance 16
		this.offset = new THREE.Vector3( 9.27, 9.18, 9.27 );

		this.camera.position.copy( this.offset );
		this.camera.lookAt( 0, 0, 0 );

		// Camera-aligned ground basis (XZ plane), derived from offset.
		// camRightXZ: screen-right projected to ground.
		// camForwardXZ: screen-up (away from camera) projected to ground.
		this.camRightXZ = new THREE.Vector3( this.offset.z, 0, - this.offset.x ).normalize();
		this.camForwardXZ = new THREE.Vector3( - this.offset.x, 0, - this.offset.z ).normalize();

		this.leadFactor = 3.0;
		this.cameraSmoothing = 2.0;
		this.deadzoneRadius = 5.0;
		this.screenShiftUp = 1.0;

		// Set per viewport: dolly factor and deadzone radii along screen
		// right / screen up (an ellipse on narrow screens)
		this.zoomOut = 1;
		this.deadzoneX = this.deadzoneRadius;
		this.deadzoneY = this.deadzoneRadius;

		const distance = this.offset.length();
		const tanBase = Math.tan( THREE.MathUtils.degToRad( BASE_FOV / 2 ) );
		this.sinElevation = this.offset.y / distance;
		this.refHalfX = distance * tanBase * 16 / 9;
		this.refHalfY = distance * tanBase / this.sinElevation;

		this.smoothedDesired = new THREE.Vector3();
		this.initialized = false;

		// Where the camera looks (world), and the ground under the view's four
		// corners relative to it: what the sun's shadow box has to cover
		this.lookPoint = new THREE.Vector3();
		this.footprint = [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ];

		const segments = 64;
		const points = [];
		for ( let i = 0; i <= segments; i ++ ) {

			const a = ( i / segments ) * Math.PI * 2;
			points.push( new THREE.Vector3( Math.cos( a ), 0, Math.sin( a ) ) );

		}
		const dzGeom = new THREE.BufferGeometry().setFromPoints( points );
		this.debug = new THREE.Line( dzGeom, new THREE.LineBasicMaterial( { color: 0xff00ff, depthTest: false } ) );
		this.debug.visible = false;
		this.debug.renderOrder = 999;
		this.debug.quaternion.setFromRotationMatrix(
			new THREE.Matrix4().makeBasis( this.camRightXZ, new THREE.Vector3( 0, 1, 0 ), this.camForwardXZ )
		);

	}

	// Extra camera distance from the dolly, for pushing fog and far plane out
	get extraDistance() {

		return ( this.zoomOut - 1 ) * this.offset.length();

	}

	setViewport( width, height ) {

		const aspect = width / height;
		const distance = this.offset.length();

		let tanV = Math.tan( THREE.MathUtils.degToRad( BASE_FOV / 2 ) );
		const minTanH = MIN_GROUND_HALF_WIDTH / distance;
		if ( tanV * aspect < minTanH ) tanV = minTanH / aspect;

		const tanMax = Math.tan( THREE.MathUtils.degToRad( MAX_FOV / 2 ) );
		this.zoomOut = Math.max( 1, tanV / tanMax );
		tanV = Math.min( tanV, tanMax );

		this.camera.aspect = aspect;
		this.camera.fov = THREE.MathUtils.radToDeg( 2 * Math.atan( tanV ) );
		this.camera.far = BASE_FAR + this.extraDistance;
		this.camera.updateProjectionMatrix();

		// Shrink the deadzone along a screen axis that shows less ground than
		// the 16:9 reference, so the car never leads itself off the edge
		const halfX = distance * this.zoomOut * tanV * aspect;
		const halfY = distance * this.zoomOut * tanV / this.sinElevation;
		this.deadzoneX = this.deadzoneRadius * Math.min( 1, halfX / this.refHalfX );
		this.deadzoneY = this.deadzoneRadius * Math.min( 1, halfY / this.refHalfY );

		this.updateFootprint();

	}

	// The view's corner rays hit the ground (half a unit below the look point,
	// which sits above the car) or, toward the horizon, end at the far plane
	updateFootprint() {

		_probe.copy( this.camera );
		_probe.position.copy( this.offset ).multiplyScalar( this.zoomOut );
		_probe.lookAt( 0, 0, 0 );
		_probe.updateMatrixWorld();

		_origin.copy( _probe.position );
		const groundY = - 0.5;

		for ( let i = 0; i < 4; i ++ ) {

			_ray.set( i & 1 ? 1 : - 1, i & 2 ? 1 : - 1, 0.5 ).unproject( _probe ).sub( _origin ).normalize();

			let t = _ray.y < 0 ? ( groundY - _origin.y ) / _ray.y : Infinity;
			t = Math.min( t, this.camera.far );

			this.footprint[ i ].copy( _origin ).addScaledVector( _ray, t );
			this.footprint[ i ].y = groundY;

		}

	}

	update( dt, target, velocity ) {

		const rx = this.deadzoneX;
		const ry = this.deadzoneY;

		// Lead = velocity projected onto camera-aligned ground basis, scaled, clamped to the deadzone ellipse.
		// Becomes the camera's offset from the car: car settles at the trailing edge of the ellipse.
		let leadX = velocity.dot( this.camRightXZ ) * this.leadFactor;
		let leadY = velocity.dot( this.camForwardXZ ) * this.leadFactor;
		const leadNorm = ( leadX / rx ) ** 2 + ( leadY / ry ) ** 2;
		if ( leadNorm > 1 ) {

			const k = 1 / Math.sqrt( leadNorm );
			leadX *= k;
			leadY *= k;

		}

		_desired.copy( target )
			.addScaledVector( this.camRightXZ, leadX )
			.addScaledVector( this.camForwardXZ, leadY );

		const alpha = this.initialized ? 1 - Math.exp( - dt * this.cameraSmoothing ) : 1;
		this.smoothedDesired.lerp( _desired, alpha );
		this.initialized = true;

		// Hard-clamp: car must not escape the deadzone, even if the lerp lags at high speed.
		_delta.subVectors( target, this.smoothedDesired );
		const offsetX = _delta.dot( this.camRightXZ );
		const offsetY = _delta.dot( this.camForwardXZ );
		const offsetNorm = ( offsetX / rx ) ** 2 + ( offsetY / ry ) ** 2;
		if ( offsetNorm > 1 ) {

			const k = 1 - 1 / Math.sqrt( offsetNorm );
			this.smoothedDesired
				.addScaledVector( this.camRightXZ, offsetX * k )
				.addScaledVector( this.camForwardXZ, offsetY * k );

		}

		// Shift the entire view (camera + lookAt) so smoothedDesired sits higher on screen.
		_lookPoint.copy( this.smoothedDesired ).addScaledVector( this.camForwardXZ, - this.screenShiftUp );

		this.camera.position.copy( _lookPoint ).addScaledVector( this.offset, this.zoomOut );
		this.camera.lookAt( _lookPoint );
		this.lookPoint.copy( _lookPoint );

		this.debug.position.copy( this.smoothedDesired );
		this.debug.position.y += 0.05;
		this.debug.scale.set( rx, 1, ry );

	}

}
