import * as THREE from 'three';
import { ROAD_Y } from './TrackShape.js';

// The short fly-over before a race: a high look at the whole track, a
// sweep along one lap (over the bridge, past the cliff top), and a descent
// onto the chase camera behind the player's car, then the countdown. It only
// moves the camera; the cars wait on the grid.

const OVERVIEW = 0.9; // s
const SWEEP = 3.6;
const LAND = 0.9;
const HEIGHT = 13; // over the road
const BACK = 9; // behind the look point

const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function smooth( t ) {

	t = Math.max( 0, Math.min( 1, t ) );
	return t * t * ( 3 - 2 * t );

}

export class Flyover {

	// line: the centerline (with heights); bounds: Track.computeTrackBounds
	constructor( line, bounds ) {

		const points = [];
		for ( let s = 0; s < line.length; s += 6 ) {

			const p = line.pointAt( s );
			points.push( new THREE.Vector3( p[ 0 ], ROAD_Y + line.heightAt( s ), p[ 1 ] ) );

		}

		this.curve = new THREE.CatmullRomCurve3( points, line.closed, 'centripetal' );
		this.centre = new THREE.Vector3( bounds.centerX, 0, bounds.centerZ );
		this.size = Math.max( bounds.halfWidth, bounds.halfDepth );
		this.duration = OVERVIEW + SWEEP + LAND;
		this.t = 0;
		this.done = false;
		this.direction = new THREE.Vector3();
		this.lookAt = new THREE.Vector3();

	}

	// The pose at time t; `chase` (position, look point) is where it lands
	pose( t, chasePosition, chaseLook, outPos, outLook ) {

		// Overview, from the same side the chase camera looks from
		const over = _a.set( 0.55, 1, 0.55 ).normalize().multiplyScalar( this.size * 2.1 ).add( this.centre );
		const overLook = _b.copy( this.centre );

		if ( t < OVERVIEW ) {

			outPos.copy( over );
			outLook.copy( overLook );
			return;

		}

		const u = ( t - OVERVIEW ) / SWEEP;
		const k = Math.min( 1, u );
		const at = this.curve.getPointAt( ( k * 0.999 + 1 ) % 1 );
		const ahead = this.curve.getPointAt( ( k * 0.999 + 0.035 ) % 1 );
		this.direction.subVectors( ahead, at ).setY( 0 ).normalize();

		_pos.copy( at ).addScaledVector( this.direction, - BACK ).setY( at.y + HEIGHT );
		_look.copy( ahead );

		// Ease in from the overview, then down onto the chase camera
		const into = smooth( u / 0.25 );
		outPos.lerpVectors( over, _pos, into );
		outLook.lerpVectors( overLook, _look, into );

		if ( u > 1 ) {

			const land = smooth( ( t - OVERVIEW - SWEEP ) / LAND );
			outPos.lerp( chasePosition, land );
			outLook.lerp( chaseLook, land );

		}

	}

	update( dt ) {

		this.t += dt;
		if ( this.t >= this.duration ) this.done = true;

	}

	skip() {

		this.done = true;

	}

}
