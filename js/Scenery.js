import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SCENERY } from './SceneryList.js';
import { CELL, passEdges } from './TrackPath.js';
import { ROAD_Y, WALL_CENTER, WALL_OUTER } from './TrackShape.js';

// Scenery that tells the corners apart. Each track has one theme (a forest,
// a stadium, a village, a suburb, an industrial estate) and a small
// paddock at the start/finish; every turn gets a landmark of the theme's
// that nobody else on the track has, on its outside where the approaching
// driver sees it, plus red-and-white chevron boards at the corners and
// 3-2-1 boards before the big stops. Nothing stands on the road or leans
// over a wall (CLEARANCE).
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
const SHRINK = 0.8; // the smallest a prop that doesn't fit gets before it's dropped

// Metres per kit unit, and how much bigger landmarks stand
const KIT_SCALE = { industrial: 3.6, suburban: 4.2, fantasy: 2.6, forest: 2.6, racing: 5.5 };
const LANDMARK_SCALE = 1.15;

// The chase camera looks from +x +z (Camera.offset): anything tall in the
// first ring on that side of the road would hide the car, so those cells
// only get low props, and landmarks prefer the far side
const CAMERA_SIDE = [ 1, 1 ];

// One theme per track (Tracks.js theme): its buildings, its props (low
// ones for the camera's side of the road), a landmark for each turn, the
// colour of its ground pads, what grows on its hillsides, and the share of
// the cells one and two rings out from the road that get something.
// 'id@a' takes the kit's colour variation a.
export const THEMES = {
	forest: {
		ground: [ 0.031, 0.875 ], // grass, like the ground tiles
		buildings: [],
		props: [ 'forest/tree', 'forest/tree-high', 'forest/tree', 'forest/rocks-low', 'forest/stones', 'forest/plant' ],
		low: [ 'forest/rocks-low', 'forest/stones', 'forest/fence', 'forest/plant' ],
		landmarks: [ 'forest/lookout', 'forest/treehouse', 'forest/rope-bridge', 'forest/camp', 'forest/archery', 'forest/rock-pile' ],
		hill: [ 'forest/tree', 'forest/tree-high', 'forest/tree', 'forest/rocks-low', 'forest/stones' ],
		density: [ 0.25, 0.15 ],
	},
	stadium: {
		ground: [ 0.156, 0.86 ], // tarmac grey
		buildings: [ 'racing/grandStand', 'racing/grandStandCovered', 'racing/grandStandAwning', 'racing/grandStandCovered' ],
		props: [ 'racing/lightPostLarge', 'racing/billboard', 'racing/bannerTowerRed', 'racing/bannerTowerGreen', 'racing/tentLong', 'racing/flagCheckers' ],
		low: [ 'racing/barrierWall', 'racing/billboardLow', 'racing/barrierWall' ],
		landmarks: [ 'racing/grandStandCoveredRound', 'racing/control-tower', 'racing/gantry' ],
		hill: [ 'racing/treeLarge', 'racing/treeSmall' ],
		density: [ 0.45, 0.3 ],
	},
	village: {
		ground: [ 0.031, 0.62 ], // sandy path
		buildings: [ 'fantasy/house-cottage', 'fantasy/house-tall', 'fantasy/house-long', 'fantasy/house-long-tall' ],
		props: [ 'fantasy/stall-green', 'fantasy/stall-red', 'fantasy/cart', 'fantasy/lantern', 'fantasy/hedge-large', 'fantasy/tree', 'fantasy/tree-high', 'fantasy/rock-large' ],
		low: [ 'fantasy/cart', 'fantasy/hedge-large', 'fantasy/lantern', 'fantasy/hedge-large' ],
		landmarks: [ 'fantasy/house-windmill', 'fantasy/house-watermill', 'fantasy/house-tower', 'fantasy/market', 'fantasy/fountain-square' ],
		hill: [ 'fantasy/tree', 'fantasy/tree-high', 'fantasy/tree', 'fantasy/rock-large' ],
		density: [ 0.25, 0.15 ],
	},
	suburb: {
		ground: [ 0.281, 0.62 ], // lawn
		buildings: [ 'a', 'c', 'e', 'g', 'h', 'j', 'l', 'o', 'q', 's' ].map( ( l ) => 'suburban/building-type-' + l ),
		props: [ 'suburban/tree-large', 'suburban/tree-small', 'suburban/planter', 'suburban/fence-1x4', 'suburban/tree-large' ],
		low: [ 'suburban/fence-1x4', 'suburban/planter', 'suburban/tree-small', 'suburban/fence-2x3' ],
		landmarks: [
			'suburban/building-type-d@a', 'suburban/terrace', 'suburban/building-type-b@c', 'suburban/garden', 'suburban/building-type-n',
			'suburban/building-type-f@a', 'suburban/park', 'suburban/building-type-t@c', 'suburban/building-type-u',
		],
		hill: [ 'suburban/tree-large', 'suburban/tree-small', 'suburban/tree-large' ],
		density: [ 0.6, 0.4 ],
	},
	industrial: {
		ground: [ 0.281, 0.875 ], // concrete
		buildings: [ 'a', 'b', 'c', 'd', 'g', 'k', 'm', 'p', 'r', 's', 't' ].map( ( l ) => 'industrial/building-' + l ),
		props: [ 'industrial/shipping-container-a', 'industrial/shipping-container-b', 'industrial/shipping-container-c', 'industrial/detail-tank', 'industrial/solar-panel-landscape-group' ],
		low: [ 'industrial/shipping-container-a', 'industrial/shipping-container-b', 'industrial/shipping-container-c', 'industrial/detail-tank', 'industrial/solar-panel-landscape-group' ],
		landmarks: [
			'industrial/chimney-large', 'industrial/water-tower', 'industrial/wind-farm', 'industrial/tank-farm', 'industrial/works',
			'industrial/building-l', 'industrial/building-f', 'industrial/building-n',
		],
		// The kit has no trees; the paddock's kit has
		hill: [ 'racing/treeLarge', 'racing/treeSmall', 'racing/treeLarge' ],
		density: [ 0.45, 0.3 ],
	},
};

// Whatever the theme, the start/finish gets a small paddock: grandstands
// and pits (low barriers on the camera's side), at most PADDOCK.most items
const PADDOCK = {
	ground: [ 0.156, 0.86 ],
	buildings: [ 'racing/grandStandCovered', 'racing/pitsGarage', 'racing/grandStand', 'racing/pitsGarageClosed', 'racing/pitsOffice' ],
	low: [ 'racing/barrierWall', 'racing/flagCheckers' ],
	most: 6,
};

// How many props a prop cell (or a hillside one) gets
const PROPS = [ 1, 3 ];

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

// Where everything goes, in track.theme (THEMES). Classic and custom tracks
// only get corner landmarks and boards, from the forest.
export function planScenery( shape, track ) {

	const { cells } = shape;
	const theme = THEMES[ track.theme ] || THEMES.forest;

	const trackKeys = new Map();
	cells.forEach( ( c, i ) => trackKeys.set( c[ 0 ] + ',' + c[ 1 ], i ) );

	const xs = cells.map( ( c ) => c[ 0 ] ), zs = cells.map( ( c ) => c[ 1 ] );
	const minX = Math.min( ...xs ) - PAD, maxX = Math.max( ...xs ) + PAD;
	const minZ = Math.min( ...zs ) - PAD, maxZ = Math.max( ...zs ) + PAD;

	const plan = { cells: new Map(), items: [], boards: [] };
	const terrainHeight = ( x, z ) => shape.terrain ? shape.terrain.at( x, z ) : 0;
	const raised = ( gx, gz ) => shape.terrain && shape.terrain.cellMax( gx, gz ) > 0.05;

	// Nearest track cell (Chebyshev ring) for every cell around the track
	const nearest = ( gx, gz ) => {

		let best = null, bestD = Infinity;

		cells.forEach( ( c, i ) => {

			const d = Math.max( Math.abs( c[ 0 ] - gx ), Math.abs( c[ 1 ] - gz ) );
			const tie = Math.hypot( c[ 0 ] - gx, c[ 1 ] - gz );
			if ( d < bestD || ( d === bestD && tie < best.tie ) ) { bestD = d; best = { i, tie, c }; }

		} );

		return { index: best.i, ring: bestD, cell: best.c };

	};

	// Facing the road: the front (+z) toward the nearest track cell
	const facing = ( gx, gz, c ) => Math.atan2( c[ 0 ] - gx, c[ 1 ] - gz );
	const snap = ( a ) => Math.round( a / ( Math.PI / 2 ) ) * ( Math.PI / 2 );

	const used = new Set();
	const cellCentre = ( gx, gz ) => [ ( gx + 0.5 ) * CELL, ( gz + 0.5 ) * CELL ];

	// Corner landmarks first: on the outside, straight ahead of the car
	// coming in (then the diagonal, then the far side)
	let landmarks = 0;
	const ordered = shape.ordered;
	// Turns need each cell's way in and out: the cells in driving order, on
	// a closed loop
	const walk = shape.walk;
	const loop = walk.length === cells.length && walk.every( Boolean );

	if ( loop ) walk.forEach( ( cell, i ) => {

		if ( cell[ 2 ] !== 'track-corner' ) return;

		// One landmark per turn: skip the second corner of an S or chicane
		const prev = walk[ ( i - 1 + walk.length ) % walk.length ];
		if ( prev[ 2 ] === 'track-corner' ) return;

		const [ entry, exit ] = passEdges( walk, i );
		const e = DIRS[ entry ], f = DIRS[ exit ];
		const candidates = [ [ - e[ 0 ], - e[ 1 ] ], [ - e[ 0 ] - f[ 0 ], - e[ 1 ] - f[ 1 ] ], [ - f[ 0 ], - f[ 1 ] ] ]
			.filter( ( [ dx, dz ] ) => dx * CAMERA_SIDE[ 0 ] + dz * CAMERA_SIDE[ 1 ] <= 0 );
		// The first free cell it fits in at 80% or more; failing that, the
		// first free one, shrunk until it fits
		const free = candidates.map( ( [ dx, dz ] ) => [ cell[ 0 ] + dx, cell[ 1 ] + dz ] ).filter( ( [ gx, gz ] ) => ! trackKeys.has( gx + ',' + gz ) && ! used.has( gx + ',' + gz ) );
		if ( ! free.length ) return;

		// The theme's landmarks in turn (more turns than landmarks: again)
		const { id, variation } = model( theme.landmarks[ landmarks ++ % theme.landmarks.length ] );

		let item = null, gx, gz;

		for ( const [ fx, fz ] of free ) {

			const [ x, z ] = cellCentre( fx, fz );
			item = place( shape, { id, variation, x, z, y: terrainHeight( x, z ), angle: snap( facing( fx, fz, cell ) ), scale: placedScale( id, LANDMARK_SCALE ) }, x, z );
			[ gx, gz ] = [ fx, fz ];
			if ( item ) break;

		}

		if ( ! item ) {

			[ gx, gz ] = free[ 0 ];
			const [ x, z ] = cellCentre( gx, gz );
			item = place( shape, { id, variation, x, z, y: terrainHeight( x, z ), angle: snap( facing( gx, gz, cell ) ), scale: placedScale( id, LANDMARK_SCALE ) }, x, z, 0.4 );

		}

		if ( ! item ) return;

		const key = gx + ',' + gz;
		used.add( key );
		plan.items.push( item );
		plan.cells.set( key, { ground: ! raised( gx, gz ) ? theme.ground : null } );

	} );

	// The paddock, then the theme's buildings and props, ring 1–2 round the
	// track; trees on the hillside
	const finish = new Set( ordered ? [ cells.length - 1, 0, 1 ] : [] );
	let paddock = 0;

	for ( let gz = minZ; gz <= maxZ; gz ++ ) {

		for ( let gx = minX; gx <= maxX; gx ++ ) {

			const key = gx + ',' + gz;
			if ( trackKeys.has( key ) || used.has( key ) ) continue;

			const { index, ring, cell } = nearest( gx, gz );
			const [ x, z ] = cellCentre( gx, gz );

			if ( raised( gx, gz ) ) {

				used.add( key );
				plan.cells.set( key, { ground: null } );

				const count = PROPS[ 0 ] + Math.floor( hash( gx, gz, 5 ) * ( PROPS[ 1 ] - PROPS[ 0 ] + 1 ) );

				for ( let k = 0; k < count; k ++ ) {

					const px = x + ( hash( gx, gz, k * 2 + 11 ) - 0.5 ) * CELL * 0.8;
					const pz = z + ( hash( gx, gz, k * 2 + 12 ) - 0.5 ) * CELL * 0.8;
					const id = pick( theme.hill, hash( gx, gz, k + 30 ) );
					const item = place( shape, { id, x: px, z: pz, y: 0, angle: hash( gx, gz, k + 40 ) * Math.PI * 2, scale: placedScale( id, 0.8 + hash( gx, gz, k + 50 ) * 0.5 ) }, x, z );
					if ( ! item ) continue;
					item.y = terrainHeight( item.x, item.z );
					plan.items.push( item );

				}

				continue;

			}

			if ( ! ordered || ring > 2 ) continue;

			const angle = snap( facing( gx, gz, cell ) );
			const cameraSide = ring === 1 && ( gx - cell[ 0 ] ) * CAMERA_SIDE[ 0 ] + ( gz - cell[ 1 ] ) * CAMERA_SIDE[ 1 ] > 0;

			if ( ring === 1 && finish.has( index ) && paddock < PADDOCK.most ) {

				const id = pick( cameraSide ? PADDOCK.low : PADDOCK.buildings, hash( gx, gz, 6 ) );
				const item = place( shape, { id, x, z, y: 0, angle, scale: placedScale( id, 1 ) }, x, z );
				if ( ! item ) continue;

				used.add( key );
				plan.cells.set( key, { ground: PADDOCK.ground } );
				plan.items.push( item );
				paddock ++;
				continue;

			}

			if ( hash( gx, gz, 1 ) >= theme.density[ ring - 1 ] ) continue;

			used.add( key );
			plan.cells.set( key, { ground: theme.ground } );

			if ( ! cameraSide && hash( gx, gz, 2 ) < 0.72 && theme.buildings.length ) {

				const id = pick( theme.buildings, hash( gx, gz, 3 ) );
				const item = place( shape, { id, x, z, y: 0, angle, scale: placedScale( id, 1 ) }, x, z );
				if ( item ) plan.items.push( item );

			} else {

				// A few props round the cell
				const count = PROPS[ 0 ] + Math.floor( hash( gx, gz, 4 ) * ( PROPS[ 1 ] - PROPS[ 0 ] + 1 ) );

				for ( let k = 0; k < count; k ++ ) {

					const px = x + ( hash( gx, gz, k * 2 + 21 ) - 0.5 ) * CELL * 0.7;
					const pz = z + ( hash( gx, gz, k * 2 + 22 ) - 0.5 ) * CELL * 0.7;
					const id = pick( cameraSide ? theme.low : theme.props, hash( gx, gz, k + 60 ) );
					const item = place( shape, { id, x: px, z: pz, y: 0, angle: angle + ( hash( gx, gz, k + 70 ) < 0.5 ? 0 : Math.PI / 2 ), scale: placedScale( id, 1 ) }, x, z );
					if ( item ) plan.items.push( item );

				}

			}

		}

	}

	boards( shape, plan );
	return plan;

}

// Metres per kit unit for a model at `size` (1 = its kit's usual scale),
// fitted inside a cell
function placedScale( id, size ) {

	const info = SCENERY[ id ];
	return Math.min( KIT_SCALE[ info.kit ] * size, CELL * 0.92 / Math.max( info.w, info.d ) );

}

// The item where it fits (CLEARANCE outside the walls): as placed, else
// moved toward its cell's centre (cx, cz), else shrunk there down to
// `smallest` of its size; null if it doesn't fit even then
function place( shape, item, cx, cz, smallest = SHRINK ) {

	const x0 = item.x, z0 = item.z, scale = item.scale;

	for ( const t of [ 0, 0.35, 0.7, 1 ] ) {

		item.x = x0 + ( cx - x0 ) * t;
		item.z = z0 + ( cz - z0 ) * t;
		if ( fits( shape, item ) ) return item;

	}

	for ( let f = 0.9; f >= smallest - 1e-9; f -= 0.1 ) {

		item.scale = scale * f;
		if ( fits( shape, item ) ) return item;

	}

	return null;

}

function fits( shape, item ) {

	return roadGap( shape.line, footprint( item ), CLEARANCE + 0.01 ) >= CLEARANCE;

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
function colormapOf( item, variations ) {

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
