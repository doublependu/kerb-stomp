import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SCENERY } from './SceneryList.js';
import { CATALOG, MODEL_IDS, scaleOf } from './SceneryCatalog.js';
import { bytesToBase64url, base64urlToBytes } from './Track.js';
import { CELL, passEdges } from './TrackPath.js';
import { ROAD_Y, WALL_CENTER, WALL_OUTER, inside } from './TrackShape.js';

// Scenery that makes sense of a track. Each track has one theme (a forest,
// a stadium, a village, a suburb, an industrial estate) and every theme lays
// its pieces out in sites, the way they'd stand: a run of grandstands joined
// edge to edge, a row of houses with their fronts to the road, a yard with
// its containers stacked beside the shed. Every turn gets a landmark of the
// theme's on its outside, where the approaching driver sees it, plus
// red-and-white chevron boards at the corners and 3-2-1 boards before the
// big stops. Nothing stands on the road, leans over a wall (CLEARANCE) or
// hides the road from the chase camera (hidesRoad). What each model is and
// how big it stands: SceneryCatalog.js.
//
// planScenery decides what goes where (deterministic, cheap, at track
// build: Track.js leaves those cells free and they get a ground pad of
// the theme's colour); buildScenery places the models once they've loaded,
// merged per 4×4-cell chunk and kit, so it's a handful of draws however
// many buildings there are.

const PAD = 3;
const CHUNK = 4;

// Nothing stands on the road or leans over a wall: every item's footprint
// stays this far (m) outside the walls' outer face, from every pass of the
// track (both roads at a crossing)
export const CLEARANCE = 0.3;

// How much bigger landmarks stand
const LANDMARK_SIZE = 1.15;

// The front line of anything along the road: just past CLEARANCE
const LANE = WALL_OUTER + CLEARANCE + 0.05;

// The chase camera (Camera.offset) always looks along one line: from the
// road, toward +x +z, rising 0.7 m per metre over the ground. Portrait phones
// only move it further back along that line. So whether an item hides the
// road can be answered here: from every metre of road, across its width, at
// the height of a car's roof (hidesRoad).
const CAMERA_SIDE = [ 1, 1 ];
const SIGHT = { x: Math.SQRT1_2, z: Math.SQRT1_2, rise: 9.18 / Math.hypot( 9.27, 9.27 ) };
const ROOF = 0.8;
const SIGHT_REACH = 26; // m over the ground: the camera on the tallest phone
const ACROSS = [ - 2.6, 0, 2.6 ];

const GRASS = [ 0.031, 0.875 ]; // like the ground tiles
const CONCRETE = [ 0.281, 0.875 ];

// One theme per track (Tracks.js theme): the colour of its ground pads, a
// landmark for each turn, what grows on its hillsides, and its sites: how
// its pieces go together along the road (Planner). 'id@a' takes the kit's
// colour variation a.
export const THEMES = {
	forest: {
		ground: GRASS,
		landmarks: [ 'forest/lookout', 'forest/treehouse', 'forest/rope-bridge', 'forest/camp', 'forest/archery', 'forest/rock-pile' ],
		hill: [ 'forest/tree', 'forest/tree-high', 'forest/tree', 'forest/rocks-low', 'forest/stones' ],
		sites: forestSites,
	},
	stadium: {
		ground: CONCRETE,
		landmarks: [ 'racing/grandStandCoveredRound', 'racing/gantry' ],
		hill: [ 'racing/treeLarge', 'racing/treeSmall' ],
		sites: stadiumSites,
		landmarksLast: true, // the grand run takes the turns it can
	},
	village: {
		ground: [ 0.031, 0.62 ], // sandy path
		landmarks: [ 'fantasy/house-windmill', 'fantasy/house-watermill', 'fantasy/house-tower', 'fantasy/market', 'fantasy/fountain-square' ],
		hill: [ 'fantasy/tree', 'fantasy/tree-high', 'fantasy/tree', 'fantasy/rock-large' ],
		sites: villageSites,
	},
	suburb: {
		ground: [ 0.281, 0.62 ], // lawn
		landmarks: [
			'suburban/building-type-d@a', 'suburban/terrace', 'suburban/building-type-b@c', 'suburban/garden', 'suburban/building-type-n',
			'suburban/building-type-f@a', 'suburban/park', 'suburban/building-type-t@c', 'suburban/building-type-u',
		],
		hill: [ 'suburban/tree-large', 'suburban/tree-small', 'suburban/tree-large' ],
		sites: suburbSites,
	},
	industrial: {
		ground: CONCRETE,
		landmarks: [
			'industrial/chimney-large', 'industrial/water-tower', 'industrial/wind-farm', 'industrial/tank-farm', 'industrial/works',
			'industrial/building-l', 'industrial/building-f', 'industrial/building-n',
		],
		// The kit has no trees; the paddock's kit has
		hill: [ 'racing/treeLarge', 'racing/treeSmall', 'racing/treeLarge' ],
		sites: industrialSites,
	},
};

const DIRS = { N: [ 0, - 1 ], S: [ 0, 1 ], E: [ 1, 0 ], W: [ - 1, 0 ] };

// Deterministic 0–1 noise per cell (and per use, c)
function hash( a, b, c = 0 ) {

	let h = Math.imul( a | 0, 374761393 ) ^ Math.imul( b | 0, 668265263 ) ^ Math.imul( c + 1, 1274126177 );
	h = Math.imul( h ^ ( h >>> 15 ), 2246822519 );
	h = Math.imul( h ^ ( h >>> 13 ), 3266489917 );
	return ( ( h ^ ( h >>> 16 ) ) >>> 0 ) / 4294967296;

}

function pick( list, r ) {

	return list[ Math.floor( r * list.length ) % list.length ];

}

// 'id@a' → { id, variation: 'a' }
function model( entry ) {

	const [ id, variation ] = entry.split( '@' );
	return { id, variation: variation || null };

}

// Points on the road the view rule looks from: x, z, height
export function roadSamples( line ) {

	const out = [];

	for ( let s = 0; s < line.length; s += 1 ) {

		const p = line.pointAt( s ), dir = line.directionAt( s ), y = line.heightAt( s );
		for ( const a of ACROSS ) out.push( p[ 0 ] - Math.cos( dir ) * a, p[ 1 ] + Math.sin( dir ) * a, y );

	}

	return out;

}

// Whether the item's box stands between the road and the chase camera
export function hidesRoad( samples, item ) {

	const info = SCENERY[ item.id ];
	const top = item.y + info.h * item.scale;
	const hw = info.w * item.scale / 2, hd = info.d * item.scale / 2;
	const c = Math.cos( item.angle ), n = Math.sin( item.angle );
	const ux = SIGHT.x * c - SIGHT.z * n, uz = SIGHT.x * n + SIGHT.z * c; // the sight line, in the item's frame
	const corner = hw + hd;

	for ( let i = 0; i < samples.length; i += 3 ) {

		const reach = Math.min( SIGHT_REACH, ( top - samples[ i + 2 ] - ROOF ) / SIGHT.rise );
		if ( reach <= 0 ) continue;

		const dx = samples[ i ] - item.x, dz = samples[ i + 1 ] - item.z;
		if ( dx * dx + dz * dz > ( reach + corner ) ** 2 ) continue;

		// Into the box along the sight line, before it has risen over the top
		const lx = dx * c - dz * n, lz = dx * n + dz * c;
		const ax = ( - hw - lx ) / ux, bx = ( hw - lx ) / ux, az = ( - hd - lz ) / uz, bz = ( hd - lz ) / uz;
		const enter = Math.max( 0, Math.min( ax, bx ), Math.min( az, bz ) );
		const leave = Math.min( reach, Math.max( ax, bx ), Math.max( az, bz ) );
		if ( enter <= leave ) return true;

	}

	return false;

}

// Convex footprints overlap (by more than SLOP: row pieces touch)
const SLOP = 0.1;

function overlap( a, b ) {

	for ( const poly of [ a, b ] ) {

		for ( let i = 0; i < 2; i ++ ) {

			const nx = poly[ i + 1 ][ 1 ] - poly[ i ][ 1 ], nz = poly[ i ][ 0 ] - poly[ i + 1 ][ 0 ];
			const length = Math.hypot( nx, nz ) || 1;
			let minA = Infinity, maxA = - Infinity, minB = Infinity, maxB = - Infinity;

			for ( const p of a ) {

				const d = ( p[ 0 ] * nx + p[ 1 ] * nz ) / length;
				minA = Math.min( minA, d );
				maxA = Math.max( maxA, d );

			}

			for ( const p of b ) {

				const d = ( p[ 0 ] * nx + p[ 1 ] * nz ) / length;
				minB = Math.min( minB, d );
				maxB = Math.max( maxB, d );

			}

			if ( maxA < minB + SLOP || maxB < minA + SLOP ) return false;

		}

	}

	return true;

}

// Everything a theme's sites stand things up with
class Planner {

	constructor( shape, theme ) {

		this.shape = shape;
		this.line = shape.line;
		this.theme = theme;
		this.plan = { cells: new Map(), items: [], boards: [] };
		this.samples = roadSamples( shape.line );
		this.boxes = [];
		this.road = new Set( shape.cells.map( ( c ) => c[ 0 ] + ',' + c[ 1 ] ) );

		const walk = shape.walk;
		this.loop = walk.length === shape.cells.length && walk.every( Boolean );
		this.stretches = this.loop ? stretches( shape ) : [];
		this.lineS = CELL / 2; // Race.lineS: the finish, mid-cell
		const over = ( q, s ) => q.s0 <= s && q.s1 >= s;
		this.finish = this.stretches.find( ( q ) => q.kind === 'straight' && ( over( q, this.lineS ) || over( q, this.lineS + this.line.length ) ) ) || null;

	}

	height( x, z ) {

		return this.shape.terrain ? this.shape.terrain.at( x, z ) : 0;

	}

	raised( gx, gz ) {

		return Boolean( this.shape.terrain ) && this.shape.terrain.cellMax( gx, gz ) > 0.05;

	}

	// Stand an item here, if it's clear of the road and of everything placed
	// and hides nothing: shrunk as far as `smallest` if it must, else null
	add( entry, x, z, angle, { size = 1, smallest = 1, ground = this.theme.ground, base = 0 } = {} ) {

		const { id, variation } = model( entry );
		if ( ! SCENERY[ id ] ) return null;

		const item = { id, variation, x, z, y: this.height( x, z ) + base, base, angle, scale: 0 };
		const full = scaleOf( id ) * size;

		for ( let f = 1; f >= smallest - 1e-9; f -= 0.1 ) {

			item.scale = full * f;
			const corners = footprint( item );
			if ( ! fits( this.shape, corners ) ) continue;
			if ( ! base && this.boxes.some( ( b ) => overlap( b, corners ) ) ) continue;
			if ( hidesRoad( this.samples, item ) ) continue;

			this.boxes.push( corners );
			this.plan.items.push( item );
			reserve( this.plan, item, this.road, ground, ( gx, gz ) => this.raised( gx, gz ) );
			return item;

		}

		return null;

	}

	// The side of the road (lateral's sign) away from the camera at s
	farSide( s ) {

		const dir = this.line.directionAt( s );
		return - Math.cos( dir ) * CAMERA_SIDE[ 0 ] + Math.sin( dir ) * CAMERA_SIDE[ 1 ] > 0 ? - 1 : 1;

	}

	// A point `back` m out to `side` of the road at s, and the angle that
	// turns a model's front (+z) to the road
	spot( s, side, back ) {

		const p = this.line.pointAt( s ), dir = this.line.directionAt( s );
		const lx = - Math.cos( dir ) * side, lz = Math.sin( dir ) * side;
		return { x: p[ 0 ] + lx * back, z: p[ 1 ] + lz * back, lx, lz, angle: Math.atan2( - lx, - lz ) };

	}

	// Pieces along the road from s0 to s1, fronts `back` m out to `side`,
	// each `gap` m from the last, measured along their fronts (so round a
	// corner they still meet). pieceAt( k, t ): the k-th piece's entry, t 0–1
	// along the row; null ends the row. Returns what was placed.
	row( { s0, s1, side, back = LANE, gap = 0, pieceAt, most = Infinity, ...options } ) {

		const kept = [];
		let s = s0, last = null;

		while ( s < s1 && kept.length < most ) {

			const entry = pieceAt( kept.length, ( s - s0 ) / ( s1 - s0 ) );
			if ( ! entry ) break;

			const { id } = model( entry );
			const scale = scaleOf( id ) * ( options.size || 1 );
			const w = SCENERY[ id ].w * scale, d = SCENERY[ id ].d * scale;
			const front = this.spot( s, side, back );

			if ( last && Math.hypot( front.x - last.x, front.z - last.z ) < ( last.w + w ) / 2 + gap ) {

				s += 0.25;
				continue;

			}

			const item = this.add( entry, front.x + front.lx * d / 2, front.z + front.lz * d / 2, front.angle, options );

			if ( item ) {

				kept.push( item );
				last = { x: front.x, z: front.z, w };

			}

			s += item ? 0.25 : 0.5;

		}

		return kept;

	}

	// A group laid out round (x, z), turned by angle: [ entry, across, deep, turn ]
	group( x, z, angle, pieces, options ) {

		const c = Math.cos( angle ), n = Math.sin( angle );
		for ( const [ entry, u, v, turn = 0 ] of pieces ) this.add( entry, x + u * c + v * n, z - u * n + v * c, angle + turn, options );

	}

	// Free ground round the track: cell centres `rings` from the road, inside
	// or outside the loop if asked, in a shuffled but fixed order
	spots( { rings = [ 1, 2, 3 ], inside: within = null } = {} ) {

		const { cells } = this.shape;
		const xs = cells.map( ( c ) => c[ 0 ] ), zs = cells.map( ( c ) => c[ 1 ] );
		const out = [];

		for ( let gz = Math.min( ...zs ) - PAD; gz <= Math.max( ...zs ) + PAD; gz ++ ) {

			for ( let gx = Math.min( ...xs ) - PAD; gx <= Math.max( ...xs ) + PAD; gx ++ ) {

				const key = gx + ',' + gz;
				if ( this.road.has( key ) || this.raised( gx, gz ) ) continue;

				const ring = Math.min( ...cells.map( ( c ) => Math.max( Math.abs( c[ 0 ] - gx ), Math.abs( c[ 1 ] - gz ) ) ) );
				if ( ! rings.includes( ring ) ) continue;

				const x = ( gx + 0.5 ) * CELL, z = ( gz + 0.5 ) * CELL;
				const isInside = inside( this.line.points, x, z );
				if ( within !== null && within !== isInside ) continue;
				out.push( { gx, gz, x, z, ring, inside: isInside, order: hash( gx, gz, 90 ) } );

			}

		}

		return out.sort( ( a, b ) => a.order - b.order );

	}

	// Which way the road lies from a point: the angle that turns a front to it
	faceRoad( x, z ) {

		const proj = this.line.project( x, z );
		const p = this.line.pointAt( proj.s );
		return Math.atan2( p[ 0 ] - x, p[ 1 ] - z );

	}

	// `count` trees in a clump round a spot, with `extras` among them (every
	// third): rocks, plants
	clump( spot, trees, extras, count, spread = 3.2 ) {

		const { gx, gz, x, z } = spot;

		for ( let k = 0; k < count; k ++ ) {

			const a = hash( gx, gz, k + 100 ) * Math.PI * 2, r = spread * Math.sqrt( hash( gx, gz, k + 120 ) );
			const list = extras.length && k % 3 === 2 ? extras : trees;
			const id = pick( list, hash( gx, gz, k + 140 ) );
			this.add( id, x + Math.cos( a ) * r, z + Math.sin( a ) * r, hash( gx, gz, k + 160 ) * Math.PI * 2, { smallest: 0.6, size: 0.85 + hash( gx, gz, k + 180 ) * 0.2, ground: GRASS } );

		}

	}

}

// The lap as straights and turns: { kind, s0, s1, cells }. s may run past the
// lap's end on the stretch over the start line.
function stretches( shape ) {

	const list = [];

	shape.walk.forEach( ( cell, i ) => {

		const kind = cell[ 2 ] === 'track-corner' ? 'turn' : 'straight';
		const s0 = shape.cellStart[ i ], s1 = shape.cellStart[ i + 1 ];
		const last = list[ list.length - 1 ];

		if ( last && last.kind === kind ) {

			last.s1 = s1;
			last.cells ++;

		} else {

			list.push( { kind, s0, s1, cells: 1 } );

		}

	} );

	const first = list[ 0 ], last = list[ list.length - 1 ];

	if ( list.length > 1 && first.kind === last.kind ) {

		last.s1 = first.s1 + shape.line.length;
		last.cells += first.cells;
		list.shift();

	}

	return list;

}

// The cells under an item stay clear of the ground tiles, with a pad of
// `ground` (none on the hillside, which has its own ground)
function reserve( plan, item, road, ground, raised ) {

	const corners = footprint( item );
	const xs = corners.map( ( c ) => c[ 0 ] ), zs = corners.map( ( c ) => c[ 1 ] );

	for ( let gz = Math.floor( Math.min( ...zs ) / CELL ); gz <= Math.floor( Math.max( ...zs ) / CELL ); gz ++ ) {

		for ( let gx = Math.floor( Math.min( ...xs ) / CELL ); gx <= Math.floor( Math.max( ...xs ) / CELL ); gx ++ ) {

			const key = gx + ',' + gz;
			if ( road.has( key ) ) continue;
			const pad = raised( gx, gz ) ? null : ground;
			if ( ! plan.cells.has( key ) || ! plan.cells.get( key ).ground ) plan.cells.set( key, { ground: pad } );

		}

	}

}

// ─── The sites ─────────────────────────────────────────────

// The finish straight's pits and a couple of stands on the far side, low
// barriers on the camera's
function paddock( p, { reach = 9, stands = 2 } = {} ) {

	const line = p.lineS, side = p.farSide( line );
	p.row( {
		s0: line - reach, s1: line + reach, side, ground: CONCRETE,
		pieceAt: ( k, t ) => Math.abs( t - 0.5 ) < 0.2 ? 'racing/pitsOffice' : k % 2 ? 'racing/pitsGarageClosed' : 'racing/pitsGarage',
	} );

	p.row( { s0: line + reach, s1: line + reach + 6 * stands, side, ground: CONCRETE, pieceAt: ( k ) => k % 2 ? 'racing/grandStand' : 'racing/grandStandCovered', most: stands } );
	p.row( { s0: line - reach, s1: line + reach, side: - side, ground: GRASS, pieceAt: () => 'racing/barrierWall', most: 3 } );

}

function stadiumSites( p ) {

	const { length } = p.line;
	const main = p.finish;
	const pitSide = p.farSide( p.lineS );

	// The control tower at the line, the pit row either side of it down the
	// whole finish straight, barriers across the road. The tower stands at the
	// road's edge: back in the infield it would hide the far straight.
	const tower = p.spot( p.lineS, pitSide, LANE + SCENERY[ 'racing/control-tower' ].d * scaleOf( 'racing/control-tower' ) / 2 );
	p.add( 'racing/control-tower', tower.x, tower.z, tower.angle, { ground: CONCRETE } );

	p.row( {
		s0: main.s0 + 0.5, s1: main.s1 - 0.5, side: pitSide, ground: CONCRETE,
		pieceAt: ( k ) => k % 5 === 2 ? 'racing/pitsOffice' : k % 2 ? 'racing/pitsGarageClosed' : 'racing/pitsGarage',
	} );

	p.row( { s0: main.s0 + 0.5, s1: main.s1 - 0.5, side: - pitSide, ground: GRASS, pieceAt: () => 'racing/barrierWall' } );
	p.row( { s0: main.s0 + 4, s1: main.s1 - 4, side: - pitSide, back: LANE + 1.2, gap: CELL, ground: GRASS, pieceAt: () => 'racing/billboardLow' } );

	// The grand run: one line of stands down the outside of the longest
	// straight on the camera's far side, on round its turns as far as the
	// view rule lets it. Open at the ends, roofed along, peaked in the middle.
	const far = p.stretches
		.filter( ( q ) => q.kind === 'straight' && q !== main && p.farSide( ( q.s0 + q.s1 ) / 2 ) === p.shape.outsideAt( ( q.s0 + q.s1 ) / 2 ) )
		.sort( ( a, b ) => b.cells - a.cells )[ 0 ];

	let run = [];

	if ( far ) {

		const i = p.stretches.indexOf( far ), n = p.stretches.length;
		const before = p.stretches[ ( i - 2 + n ) % n ], after = p.stretches[ ( i + 1 ) % n ];
		const s0 = before.s0 - ( before.s0 > far.s0 ? length : 0 ), s1 = after.s1 + ( after.s1 < far.s1 ? length : 0 );

		// Laid out with the tallest, so what's kept hides nothing
		run = p.row( { s0, s1, side: p.shape.outsideAt( ( far.s0 + far.s1 ) / 2 ), back: LANE + 0.1, ground: CONCRETE, pieceAt: () => 'racing/grandStandAwning' } );

	}

	run.forEach( ( item, k ) => {

		const t = ( k + 0.5 ) / run.length;
		item.id = t < 0.1 || t > 0.9 ? 'racing/grandStand' : t > 0.35 && t < 0.65 ? 'racing/grandStandAwning' : 'racing/grandStandCovered';
		item.scale = scaleOf( item.id );

	} );

	// Banner towers at the run's ends
	for ( const [ item, next ] of [ [ run[ 0 ], run[ 1 ] ], [ run[ run.length - 1 ], run[ run.length - 2 ] ] ] ) {

		if ( ! item || ! next ) continue;

		const d = Math.hypot( item.x - next.x, item.z - next.z );
		const x = item.x + ( item.x - next.x ) / d * 3.8, z = item.z + ( item.z - next.z ) / d * 3.8;
		const c = Math.cos( item.angle ) * 1.5, n = Math.sin( item.angle ) * 1.5;
		p.add( 'racing/bannerTowerRed', x + n, z + c, item.angle );
		p.add( 'racing/bannerTowerGreen', x - n, z - c, item.angle );

	}

	// Light posts along the back of the pits, boards on the far chutes
	p.row( { s0: main.s0 + 4, s1: main.s1 - 4, side: pitSide, back: LANE + 6.6, gap: CELL * 1.5, ground: GRASS, pieceAt: () => 'racing/lightPostLarge' } );

	for ( const q of p.stretches ) {

		if ( q === main || q === far || q.kind !== 'straight' ) continue;
		const mid = ( q.s0 + q.s1 ) / 2;
		p.row( { s0: q.s0, s1: q.s1, side: p.shape.outsideAt( mid ), pieceAt: () => p.farSide( mid ) === p.shape.outsideAt( mid ) ? 'racing/billboard' : 'racing/barrierWall', gap: 0.2, ground: GRASS } );

	}

	// The fan zone in the infield, under the flags, and trees round it
	const infield = p.spots( { inside: true } ).sort( ( a, b ) => a.x - b.x || a.z - b.z );

	if ( infield.length ) {

		const mid = infield[ Math.floor( infield.length * 0.25 ) ];
		p.group( mid.x, mid.z, 0, [
			[ 'racing/tentLong', 0, 2.8 ], [ 'racing/tentLong', 0, - 2.8 ],
			[ 'racing/flagCheckers', 5.4, 0 ], [ 'racing/flagCheckers', - 5.4, 0 ],
		], { ground: GRASS } );

	}

	infield.forEach( ( spot, k ) => {

		if ( k % 2 ) p.clump( spot, [ 'racing/treeLarge', 'racing/treeSmall' ], [], 2 );

	} );

}

// Each straight of `least` cells or more bar the finish's, and its far side
function frontages( p, visit, { least = 2 } = {} ) {

	for ( const q of p.stretches ) {

		if ( q.kind === 'straight' && q.cells >= least && q !== p.finish ) visit( q, p.farSide( ( q.s0 + q.s1 ) / 2 ) );

	}

}

const COTTAGES = [ 'fantasy/house-cottage', 'fantasy/house-long', 'fantasy/house-tall', 'fantasy/house-cottage', 'fantasy/house-long-tall' ];

function villageSites( p ) {

	paddock( p );

	// Terraces facing the road, a hedge along the camera's side with lanterns
	frontages( p, ( q, side ) => {

		p.row( { s0: q.s0 + 0.5, s1: q.s1 - 0.5, side, gap: 0.3, pieceAt: ( k ) => COTTAGES[ ( k + q.cells ) % COTTAGES.length ] } );
		p.row( { s0: q.s0 + 0.5, s1: q.s1 - 0.5, side: - side, gap: 1.8, most: 4, ground: GRASS, pieceAt: ( k ) => k % 2 ? 'fantasy/lantern' : 'fantasy/hedge-large' } );

	} );

	// The market round a square, an orchard in rows, trees to fill
	const open = p.spots( { rings: [ 2, 3 ] } );

	for ( const spot of open.slice( 0, 1 ) ) {

		p.group( spot.x, spot.z, p.faceRoad( spot.x, spot.z ), [
			[ 'fantasy/stall-green', - 2.2, - 2 ], [ 'fantasy/stall-red', 0, - 2 ], [ 'fantasy/stall-green', 2.2, - 2 ],
			[ 'fantasy/cart', - 2.6, 1.4, 0.4 ], [ 'fantasy/stall-red', 2.6, 1.6, - Math.PI / 2 ], [ 'fantasy/lantern', 0, 2.8 ],
		] );

	}

	for ( const spot of open.slice( 1, 2 ) ) {

		const angle = p.faceRoad( spot.x, spot.z );
		const trees = [];
		for ( let u = - 1; u <= 1; u ++ ) for ( let v = - 1; v <= 1; v ++ ) trees.push( [ 'fantasy/tree', u * 2.4, v * 2.4 ] );
		p.group( spot.x, spot.z, angle, trees, { ground: GRASS, size: 0.8 } );

	}

	for ( const spot of open.slice( 2, 6 ) ) p.clump( spot, [ 'fantasy/tree', 'fantasy/tree-high' ], [ 'fantasy/rock-large' ], 3 );

}

const HOUSES = [ 'a', 'c', 'e', 'g', 'h', 'j', 'l', 'o', 'q', 's' ].map( ( l ) => 'suburban/building-type-' + l );

function suburbSites( p ) {

	paddock( p );

	// Houses in a row with their fronts to the road, planters at the fronts,
	// a fence along the backs of the plots and trees in the gardens; a fence
	// along the road on the camera's side
	const house = ( s, k ) => HOUSES[ Math.floor( hash( Math.round( s ), k, 3 ) * HOUSES.length ) ];

	const street = ( q, side ) => {

		const homes = p.row( { s0: q.s0 + 0.4, s1: q.s1 - 0.4, side, back: LANE + 1.1, gap: 0.8, pieceAt: ( k ) => house( q.s0, k ) } );

		homes.forEach( ( item, k ) => {

			const c = Math.cos( item.angle ), n = Math.sin( item.angle );
			const d = SCENERY[ item.id ].d * item.scale;
			if ( k % 2 === 0 ) p.add( 'suburban/planter', item.x + ( d / 2 + 0.55 ) * n, item.z + ( d / 2 + 0.55 ) * c, item.angle );
			p.add( 'suburban/fence-1x4', item.x - ( d / 2 + 1 ) * n, item.z - ( d / 2 + 1 ) * c, item.angle );
			if ( k % 2 ) p.add( hash( Math.round( item.x ), Math.round( item.z ), 4 ) < 0.6 ? 'suburban/tree-large' : 'suburban/tree-small', item.x - ( d / 2 + 2.4 ) * n + c, item.z - ( d / 2 + 2.4 ) * c - n, 0 );

		} );

	};

	for ( const q of p.stretches ) if ( q.kind === 'straight' && q !== p.finish ) street( q, p.farSide( ( q.s0 + q.s1 ) / 2 ) );

	frontages( p, ( q, side ) => {

		p.row( { s0: q.s0 + 0.5, s1: q.s1 - 0.5, side: - side, gap: 0.1, ground: GRASS, pieceAt: () => 'suburban/fence-1x4' } );

	}, { least: 1 } );

	for ( const spot of p.spots( { rings: [ 1, 2 ] } ).slice( 0, 6 ) ) p.clump( spot, [ 'suburban/tree-large', 'suburban/tree-small' ], [ 'suburban/planter' ], 3 );

}

const SHEDS = [ 'a', 'b', 'c', 'd', 'g', 'k', 'm', 'p', 'r', 's', 't' ].map( ( l ) => 'industrial/building-' + l );
const BOXES = [ 'a', 'b', 'c' ].map( ( l ) => 'industrial/shipping-container-' + l );

function industrialSites( p ) {

	paddock( p );

	// A yard: a building on the road, containers in stacks beside it, a tank
	const yard = ( s, side, k ) => {

		const [ item ] = p.row( { s0: s, s1: s + 8, side, pieceAt: () => SHEDS[ k % SHEDS.length ], most: 1 } );
		if ( ! item ) return;

		const c = Math.cos( item.angle ), n = Math.sin( item.angle );
		const u = SCENERY[ item.id ].w * item.scale / 2 + 1.6;
		const stack = ( v, k, count ) => {

			const x = item.x + u * c + v * n, z = item.z - u * n + v * c;

			for ( let h = 0; h < count; h ++ ) {

				if ( ! p.add( BOXES[ ( k + h ) % 3 ], x, z, item.angle, { base: h * 1.3 } ) ) return;

			}

		};

		stack( 0, k, 2 );
		stack( 1.9, k + 1, 1 );
		stack( - 1.9, k + 2, 2 );
		p.add( 'industrial/detail-tank', item.x - ( u + 0.2 ) * c + n, item.z + ( u + 0.2 ) * n + c, item.angle );

	};

	let yards = 0;

	frontages( p, ( q, side ) => {

		for ( let s = q.s0 + 0.5; s < q.s1 - 5; s += 13 ) yard( s, side, yards ++ );

		// Containers end to end on the camera's side
		p.row( { s0: q.s0 + 0.5, s1: q.s1 - 0.5, side: - side, gap: 1.2, pieceAt: ( k ) => BOXES[ k % 3 ] } );

	} );

	// A solar farm in a grid, trees to fill
	const open = p.spots( { rings: [ 2, 3 ] } );

	for ( const spot of open.slice( 0, 2 ) ) {

		const rows = [];
		for ( let u = - 1; u <= 1; u ++ ) for ( let v = - 1; v <= 1; v ++ ) rows.push( [ 'industrial/solar-panel-landscape-group', u * 2.2 * 2.5, v * 2.2 ] );
		p.group( spot.x, spot.z, 0, rows );

	}

}

function forestSites( p ) {

	paddock( p );

	// A fence along the straights on the camera's side, clumps of trees with
	// rocks and plants under them
	frontages( p, ( q, side ) => {

		p.row( { s0: q.s0 + 0.5, s1: q.s1 - 0.5, side: - side, gap: 0.2, most: 6, ground: GRASS, pieceAt: () => 'forest/fence' } );

	} );

	for ( const spot of p.spots( { rings: [ 1, 2 ] } ).slice( 0, 7 ) ) p.clump( spot, [ 'forest/tree', 'forest/tree-high' ], [ 'forest/rocks-low', 'forest/stones', 'forest/plant' ], 3 + Math.floor( hash( spot.gx, spot.gz, 7 ) * 5 ) );

}

// Where everything goes, in track.theme (THEMES): an edited layout if the
// track has one (track.scenery), else the theme's sites. Classic and custom
// tracks without a theme only get corner landmarks and boards, from the
// forest.
export function planScenery( shape, track ) {

	const theme = THEMES[ track.theme ] || THEMES.forest;
	const p = new Planner( shape, theme );
	const { plan } = p;

	if ( track.scenery ) {

		layout( p, track.scenery );

	} else {

		if ( ! theme.landmarksLast ) landmarks( p );

		// The sites along the road, then the hillside
		if ( shape.ordered || ( track.custom && track.theme ) ) {

			if ( p.loop ) theme.sites( p );
			hillside( p );

		}

		if ( theme.landmarksLast ) landmarks( p );

	}

	boards( shape, plan );
	return plan;

}

// An edited layout as it was left, minus anything that's on the road by now
function layout( p, encoded ) {

	const items = decodeLayout( encoded );

	for ( const item of items ) {

		item.y = p.height( item.x, item.z ) + item.base;

		if ( ! fits( p.shape, footprint( item ) ) ) {

			console.warn( `Scenery: ${ item.id } dropped, it's on the road` );
			continue;

		}

		const role = CATALOG[ item.id ].role;
		p.plan.items.push( item );
		reserve( p.plan, item, p.road, role === 'tree' || role === 'rock' || role === 'fence' ? GRASS : p.theme.ground, ( gx, gz ) => p.raised( gx, gz ) );

	}

}

// ─── Layouts in links ──────────────────────────────────────

// An edited layout is the full list, not a difference from the planner, so a
// later change to the sites can't shuffle what was placed. A version byte,
// then 8 bytes an item: model number (SceneryCatalog.MODEL_IDS), x and z to
// 10 cm, angle to 1.5° (15° and 90° exact), size to 5% and colour variation,
// height off the ground (a stacked container) to 10 cm.
const LAYOUT_VERSION = 1;
const ITEM_BYTES = 8;
const ANGLE_STEPS = 240;
const VARIATIONS = [ null, 'a', 'b', 'c' ];

export function encodeLayout( items ) {

	const bytes = new Uint8Array( 1 + items.length * ITEM_BYTES );
	const view = new DataView( bytes.buffer );
	bytes[ 0 ] = LAYOUT_VERSION;

	items.forEach( ( item, i ) => {

		const o = 1 + i * ITEM_BYTES;
		const turn = item.angle / ( Math.PI * 2 ) * ANGLE_STEPS;
		bytes[ o ] = MODEL_IDS.indexOf( item.id );
		view.setInt16( o + 1, Math.round( item.x * 10 ), true );
		view.setInt16( o + 3, Math.round( item.z * 10 ), true );
		bytes[ o + 5 ] = ( ( Math.round( turn ) % ANGLE_STEPS ) + ANGLE_STEPS ) % ANGLE_STEPS;
		bytes[ o + 6 ] = Math.max( 1, Math.min( 63, Math.round( item.scale / scaleOf( item.id ) / 0.05 ) ) ) | VARIATIONS.indexOf( item.variation || null ) << 6;
		bytes[ o + 7 ] = Math.round( ( item.base || 0 ) * 10 );

	} );

	return bytesToBase64url( bytes );

}

// The items of a layout (no y: it goes by the ground under them); an empty
// list if it's not one
export function decodeLayout( encoded ) {

	const items = [];

	try {

		const bytes = base64urlToBytes( encoded );
		if ( bytes[ 0 ] !== LAYOUT_VERSION ) return items;

		const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );

		for ( let o = 1; o + ITEM_BYTES <= bytes.length; o += ITEM_BYTES ) {

			const id = MODEL_IDS[ bytes[ o ] ];
			if ( ! id ) continue;

			items.push( {
				id,
				variation: VARIATIONS[ bytes[ o + 6 ] >> 6 ],
				x: view.getInt16( o + 1, true ) / 10,
				z: view.getInt16( o + 3, true ) / 10,
				y: 0,
				base: bytes[ o + 7 ] / 10,
				angle: bytes[ o + 5 ] / ANGLE_STEPS * Math.PI * 2,
				scale: scaleOf( id ) * ( bytes[ o + 6 ] & 63 ) * 0.05,
			} );

		}

	} catch {

		console.warn( 'Scenery: not a layout' );

	}

	return items;

}

// One landmark per turn, on the outside, straight ahead of the car coming in
// (then the diagonal, then the far side): the theme's in turn
function landmarks( p ) {

	if ( ! p.loop ) return;

	const walk = p.shape.walk;
	const { theme, plan } = p;
	let used = 0;

	walk.forEach( ( cell, i ) => {

		if ( cell[ 2 ] !== 'track-corner' ) return;

		// One landmark per turn: skip the second corner of an S or chicane
		const prev = walk[ ( i - 1 + walk.length ) % walk.length ];
		if ( prev[ 2 ] === 'track-corner' ) return;

		const [ entry, exit ] = passEdges( walk, i );
		const e = DIRS[ entry ], f = DIRS[ exit ];
		const free = [ [ - e[ 0 ], - e[ 1 ] ], [ - e[ 0 ] - f[ 0 ], - e[ 1 ] - f[ 1 ] ], [ - f[ 0 ], - f[ 1 ] ] ]
			.filter( ( [ dx, dz ] ) => dx * CAMERA_SIDE[ 0 ] + dz * CAMERA_SIDE[ 1 ] <= 0 )
			.map( ( [ dx, dz ] ) => [ cell[ 0 ] + dx, cell[ 1 ] + dz ] )
			.filter( ( [ gx, gz ] ) => ! p.road.has( gx + ',' + gz ) && ! plan.cells.has( gx + ',' + gz ) );

		if ( ! free.length ) return;

		const entryId = theme.landmarks[ used % theme.landmarks.length ];
		const { id } = model( entryId );
		const size = Math.min( LANDMARK_SIZE, CELL * 0.92 / ( Math.max( SCENERY[ id ].w, SCENERY[ id ].d ) * scaleOf( id ) ) );

		// The first free cell it fits at 80% or more; failing that, the first
		// free one, shrunk as far as it must
		for ( const smallest of [ 0.8, 0.4 ] ) {

			for ( const [ gx, gz ] of smallest === 0.8 ? free : free.slice( 0, 1 ) ) {

				const x = ( gx + 0.5 ) * CELL, z = ( gz + 0.5 ) * CELL;

				if ( p.add( entryId, x, z, p.faceRoad( x, z ), { size, smallest } ) ) {

					used ++;
					return;

				}

			}

		}

	} );

}

// Trees and rocks on the rising ground, 1–3 to a cell. Down to 60% where one
// would hide the road, else it's left out
function hillside( p ) {

	const { shape, theme } = p;
	const { terrain, cells } = shape;
	if ( ! terrain ) return;

	const xs = cells.map( ( c ) => c[ 0 ] ), zs = cells.map( ( c ) => c[ 1 ] );

	for ( let gz = Math.min( ...zs ) - PAD; gz <= Math.max( ...zs ) + PAD; gz ++ ) {

		for ( let gx = Math.min( ...xs ) - PAD; gx <= Math.max( ...xs ) + PAD; gx ++ ) {

			const key = gx + ',' + gz;
			if ( p.road.has( key ) || ! p.raised( gx, gz ) ) continue;
			if ( ! p.plan.cells.has( key ) ) p.plan.cells.set( key, { ground: null } );

			const count = 1 + Math.floor( hash( gx, gz, 5 ) * 3 );
			const cx = ( gx + 0.5 ) * CELL, cz = ( gz + 0.5 ) * CELL;

			for ( let k = 0; k < count; k ++ ) {

				const x = cx + ( hash( gx, gz, k * 2 + 11 ) - 0.5 ) * CELL * 0.8;
				const z = cz + ( hash( gx, gz, k * 2 + 12 ) - 0.5 ) * CELL * 0.8;
				const id = pick( theme.hill, hash( gx, gz, k + 30 ) );
				p.add( id, x, z, hash( gx, gz, k + 40 ) * Math.PI * 2, { size: 0.85 + hash( gx, gz, k + 50 ) * 0.2, smallest: 0.6, ground: null } );

			}

		}

	}

}

function fits( shape, corners ) {

	return roadGap( shape.line, corners, CLEARANCE + 0.01 ) >= CLEARANCE;

}

// An item's footprint: the corners of its rotated box, [ x, z ] × 4
export function footprint( item ) {

	const info = SCENERY[ item.id ];
	const hw = info.w * item.scale / 2, hd = info.d * item.scale / 2;
	const c = Math.cos( item.angle ), s = Math.sin( item.angle );
	return [ [ - hw, - hd ], [ hw, - hd ], [ hw, hd ], [ - hw, hd ] ].map( ( [ x, z ] ) => [ item.x + x * c + z * s, item.z - x * s + z * c ] );

}

// How far a footprint stays outside the walls' outer face (m; negative:
// over the wall or on the road), from every pass of the centerline; at
// most `limit` (passes further than that aren't measured)
export function roadGap( line, corners, limit = Infinity ) {

	const cx = ( corners[ 0 ][ 0 ] + corners[ 2 ][ 0 ] ) / 2, cz = ( corners[ 0 ][ 1 ] + corners[ 2 ][ 1 ] ) / 2;
	const radius = Math.hypot( corners[ 0 ][ 0 ] - cx, corners[ 0 ][ 1 ] - cz );
	const points = line.points;
	let best = limit + WALL_OUTER;

	for ( let k = 0; k < line.segments; k ++ ) {

		const a = points[ k ], b = points[ ( k + 1 ) % points.length ];
		if ( pointSegment( cx, cz, a, b ) - radius >= best ) continue;
		best = Math.min( best, polygonSegment( corners, a, b ) );

	}

	return best - WALL_OUTER;

}

function pointSegment( x, z, a, b ) {

	const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ];
	const t = Math.max( 0, Math.min( 1, ( ( x - a[ 0 ] ) * dx + ( z - a[ 1 ] ) * dz ) / ( dx * dx + dz * dz || 1 ) ) );
	return Math.hypot( x - a[ 0 ] - dx * t, z - a[ 1 ] - dz * t );

}

function cross( a, b, c ) {

	return ( b[ 0 ] - a[ 0 ] ) * ( c[ 1 ] - a[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( c[ 0 ] - a[ 0 ] );

}

// Distance between a convex polygon and a segment (0 if they touch)
function polygonSegment( corners, a, b ) {

	const n = corners.length;
	let inside = true, best = Infinity;

	for ( let i = 0; i < n; i ++ ) {

		const p = corners[ i ], q = corners[ ( i + 1 ) % n ];
		if ( cross( p, q, a ) < 0 ) inside = false;

		const d1 = cross( p, q, a ), d2 = cross( p, q, b ), d3 = cross( a, b, p ), d4 = cross( a, b, q );
		if ( d1 * d2 < 0 && d3 * d4 < 0 ) return 0;

		best = Math.min( best, pointSegment( a[ 0 ], a[ 1 ], p, q ), pointSegment( b[ 0 ], b[ 1 ], p, q ), pointSegment( p[ 0 ], p[ 1 ], a, b ) );

	}

	return inside ? 0 : best;

}

// Chevrons at each turn, on the outside straight ahead; 3-2-1 boards
// before turns at the end of a straight of three cells or more
function boards( shape, plan ) {

	const { line } = shape;
	const cells = shape.walk;
	if ( cells.length !== shape.cells.length || ! cells.every( Boolean ) ) return;

	cells.forEach( ( cell, i ) => {

		if ( cell[ 2 ] !== 'track-corner' ) return;
		const prev = cells[ ( i - 1 + cells.length ) % cells.length ];
		if ( prev[ 2 ] === 'track-corner' ) return;

		const [ entry, exit ] = passEdges( cells, i );
		const e = DIRS[ entry ], f = DIRS[ exit ];
		const cx = ( cell[ 0 ] + 0.5 ) * CELL, cz = ( cell[ 1 ] + 0.5 ) * CELL;
		const s = shape.cellStart[ i ];
		const y = line.heightAt( s + 1 );

		// Facing the car coming in (it travels along −e), arrows toward f
		plan.boards.push( { kind: 'chevron', x: cx - e[ 0 ] * ( WALL_CENTER + 0.55 ), z: cz - e[ 1 ] * ( WALL_CENTER + 0.55 ), y, face: [ e[ 0 ], e[ 1 ] ], arrow: [ f[ 0 ], f[ 1 ] ] } );

		// Straights before it
		let straight = 0;
		for ( let k = 1; k < cells.length && cells[ ( i - k + cells.length ) % cells.length ][ 2 ] !== 'track-corner'; k ++ ) straight ++;
		if ( straight < 3 ) return;

		for ( const [ n, back ] of [ [ 3, 12 ], [ 2, 8 ], [ 1, 4 ] ] ) {

			const at = s - back;
			const p = line.pointAt( at );
			const dir = line.directionAt( at );
			const lx = - Math.cos( dir ), lz = Math.sin( dir );

			// On the outside of the turn: the side away from f
			const sign = lx * f[ 0 ] + lz * f[ 1 ] > 0 ? - 1 : 1;
			const offset = WALL_CENTER + 0.55;
			plan.boards.push( { kind: 'count', n, x: p[ 0 ] + lx * sign * offset, z: p[ 1 ] + lz * sign * offset, y: line.heightAt( at ), face: [ - Math.sin( dir ), - Math.cos( dir ) ] } );

		}

	} );

}

// ─── Building it ───────────────────────────────────────────

const RED_UV = [ 0.656, 0.6 ];
const WHITE_UV = [ 0.656, 0.86 ];
const POST_UV = [ 0.594, 0.875 ];
const DARK_UV = [ 0.156, 0.86 ];

// Ground pads for the planned cells (the theme's colour), built with the track so
// nothing shows through before the models arrive
export function sceneryPads( plan, material ) {

	const positions = [], uvs = [];
	const y = ROAD_Y + 0.005;

	for ( const [ key, cell ] of plan.cells ) {

		if ( ! cell.ground ) continue;
		const [ gx, gz ] = key.split( ',' ).map( Number );
		const x0 = gx * CELL, x1 = ( gx + 1 ) * CELL, z0 = gz * CELL, z1 = ( gz + 1 ) * CELL;
		positions.push( x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0 );
		for ( let k = 0; k < 6; k ++ ) uvs.push( ...cell.ground );

	}

	if ( ! positions.length ) return null;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	geometry.computeVertexNormals();
	const mesh = new THREE.Mesh( geometry, material );
	mesh.receiveShadow = true;
	return mesh;

}

// The boards, generated in the Starter Kit's colours
export function boardMesh( plan, material ) {

	const parts = [];
	const box = ( w, h, d, uv ) => {

		const g = new THREE.BoxGeometry( w, h, d ).toNonIndexed();
		const a = new Float32Array( g.getAttribute( 'position' ).count * 2 );
		for ( let i = 0; i < a.length; i += 2 ) a.set( uv, i );
		g.setAttribute( 'uv', new THREE.BufferAttribute( a, 2 ) );
		return g;

	};

	for ( const b of plan.boards ) {

		const group = [];
		const y0 = ROAD_Y + b.y;

		if ( b.kind === 'chevron' ) {

			group.push( box( 2.2, 0.9, 0.08, RED_UV ).translate( 0, 1.45, 0 ) );
			group.push( box( 0.1, 1.2, 0.1, POST_UV ).translate( - 0.8, 0.6, - 0.05 ), box( 0.1, 1.2, 0.1, POST_UV ).translate( 0.8, 0.6, - 0.05 ) );

			// Two white chevrons, pointing along +x (turned below)
			for ( const cx of [ - 0.45, 0.35 ] ) {

				group.push( box( 0.5, 0.14, 0.02, WHITE_UV ).rotateZ( - 0.7 ).translate( cx, 1.62, 0.05 ) );
				group.push( box( 0.5, 0.14, 0.02, WHITE_UV ).rotateZ( 0.7 ).translate( cx, 1.28, 0.05 ) );

			}

		} else {

			group.push( box( 0.7, 0.9, 0.06, WHITE_UV ).translate( 0, 1.2, 0 ) );
			group.push( box( 0.08, 0.8, 0.08, POST_UV ).translate( 0, 0.4, - 0.04 ) );
			for ( let k = 0; k < b.n; k ++ ) group.push( box( 0.5, 0.1, 0.02, DARK_UV ).translate( 0, 0.9 + ( k + 0.5 ) * 0.6 / b.n, 0.04 ) );

		}

		const geometry = mergeGeometries( group );

		// Board space: +z faces the driver, +x is where the arrows point
		const facing = Math.atan2( b.face[ 0 ], b.face[ 1 ] );
		const m = new THREE.Matrix4().makeRotationY( facing );

		if ( b.arrow ) {

			const right = new THREE.Vector3( 1, 0, 0 ).applyMatrix4( m );
			if ( right.x * b.arrow[ 0 ] + right.z * b.arrow[ 1 ] < 0 ) m.multiply( new THREE.Matrix4().makeScale( - 1, 1, 1 ) );

		}

		m.setPosition( b.x, y0, b.z );
		geometry.applyMatrix4( m );
		parts.push( geometry );

	}

	if ( ! parts.length ) return null;

	// A mirror turns some faces inside out: draw both sides
	const mesh = new THREE.Mesh( mergeGeometries( parts ), material.clone() );
	mesh.material.side = THREE.DoubleSide;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;

}

// Models the plan needs
export function sceneryModels( plan ) {

	return [ ...new Set( plan.items.map( ( item ) => item.id ) ) ].filter( ( id ) => SCENERY[ id ] );

}

// The colormap an item takes: its own variation, else the track's for its
// kit (variations: { kit: 'b' }), else the kit's
export function colormapOf( item, variations ) {

	const kit = SCENERY[ item.id ].kit;
	const variation = item.variation || variations[ kit ];
	return variation ? kit + '-' + variation : kit;

}

// Colormaps the plan needs (Loader.getColormap names)
export function sceneryColormaps( plan, variations = {} ) {

	return [ ...new Set( plan.items.filter( ( item ) => SCENERY[ item.id ] ).map( ( item ) => colormapOf( item, variations ) ) ) ];

}

const _m = new THREE.Matrix4();
const _s = new THREE.Matrix4();
const _uv = new THREE.Vector3();

// A loaded model as float arrays in its own space, with its colormap's
// UV transform baked in (meshopt models are quantized)
function bakeModel( model ) {

	model.updateMatrixWorld( true );
	const inverse = new THREE.Matrix4().copy( model.matrixWorld ).invert();
	const parts = [];

	model.traverse( ( child ) => {

		if ( ! child.isMesh ) return;

		const source = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry;
		const pos = source.getAttribute( 'position' ), normal = source.getAttribute( 'normal' ), uv = source.getAttribute( 'uv' );
		const map = child.material.map;
		if ( map ) map.updateMatrix();

		const positions = new Float32Array( pos.count * 3 ), normals = new Float32Array( pos.count * 3 ), uvs = new Float32Array( pos.count * 2 );

		for ( let i = 0; i < pos.count; i ++ ) {

			positions.set( [ pos.getX( i ), pos.getY( i ), pos.getZ( i ) ], i * 3 );
			if ( normal ) normals.set( [ normal.getX( i ), normal.getY( i ), normal.getZ( i ) ], i * 3 );
			_uv.set( uv ? uv.getX( i ) : 0, uv ? uv.getY( i ) : 0, 1 );
			if ( map ) _uv.applyMatrix3( map.matrix );
			uvs.set( [ _uv.x, _uv.y ], i * 2 );

		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
		geometry.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );
		geometry.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
		geometry.applyMatrix4( _m.multiplyMatrices( inverse, child.matrixWorld ) );
		parts.push( geometry );

	} );

	return mergeGeometries( parts );

}

// models: id → loaded scene. variations: { kit: 'b' } colormap per kit;
// colormap( name ): the shared texture (Loader.getColormap). Returns a
// group of merged meshes, one per chunk and colormap.
export function buildScenery( plan, models, { variations = {}, baseMaterial, colormap } ) {

	const group = new THREE.Group();
	const baked = new Map();
	const buckets = new Map();

	for ( const item of plan.items ) {

		const info = SCENERY[ item.id ];
		const model = models[ item.id ];
		if ( ! info || ! model ) continue;

		if ( ! baked.has( item.id ) ) baked.set( item.id, bakeModel( model ) );

		const scale = item.scale;

		_m.makeRotationY( item.angle ).setPosition( item.x, ROAD_Y + item.y, item.z );
		_s.makeScale( scale, scale, scale );
		_m.multiply( _s );

		const map = colormapOf( item, variations );
		const key = Math.floor( item.x / ( CELL * CHUNK ) ) + ',' + Math.floor( item.z / ( CELL * CHUNK ) ) + ',' + map;
		if ( ! buckets.has( key ) ) buckets.set( key, { map, parts: [] } );
		buckets.get( key ).parts.push( baked.get( item.id ).clone().applyMatrix4( _m ) );

	}

	const materials = {};

	for ( const { map, parts } of buckets.values() ) {

		if ( ! materials[ map ] ) {

			materials[ map ] = baseMaterial.clone();
			materials[ map ].map = colormap( map );

		}

		const mesh = new THREE.Mesh( mergeGeometries( parts ), materials[ map ] );
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		group.add( mesh );

	}

	return group;

}
