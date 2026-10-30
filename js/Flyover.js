import * as THREE from 'three';
import { ROAD_Y } from './TrackShape.js';
import { CELL } from './TrackPath.js';

// The slow aerial view before a race: the whole track from nearly overhead
// (under the track's name card), then an orbit of about 150° round it while
// the camera lowers, ending on the chase camera's side (+x +z), and down
// onto the player's car; then the countdown. The camera aims at the track's
// centre from as far as the screen's shape needs to keep the whole track in
// view (portrait phones included). It only moves the camera; the cars wait
// on the grid. Eased throughout: no cuts, no stops.

const OVERHEAD = 1.2; // s
const ORBIT = 5.3;
const LAND = 1.5;
const BLEND = 0.4; // the landing starts this long before the orbit ends

const TURN = THREE.MathUtils.degToRad( 150 );
const END_AZIMUTH = Math.PI / 4; // the chase camera's side
const ELEVATION = [ THREE.MathUtils.degToRad( 70 ), THREE.MathUtils.degToRad( 40 ) ];
const MARGIN = 0.92; // of the view the track's box may fill
const HAZE = 250; // m from clear to fog

// Grass under everything, as far as the eye sees from up there (the
// ground's tiles end a few cells out); uv: a grass swatch in the material's
// colormap. Only shown while flying over.
export function horizonMesh( material, uv, centreX, centreZ ) {

	const geometry = new THREE.PlaneGeometry( 4000, 4000 ).rotateX( - Math.PI / 2 ).translate( centreX, ROAD_Y - 0.05, centreZ );
	const uvs = geometry.getAttribute( 'uv' );
	for ( let i = 0; i < uvs.count; i ++ ) uvs.setXY( i, uv[ 0 ], uv[ 1 ] );
	const mesh = new THREE.Mesh( geometry, material );
	mesh.visible = false;
	return mesh;

}

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _corner = new THREE.Vector3();
const _y = new THREE.Vector3( 0, 1, 0 );

function smooth( t ) {

	t = Math.max( 0, Math.min( 1, t ) );
	return t * t * ( 3 - 2 * t );

}

export class Flyover {

	// line: the centerline (with heights); bounds: Track.computeTrackBounds
	// (a cell of margin round the track); camera: the perspective camera it
	// moves (its fov and aspect frame the track)
	constructor( line, bounds, camera ) {

		this.camera = camera;
		const top = ROAD_Y + ( line.profile ? line.profile.max : 0 ) + 2;
		this.centre = new THREE.Vector3( bounds.centerX, ( ROAD_Y + top ) / 2, bounds.centerZ );

		// The track's box, relative to its centre
		this.corners = [];
		for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) for ( const y of [ ROAD_Y, top ] ) this.corners.push( new THREE.Vector3( sx * bounds.halfWidth, y - this.centre.y, sz * bounds.halfDepth ) );

		// Ground points round the centre for the sun's shadow box while the
		// whole track shows (SunShadow.fit), and how far out the scenery goes
		this.footprint = this.corners.filter( ( c ) => c.y < 0 );
		this.reach = Math.hypot( bounds.halfWidth, bounds.halfDepth ) + CELL;

		this.duration = OVERHEAD + ORBIT + LAND;
		this.t = 0;
		this.done = false;

	}

	// How far from the centre, looking along -dir, the camera has to be for
	// every corner of the track's box to be on screen
	distance( dir ) {

		const camera = this.camera;
		const tanV = Math.tan( THREE.MathUtils.degToRad( camera.fov / 2 ) ) * MARGIN;
		const tanH = tanV * camera.aspect;
		_right.crossVectors( _y, dir ).normalize();
		_up.crossVectors( dir, _right );

		let d = 0;

		for ( const c of this.corners ) {

			const depth = c.dot( dir );
			d = Math.max( d, depth + Math.abs( c.dot( _right ) ) / tanH, depth + Math.abs( c.dot( _up ) ) / tanV );

		}

		return d;

	}

	// The pose at time t; chase (position, look point) is where it lands
	pose( t, chasePosition, chaseLook, outPos, outLook ) {

		const k = smooth( ( t - OVERHEAD ) / ORBIT );
		const azimuth = END_AZIMUTH - TURN * ( 1 - k );
		const elevation = ELEVATION[ 0 ] + ( ELEVATION[ 1 ] - ELEVATION[ 0 ] ) * k;

		_dir.set( Math.sin( azimuth ) * Math.cos( elevation ), Math.sin( elevation ), Math.cos( azimuth ) * Math.cos( elevation ) );
		outPos.copy( this.centre ).addScaledVector( _dir, this.distance( _dir ) );
		outLook.copy( this.centre );

		const land = smooth( ( t - OVERHEAD - ORBIT + BLEND ) / ( LAND + BLEND ) );

		if ( land > 0 ) {

			outPos.lerp( chasePosition, land );
			outLook.lerp( chaseLook, land );

		}

	}

	// Haze from just past the scenery, wherever the camera is: the ground
	// beyond fades into the sky
	fog( fog, position ) {

		fog.near = position.distanceTo( this.centre ) + this.reach;
		fog.far = fog.near + HAZE;

	}

	update( dt ) {

		this.t += dt;
		if ( this.t >= this.duration ) this.done = true;

	}

	skip() {

		this.done = true;

	}

}
