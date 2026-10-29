// Track geometry beyond the cell list: the centerline in driving order (for
// NPC drivers, race positions and the starting grid), and the layout strings
// the built-in tracks are written in. Shared with scripts/playtest and
// scripts/sim, so nothing here touches the DOM.

import { CELL_RAW, GRID_SCALE, ORIENT_DEG, computeSpawnPosition } from './Track.js';

export const CELL = CELL_RAW * GRID_SCALE;

const DIRS = { N: [ 0, - 1 ], S: [ 0, 1 ], E: [ 1, 0 ], W: [ - 1, 0 ] };
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
const HEADINGS = [ 'N', 'E', 'S', 'W' ];

// Corner orientations by exit pair (matches the editor's auto-tiler)
const CORNER_EXITS = { 0: [ 'S', 'W' ], 16: [ 'S', 'E' ], 10: [ 'N', 'E' ], 22: [ 'N', 'W' ] };

export function cellExits( type, orient ) {

	if ( type === 'track-corner' ) return CORNER_EXITS[ orient ];
	return orient === 0 || orient === 10 ? [ 'N', 'S' ] : [ 'E', 'W' ];

}

function dirFromAngle( angle ) {

	const fx = Math.round( Math.sin( angle ) ), fz = Math.round( Math.cos( angle ) );
	return Object.keys( DIRS ).find( ( d ) => DIRS[ d ][ 0 ] === fx && DIRS[ d ][ 1 ] === fz );

}

export function wrapAngle( a ) {

	while ( a > Math.PI ) a -= Math.PI * 2;
	while ( a < - Math.PI ) a += Math.PI * 2;
	return a;

}

// The edge a neighbouring cell is across
function dirTo( a, b ) {

	return Object.keys( DIRS ).find( ( d ) => DIRS[ d ][ 0 ] === b[ 0 ] - a[ 0 ] && DIRS[ d ][ 1 ] === b[ 1 ] - a[ 1 ] );

}

// One cell's points, entry edge to exit edge, and their cell parameter u
// (cell index + fraction of the way through it)
function cellPoints( cell, entry, exit, index, points, us ) {

	const cx = ( cell[ 0 ] + 0.5 ) * CELL;
	const cz = ( cell[ 1 ] + 0.5 ) * CELL;
	const e = DIRS[ entry ], x = DIRS[ exit ];
	const r = CELL / 2;

	if ( entry === OPPOSITE[ exit ] ) {

		for ( let i = 0; i < 6; i ++ ) {

			const t = i / 6;
			points.push( [ cx + r * ( e[ 0 ] + ( x[ 0 ] - e[ 0 ] ) * t ), cz + r * ( e[ 1 ] + ( x[ 1 ] - e[ 1 ] ) * t ) ] );
			us.push( index + t );

		}

	} else {

		const px = cx + ( e[ 0 ] + x[ 0 ] ) * r;
		const pz = cz + ( e[ 1 ] + x[ 1 ] ) * r;

		for ( let i = 0; i < 8; i ++ ) {

			const a = ( i / 8 ) * Math.PI / 2;
			points.push( [
				px + r * ( - x[ 0 ] * Math.cos( a ) - e[ 0 ] * Math.sin( a ) ),
				pz + r * ( - x[ 1 ] * Math.cos( a ) - e[ 1 ] * Math.sin( a ) ),
			] );
			us.push( index + i / 8 );

		}

	}

}

// Entry and exit edges of cell i of a loop given in driving order
export function passEdges( cells, i ) {

	const n = cells.length;
	return [ dirTo( cells[ i ], cells[ ( i - 1 + n ) % n ] ), dirTo( cells[ i ], cells[ ( i + 1 ) % n ] ) ];

}

// Points from the entry edge to the exit edge of each cell: straight lines,
// quarter arcs (radius CELL/2 around the shared cell corner) for corners.
// Starts at the entry edge of the finish cell, so the finish line (the cell's
// centre) is at s = CELL / 2.
//
// ordered: the cells are a loop in driving order (the built-in tracks),
// walked as listed. A track that crosses itself lists its crossing cell once
// per pass, which a walk by grid position can't follow. heights: road height
// (m) at each cell's centre, for tracks with hills.
export function centerline( cells, spawnAngle = computeSpawnPosition( cells ).angle, { ordered = false, heights = null } = {} ) {

	const points = [];
	const us = [];
	let closed = false;

	if ( ordered ) {

		cells.forEach( ( cell, i ) => {

			const [ entry, exit ] = passEdges( cells, i );
			cellPoints( cell, entry, exit, i, points, us );

		} );

		closed = true;

	} else {

		const byKey = new Map( cells.map( ( c ) => [ c[ 0 ] + ',' + c[ 1 ], c ] ) );
		const start = cells.find( ( c ) => c[ 2 ] === 'track-finish' ) || cells[ 0 ];

		let cell = start;
		let exit = dirFromAngle( spawnAngle );
		let entry = OPPOSITE[ exit ];

		for ( let index = 0; index < cells.length + 1; index ++ ) {

			cellPoints( cell, entry, exit, index, points, us );

			const x = DIRS[ exit ];
			const next = byKey.get( ( cell[ 0 ] + x[ 0 ] ) + ',' + ( cell[ 1 ] + x[ 1 ] ) );

			if ( ! next ) {

				points.push( [ ( cell[ 0 ] + 0.5 + x[ 0 ] / 2 ) * CELL, ( cell[ 1 ] + 0.5 + x[ 1 ] / 2 ) * CELL ] );
				us.push( index + 1 );
				break;

			}

			const nextEntry = OPPOSITE[ exit ];
			const exits = cellExits( next[ 2 ], next[ 3 ] );
			if ( ! exits.includes( nextEntry ) ) break;

			if ( next === start ) {

				closed = true;
				break;

			}

			cell = next;
			entry = nextEntry;
			exit = exits[ 0 ] === nextEntry ? exits[ 1 ] : exits[ 0 ];

		}

	}

	const line = new Polyline( points, closed, us );
	if ( heights ) line.profile = new Profile( heights );
	return line;

}

// Road height along the lap: straight ramps between each cell's height at
// its centre, rounded over FILLET of a cell either side of each centre (a
// parabola, so it never overshoots). A climb is a steady gradient (the
// height step per cell over the cell's length); a crest is a cell higher
// than both neighbours, and the steeper the ramps either side, the tighter
// it is and the slower a car can take it without leaving the ground.
const FILLET = 0.22;

export class Profile {

	constructor( heights ) {

		this.heights = heights;
		this.n = heights.length;
		this.max = Math.max( ...heights );

	}

	// u: cell parameter (cell index + fraction); slope: dh/du instead
	at( u, slope = false ) {

		const n = this.n, h = this.heights;
		const x = ( ( ( u - 0.5 ) % n ) + n ) % n; // cell centres at whole x
		const k = Math.round( x ) % n;
		const d = x - Math.round( x );
		const y = h[ k ];
		const left = y - h[ ( k - 1 + n ) % n ], right = h[ ( k + 1 ) % n ] - y;

		if ( d <= - FILLET ) return slope ? left : y + left * d;
		if ( d >= FILLET ) return slope ? right : y + right * d;

		const q = d + FILLET;
		return slope ? left + ( right - left ) * q / ( 2 * FILLET ) : y + left * d + ( right - left ) * q * q / ( 4 * FILLET );

	}

}

export class Polyline {

	constructor( points, closed, us = null ) {

		this.points = points;
		this.closed = closed;
		this.us = us;
		this.profile = null;
		this.cumulative = [ 0 ];

		const n = closed ? points.length : points.length - 1;

		for ( let i = 0; i < n; i ++ ) {

			const a = points[ i ], b = points[ ( i + 1 ) % points.length ];
			this.cumulative.push( this.cumulative[ i ] + Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ) );

		}

		this.length = this.cumulative[ this.cumulative.length - 1 ];
		this.segments = n;

	}

	// Closest point near a previous segment index (searching a window keeps a
	// car on one straight from snapping to a parallel one)
	project( x, z, hint = null, window = 12 ) {

		let best = null;
		const range = hint === null ? [ 0, this.segments ] : [ hint - 3, hint + window ];

		for ( let k = range[ 0 ]; k < range[ 1 ]; k ++ ) {

			const i = this.closed ? ( ( k % this.segments ) + this.segments ) % this.segments : Math.max( 0, Math.min( this.segments - 1, k ) );
			const a = this.points[ i ], b = this.points[ ( i + 1 ) % this.points.length ];
			const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ];
			const len2 = dx * dx + dz * dz;
			const t = Math.max( 0, Math.min( 1, ( ( x - a[ 0 ] ) * dx + ( z - a[ 1 ] ) * dz ) / len2 ) );
			const px = a[ 0 ] + dx * t, pz = a[ 1 ] + dz * t;
			const d2 = ( x - px ) ** 2 + ( z - pz ) ** 2;

			if ( best === null || d2 < best.d2 ) {

				// Signed lateral offset: + is left of the driving direction
				const cross = dx * ( z - a[ 1 ] ) - dz * ( x - a[ 0 ] );
				best = { index: i, s: this.cumulative[ i ] + Math.sqrt( len2 ) * t, d2, lateral: Math.sign( cross ) * Math.sqrt( d2 ) };

			}

		}

		return best;

	}

	wrap( s ) {

		if ( this.closed ) return ( ( s % this.length ) + this.length ) % this.length;
		return Math.max( 0, Math.min( this.length, s ) );

	}

	segmentAt( s ) {

		s = this.wrap( s );

		let lo = 0, hi = this.segments - 1;

		while ( lo < hi ) {

			const mid = ( lo + hi + 1 ) >> 1;
			if ( this.cumulative[ mid ] <= s ) lo = mid;
			else hi = mid - 1;

		}

		return lo;

	}

	pointAt( s, out = [ 0, 0 ] ) {

		s = this.wrap( s );
		const i = this.segmentAt( s );
		const a = this.points[ i ], b = this.points[ ( i + 1 ) % this.points.length ];
		const t = ( s - this.cumulative[ i ] ) / ( this.cumulative[ i + 1 ] - this.cumulative[ i ] || 1 );

		out[ 0 ] = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t;
		out[ 1 ] = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t;
		return out;

	}

	directionAt( s ) {

		const a = this.pointAt( s - 0.3 ), b = this.pointAt( s + 0.3 );
		return Math.atan2( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );

	}

	// Cell parameter at s (index of the cell, plus how far through it)
	uAt( s ) {

		s = this.wrap( s );
		const i = this.segmentAt( s );
		const n = this.points.length;
		const u0 = this.us[ i ];
		let u1 = this.us[ ( i + 1 ) % n ];
		if ( u1 < u0 ) u1 = Math.ceil( u0 ); // the closing segment, into cell 0 of the next lap
		const t = ( s - this.cumulative[ i ] ) / ( this.cumulative[ i + 1 ] - this.cumulative[ i ] || 1 );
		return u0 + ( u1 - u0 ) * t;

	}

	cellAt( s ) {

		return Math.floor( this.uAt( s ) ) % ( this.profile ? this.profile.n : Infinity );

	}

	// Road height (m above the flat ground) and its slope along the lap
	heightAt( s ) {

		return this.profile ? this.profile.at( this.uAt( s ) ) : 0;

	}

	slopeAt( s ) {

		if ( ! this.profile ) return 0;
		return ( this.heightAt( s + 0.25 ) - this.heightAt( s - 0.25 ) ) / 0.5;

	}

	// Signed heading change over the next `distance` metres (+ = turning left)
	turnAhead( s, distance ) {

		return wrapAngle( this.directionAt( s + distance ) - this.directionAt( s ) );

	}

}

// Encode a loop given as grid cells in driving order; the finish goes on
// `finishIndex` (must be a straight). Returns cells for the game.
export function loopCells( path, finishIndex ) {

	const dirTo = ( a, b ) => Object.keys( DIRS ).find( ( d ) => DIRS[ d ][ 0 ] === b[ 0 ] - a[ 0 ] && DIRS[ d ][ 1 ] === b[ 1 ] - a[ 1 ] );
	const cornerOrient = ( a, b ) => Number( Object.keys( CORNER_EXITS ).find( ( o ) => CORNER_EXITS[ o ].includes( a ) && CORNER_EXITS[ o ].includes( b ) ) );

	return path.map( ( p, i ) => {

		const prev = path[ ( i - 1 + path.length ) % path.length ];
		const next = path[ ( i + 1 ) % path.length ];
		const entry = dirTo( p, prev ), exit = dirTo( p, next );

		if ( entry === OPPOSITE[ exit ] ) {

			if ( i === finishIndex ) {

				const orient = Number( Object.keys( ORIENT_DEG ).find( ( o ) => dirFromAngle( ORIENT_DEG[ o ] * Math.PI / 180 ) === exit ) );
				return [ p[ 0 ], p[ 1 ], 'track-finish', orient ];

			}

			return [ p[ 0 ], p[ 1 ], 'track-straight', exit === 'N' || exit === 'S' ? 0 : 16 ];

		}

		return [ p[ 0 ], p[ 1 ], 'track-corner', cornerOrient( entry, exit ) ];

	} );

}

// Layout strings: one letter per cell in driving order, starting on the
// finish straight heading `heading` (N/E/S/W). S = straight, L / R = corner
// turning left / right.
export function layoutPath( layout, heading = 'N' ) {

	let x = 0, z = 0, h = HEADINGS.indexOf( heading );
	const path = [];

	for ( const c of layout.replace( /\s/g, '' ) ) {

		path.push( [ x, z ] );
		if ( c === 'R' ) h = ( h + 1 ) % 4;
		else if ( c === 'L' ) h = ( h + 3 ) % 4;
		else if ( c !== 'S' ) throw new Error( `Unknown layout letter ${ c }` );

		const d = DIRS[ HEADINGS[ h ] ];
		x += d[ 0 ];
		z += d[ 1 ];

	}

	return { path, end: [ x, z ], heading: HEADINGS[ h ] };

}

// Problems that would make a layout unplayable or confuse the editor's
// auto-tiler; empty when the layout is fine. One cell may be used twice: a
// crossing of two straights at right angles, one pass bridged at least
// BRIDGE_CLEARANCE over the other (heights: one per cell, m).
export const BRIDGE_CLEARANCE = 3.5;

export function checkLayout( layout, heading = 'N', heights = null ) {

	const { path, end, heading: endHeading } = layoutPath( layout, heading );
	const letters = layout.replace( /\s/g, '' );
	const problems = [];
	const visits = new Map();
	const n = path.length;
	const adjacent = ( i, j ) => ( j - i + n ) % n === 1 || ( i - j + n ) % n === 1;

	if ( end[ 0 ] !== 0 || end[ 1 ] !== 0 || endHeading !== heading ) problems.push( `doesn't close (ends at ${ end } heading ${ endHeading })` );
	if ( heights && heights.length !== n ) problems.push( `${ heights.length } heights for ${ n } cells` );

	path.forEach( ( p, i ) => {

		if ( ! visits.has( p + '' ) ) visits.set( p + '', [] );
		visits.get( p + '' ).push( i );

	} );

	for ( const [ key, list ] of visits ) {

		if ( list.length === 1 ) continue;

		const along = ( i ) => [ path[ ( i + 1 ) % n ][ 0 ] - path[ i ][ 0 ], path[ ( i + 1 ) % n ][ 1 ] - path[ i ][ 1 ] ];
		const [ a, b ] = list;
		const da = along( a ), db = along( b );

		if ( list.length > 2 || letters[ a ] !== 'S' || letters[ b ] !== 'S' || da[ 0 ] * db[ 0 ] + da[ 1 ] * db[ 1 ] !== 0 ) problems.push( `cell ${ key } used ${ list.length } times (only a crossing of two straights can share a cell)` );
		else if ( ! heights || Math.abs( heights[ a ] - heights[ b ] ) < BRIDGE_CLEARANCE ) problems.push( `the crossing at ${ key } needs one pass ${ BRIDGE_CLEARANCE } m over the other` );

	}

	path.forEach( ( p, i ) => {

		const mine = visits.get( p + '' );

		for ( const d of Object.values( DIRS ) ) {

			const theirs = visits.get( [ p[ 0 ] + d[ 0 ], p[ 1 ] + d[ 1 ] ] + '' );
			if ( theirs && ! mine.some( ( a ) => theirs.some( ( b ) => adjacent( a, b ) ) ) ) problems.push( `cells ${ p } and ${ [ p[ 0 ] + d[ 0 ], p[ 1 ] + d[ 1 ] ] } touch but aren't connected` );

		}

	} );

	if ( letters[ 0 ] !== 'S' || letters[ n - 1 ] !== 'S' || letters[ n - 2 ] !== 'S' ) problems.push( 'needs the finish and two straights behind it for the grid' );

	return [ ...new Set( problems ) ];

}

export function layoutCells( layout, heading = 'N' ) {

	return loopCells( layoutPath( layout, heading ).path, 0 );

}
