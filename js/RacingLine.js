import { STRIP_IN, WALL_FACE } from './TrackShape.js';
import { RACE_LINES } from './RaceLines.js';

// The NPCs' racing line and how fast it can be driven. On the built-in
// tracks it's the line the physics found fastest (`npm run sim --
// --optimize`, saved in RaceLines.js): it may run over the kerbs and lean
// on the walls, which cost nothing but the kerbs' drag, and it can cap the
// speed where lifting pays (before a crest, on gravel). Elsewhere (the
// editor's tracks, or a built-in layout changed since) it's the least-
// curved line within the road, keeping the wheels off the kerbs: wide into
// a corner, the apex, wide out.
//
// Its speed profile comes from its curvature (grip), capped at top speed,
// with braking zones from a backward pass at the car's braking rate. On
// gravel the line keeps to the inside, away from the drop, and crests over
// the drop are taken below the speed that would launch the car off them.
//
// One per track, shared by every NPC (racingLine() caches it on the
// centerline); speed profiles are cached by grip and braking.

// grip, brake: m/s²; yaw: rad/s; top: m/s. A car turns at most 4 rad/s
// (Vehicle.js), so a bend of radius R can't be driven faster than about
// yaw · R however much grip there is. Fitted with `npm run sim -- --fit`.
export const DRIVE = { grip: 200, brake: 30, yaw: 99, top: 14.6 };

const STEP = 1; // m between samples
const EDGE = STRIP_IN - 0.6; // a car's outer wheels stay off the rumble strip
const CLIFF_EDGE = 0.4; // how far toward the drop on gravel
const REACH = WALL_FACE - 0.375; // optimized lines: up to leaning on the wall
const CLIFF_REACH = 1.5; // and on gravel, this far toward the drop
export const CONTROL = 3; // m between an optimized line's control points
const GRAVITY = 9.81 * 1.5; // the spheres' gravityFactor (Physics.js)
const SPAN = 2; // m either side for the line's heading and curvature
const _a = [ 0, 0 ], _p = [ 0, 0 ], _b = [ 0, 0 ];

// The least-curved line between the bounds: each point moves (along its
// normal) to where it straightens the bend through its neighbours, the
// minimum of the summed squared second differences
function smooth( cx, cz, lx, lz, lo, hi, closed, iterations = 800 ) {

	const n = cx.length;
	const o = new Float64Array( n );
	const at = ( k ) => closed ? ( k + n ) % n : Math.max( 0, Math.min( n - 1, k ) );

	for ( let it = 0; it < iterations; it ++ ) {

		for ( let i = 0; i < n; i ++ ) {

			if ( ! closed && ( i < 2 || i > n - 3 ) ) continue;

			const a = at( i - 2 ), b = at( i - 1 ), c = at( i + 1 ), d = at( i + 2 );
			const tx = ( - ( cx[ a ] + lx[ a ] * o[ a ] ) + 4 * ( cx[ b ] + lx[ b ] * o[ b ] ) + 4 * ( cx[ c ] + lx[ c ] * o[ c ] ) - ( cx[ d ] + lx[ d ] * o[ d ] ) ) / 6;
			const tz = ( - ( cz[ a ] + lz[ a ] * o[ a ] ) + 4 * ( cz[ b ] + lz[ b ] * o[ b ] ) + 4 * ( cz[ c ] + lz[ c ] * o[ c ] ) - ( cz[ d ] + lz[ d ] * o[ d ] ) ) / 6;
			const want = ( tx - cx[ i ] ) * lx[ i ] + ( tz - cz[ i ] ) * lz[ i ];
			o[ i ] = Math.max( lo[ i ], Math.min( hi[ i ], o[ i ] + ( want - o[ i ] ) * 1.6 ) );

		}

	}

	return o;

}

// Which layout a saved line was optimized for (FNV-1a of the cells,
// heights and gravel)
export function lineHash( track ) {

	const text = JSON.stringify( [ track.cells, track.heights || null, track.unsealed || null ] );
	let h = 0x811c9dc5;

	for ( let i = 0; i < text.length; i ++ ) {

		h ^= text.charCodeAt( i );
		h = Math.imul( h, 0x01000193 ) >>> 0;

	}

	return h.toString( 16 );

}

export function racingLine( line, shape = null ) {

	if ( ! line.racing || ( shape && ! line.racing.shape ) ) line.racing = new RacingLine( line, shape );
	return line.racing;

}

export class RacingLine {

	constructor( line, shape = null ) {

		this.line = line;
		this.shape = shape;

		const n = Math.max( 8, Math.round( line.length / STEP ) );
		const step = line.length / n;
		this.n = n;
		this.step = step;

		const cx = new Float64Array( n ), cz = new Float64Array( n ), lx = new Float64Array( n ), lz = new Float64Array( n );
		const lo = new Float64Array( n ).fill( - EDGE ), hi = new Float64Array( n ).fill( EDGE );
		this.lo = new Float64Array( n ).fill( - REACH ); // an optimized line's bounds
		this.hi = new Float64Array( n ).fill( REACH );
		this.gravel = new Uint8Array( n );
		this.crest = new Float64Array( n ); // speed that would launch the car off a crest over a drop

		for ( let i = 0; i < n; i ++ ) {

			const s = i * step;
			const p = line.pointAt( s ), dir = line.directionAt( s );
			cx[ i ] = p[ 0 ]; cz[ i ] = p[ 1 ];
			lx[ i ] = - Math.cos( dir ); lz[ i ] = Math.sin( dir );

			if ( shape && shape.isUnsealed( s ) ) {

				this.gravel[ i ] = 1;

				if ( shape.outsideAt( s ) > 0 ) {

					hi[ i ] = CLIFF_EDGE;
					this.hi[ i ] = CLIFF_REACH;

				} else {

					lo[ i ] = - CLIFF_EDGE;
					this.lo[ i ] = - CLIFF_REACH;

				}

				const d = 2;
				const bend = - ( line.heightAt( s + d ) - 2 * line.heightAt( s ) + line.heightAt( s - d ) ) / ( d * d );
				if ( bend > 1e-3 ) this.crest[ i ] = Math.sqrt( GRAVITY / bend );

			}

		}

		this.cx = cx; this.cz = cz; this.lx = lx; this.lz = lz;
		this.edges = [ lo, hi ];

		// The line optimized for this layout (npm run sim -- --optimize), or
		// the smooth one
		const saved = shape && RACE_LINES[ shape.track.id ];
		this.optimized = Boolean( saved && saved.hash === lineHash( shape.track ) && line.closed );

		if ( this.optimized ) {

			this.useControl( saved.offsets.map( ( o ) => o / 100 ), saved.caps );

		} else {

			this.use( this.smoothLine() );

		}

	}

	// The least-curved line within the road, wheels off the kerbs
	smoothLine() {

		return smooth( this.cx, this.cz, this.lx, this.lz, this.edges[ 0 ], this.edges[ 1 ], this.line.closed );

	}

	// How many control points an optimized line has (one every CONTROL m)
	get controls() {

		return Math.max( 4, Math.round( this.line.length / CONTROL ) );

	}

	// Drive a line given by offsets at its control points (a Catmull-Rom
	// spline through them, kept within reach of the walls) and speed caps
	// at them (m/s, 0 for none)
	useControl( offsets, caps = null ) {

		const n = this.n, k = offsets.length;
		const o = new Float64Array( n ), c = caps ? new Float64Array( n ) : null;

		for ( let i = 0; i < n; i ++ ) {

			const u = i * k / n, j = Math.floor( u ), t = u - j;
			const p0 = offsets[ ( j - 1 + k ) % k ], p1 = offsets[ j % k ], p2 = offsets[ ( j + 1 ) % k ], p3 = offsets[ ( j + 2 ) % k ];
			const value = 0.5 * ( 2 * p1 + ( p2 - p0 ) * t + ( 2 * p0 - 5 * p1 + 4 * p2 - p3 ) * t * t + ( 3 * p1 - p0 - 3 * p2 + p3 ) * t * t * t );
			o[ i ] = Math.max( this.lo[ i ], Math.min( this.hi[ i ], value ) );
			if ( c ) c[ i ] = caps[ Math.round( u ) % k ];

		}

		this.use( o, c );

	}

	// Drive these offsets (one per sample, + left) and speed caps (m/s, 0
	// for none) instead
	use( offsets, caps = null ) {

		const n = this.n;
		const o = this.offsets = Float64Array.from( offsets );
		this.caps = caps ? Float64Array.from( caps ) : null;
		const { cx, cz, lx, lz } = this;

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

	// A point on the line, taking `share` of its offset (out: [ x, z ])
	pointAt( s, share, out ) {

		const x = this.line.wrap( s ) / this.step;
		const i = Math.floor( x ) % this.n, j = ( i + 1 ) % this.n, t = x - Math.floor( x );
		const oi = this.offsets[ i ] * share, oj = this.offsets[ j ] * share;
		out[ 0 ] = this.cx[ i ] + this.lx[ i ] * oi + ( this.cx[ j ] + this.lx[ j ] * oj - this.cx[ i ] - this.lx[ i ] * oi ) * t;
		out[ 1 ] = this.cz[ i ] + this.lz[ i ] * oi + ( this.cz[ j ] + this.lz[ j ] * oj - this.cz[ i ] - this.lz[ i ] * oi ) * t;
		return out;

	}

	// The line's heading at s (as the cars' headings: atan2( x, z )) and
	// its curvature (rad/m, + where the heading grows), over ±SPAN m
	pose( s, share, out ) {

		const a = this.pointAt( s - SPAN, share, _a ), p = this.pointAt( s, share, _p ), b = this.pointAt( s + SPAN, share, _b );
		const h0 = Math.atan2( p[ 0 ] - a[ 0 ], p[ 1 ] - a[ 1 ] ), h1 = Math.atan2( b[ 0 ] - p[ 0 ], b[ 1 ] - p[ 1 ] );
		let turn = h1 - h0;
		turn -= Math.round( turn / ( 2 * Math.PI ) ) * 2 * Math.PI;
		out.heading = Math.atan2( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		out.curvature = 2 * turn / ( Math.hypot( p[ 0 ] - a[ 0 ], p[ 1 ] - a[ 1 ] ) + Math.hypot( b[ 0 ] - p[ 0 ], b[ 1 ] - p[ 1 ] ) || 1 );
		return out;

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
			if ( this.caps && this.caps[ i ] ) v[ i ] = Math.min( v[ i ], this.caps[ i ] );

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
