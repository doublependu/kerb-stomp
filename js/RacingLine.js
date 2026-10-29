import { STRIP_IN } from './TrackShape.js';

// The NPCs' racing line and how fast it can be driven. The line is an
// elastic band pulled tight between the walls (the centerline smoothed
// within the road, keeping the wheels off the kerbs), which takes the
// corners wide-tight-wide the way a racing driver does. Its speed profile
// comes from its curvature (grip), capped at top speed, with braking zones
// from a backward pass at the car's braking rate. On gravel the line keeps
// to the inside, away from the drop, and crests over the drop are taken
// below the speed that would launch the car off them.
//
// One per track, shared by every NPC (racingLine() caches it on the
// centerline); speed profiles are cached by grip and braking.

// grip, brake: m/s²; yaw: rad/s; top: m/s. A car turns at most 4 rad/s
// (Vehicle.js), so a bend of radius R can't be driven faster than about
// yaw · R however much grip there is. Fitted with `npm run sim -- --fit`.
export const DRIVE = { grip: 200, brake: 30, yaw: 99, top: 14.6 };

const STEP = 1; // m between samples
const ITERATIONS = 400;
const EDGE = STRIP_IN - 0.6; // a car's outer wheels stay off the rumble strip
const CLIFF_EDGE = 0.4; // how far toward the drop on gravel
const GRAVITY = 9.81 * 1.5; // the spheres' gravityFactor (Physics.js)

export function racingLine( line, shape = null ) {

	if ( ! line.racing || ( shape && ! line.racing.shape ) ) line.racing = new RacingLine( line, shape );
	return line.racing;

}

export class RacingLine {

	constructor( line, shape = null ) {

		this.line = line;
		this.shape = shape;
		this.weight = shape && shape.track.aiLine !== undefined ? shape.track.aiLine : 1;

		const n = Math.max( 8, Math.round( line.length / STEP ) );
		const step = line.length / n;
		this.n = n;
		this.step = step;

		const cx = new Float64Array( n ), cz = new Float64Array( n ), lx = new Float64Array( n ), lz = new Float64Array( n );
		const lo = new Float64Array( n ).fill( - EDGE ), hi = new Float64Array( n ).fill( EDGE );
		this.gravel = new Uint8Array( n );
		this.crest = new Float64Array( n ); // speed that would launch the car off a crest over a drop

		for ( let i = 0; i < n; i ++ ) {

			const s = i * step;
			const p = line.pointAt( s ), dir = line.directionAt( s );
			cx[ i ] = p[ 0 ]; cz[ i ] = p[ 1 ];
			lx[ i ] = - Math.cos( dir ); lz[ i ] = Math.sin( dir );

			if ( shape && shape.isUnsealed( s ) ) {

				this.gravel[ i ] = 1;
				if ( shape.outsideAt( s ) > 0 ) hi[ i ] = CLIFF_EDGE;
				else lo[ i ] = - CLIFF_EDGE;

				const d = 2;
				const bend = - ( line.heightAt( s + d ) - 2 * line.heightAt( s ) + line.heightAt( s - d ) ) / ( d * d );
				if ( bend > 1e-3 ) this.crest[ i ] = Math.sqrt( GRAVITY / bend );

			}

		}

		// Pull the band tight
		const o = new Float64Array( n );
		const closed = line.closed;

		for ( let it = 0; it < ITERATIONS; it ++ ) {

			for ( let i = 0; i < n; i ++ ) {

				if ( ! closed && ( i === 0 || i === n - 1 ) ) continue;

				const a = ( i - 1 + n ) % n, b = ( i + 1 ) % n;
				const mx = ( cx[ a ] + lx[ a ] * o[ a ] + cx[ b ] + lx[ b ] * o[ b ] ) / 2;
				const mz = ( cz[ a ] + lz[ a ] * o[ a ] + cz[ b ] + lz[ b ] * o[ b ] ) / 2;
				o[ i ] = Math.max( lo[ i ], Math.min( hi[ i ], ( mx - cx[ i ] ) * lx[ i ] + ( mz - cz[ i ] ) * lz[ i ] ) );

			}

		}

		for ( let i = 0; i < n; i ++ ) o[ i ] *= this.weight;
		this.offsets = o;

		// Curvature of the line (Menger: 4·area / product of the sides),
		// over a few metres so the samples' kinks don't count
		this.curvature = new Float64Array( n );
		const span = 3;

		for ( let i = 0; i < n; i ++ ) {

			const a = ( i - span + n ) % n, b = ( i + span ) % n;
			const ax = cx[ a ] + lx[ a ] * o[ a ], az = cz[ a ] + lz[ a ] * o[ a ];
			const px = cx[ i ] + lx[ i ] * o[ i ], pz = cz[ i ] + lz[ i ] * o[ i ];
			const bx = cx[ b ] + lx[ b ] * o[ b ], bz = cz[ b ] + lz[ b ] * o[ b ];
			const area2 = Math.abs( ( px - ax ) * ( bz - az ) - ( pz - az ) * ( bx - ax ) );
			const sides = Math.hypot( px - ax, pz - az ) * Math.hypot( bx - px, bz - pz ) * Math.hypot( bx - ax, bz - az );
			this.curvature[ i ] = sides > 1e-9 ? 2 * area2 / sides : 0;

		}

		this.profiles = new Map();

	}

	// The line's offset from the centerline at s (+ left), as TrackPath's
	// projections measure lateral
	offsetAt( s ) {

		const x = this.line.wrap( s ) / this.step;
		const i = Math.floor( x ) % this.n, t = x - Math.floor( x );
		return this.offsets[ i ] + ( this.offsets[ ( i + 1 ) % this.n ] - this.offsets[ i ] ) * t;

	}

	// Speeds (m/s) along the line for a driver using `grip` of lateral
	// acceleration and braking at `brake`
	profile( grip, brake ) {

		const key = grip.toFixed( 1 ) + ':' + brake.toFixed( 1 ) + ':' + DRIVE.yaw;
		if ( this.profiles.has( key ) ) return this.profiles.get( key );

		const n = this.n;
		const v = new Float64Array( n );

		for ( let i = 0; i < n; i ++ ) {

			const g = this.gravel[ i ] ? grip * 0.75 : grip;
			const k = Math.max( 1e-4, this.curvature[ i ] );
			v[ i ] = Math.min( DRIVE.top, Math.sqrt( g / k ), DRIVE.yaw / k );
			if ( this.crest[ i ] ) v[ i ] = Math.min( v[ i ], this.crest[ i ] );

		}

		// Braking zones: twice round for a closed loop
		for ( let pass = 0; pass < 2; pass ++ ) {

			for ( let i = n - 1; i >= 0; i -- ) {

				const next = ( i + 1 ) % n;
				if ( ! this.line.closed && next === 0 ) continue;
				v[ i ] = Math.min( v[ i ], Math.sqrt( v[ next ] * v[ next ] + 2 * brake * this.step ) );

			}

		}

		this.profiles.set( key, v );
		return v;

	}

	speedAt( profile, s ) {

		const x = this.line.wrap( s ) / this.step;
		const i = Math.floor( x ) % this.n, t = x - Math.floor( x );
		return profile[ i ] + ( profile[ ( i + 1 ) % this.n ] - profile[ i ] ) * t;

	}

}
