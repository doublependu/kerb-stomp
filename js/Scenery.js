import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SCENERY } from './SceneryList.js';
import { CELL, passEdges } from './TrackPath.js';
import { ROAD_Y, WALL_CENTER } from './TrackShape.js';

// Scenery that tells the corners apart: each stretch of the lap gets a
// style of its own (a paddock, a suburb, an industrial estate, a village, a
// forest), every corner a landmark nobody else on the track has, on its
// outside where the approaching driver sees it, plus red-and-white chevron
// boards at the corners and 3-2-1 boards before the big stops.
//
// planScenery decides what goes where (deterministic, cheap, at track
// build: Track.js leaves those cells free and they get a ground pad of
// their zone's colour); buildScenery places the models once they've loaded,
// merged per 4×4-cell chunk and kit, so it's a handful of draws however
// many buildings there are.

const PAD = 3;
const CHUNK = 4;

// Metres per kit unit, and how much bigger landmarks stand
const KIT_SCALE = { industrial: 3.6, suburban: 4.2, fantasy: 2.6, forest: 2.6, roads: 6, racing: 5.5 };
const LANDMARK_SCALE = 1.15;

// The chase camera looks from +x +z (Camera.offset): anything tall in the
// first ring on that side of the road would hide the car, so those cells
// only get low props, and landmarks prefer the far side
const CAMERA_SIDE = [ 1, 1 ];

const SUBURB_HOUSES = [ 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'j', 'l', 'n', 'o', 'q', 's', 't', 'u' ].map( ( l ) => 'suburban/building-type-' + l );
const FACTORIES = [ 'a', 'b', 'c', 'd', 'e', 'g', 'k', 'm', 'p', 'r', 's', 't' ].map( ( l ) => 'industrial/building-' + l );

export const ZONES = {
	paddock: {
		ground: [ 0.156, 0.86 ], // tarmac grey
		buildings: [ 'racing/grandStand', 'racing/grandStandCovered', 'racing/grandStandAwning', 'racing/pitsGarage', 'racing/pitsGarageClosed', 'racing/pitsOffice' ],
		props: [ 'racing/bannerTowerRed', 'racing/bannerTowerGreen', 'racing/lightPostLarge', 'racing/tentLong', 'racing/billboard', 'roads/light-square-double' ],
		low: [ 'roads/construction-barrier', 'roads/construction-cone', 'roads/light-square-double', 'roads/construction-barrier' ],
		landmarks: [ 'racing/overheadLights', 'racing/grandStandCovered', 'racing/bannerTowerGreen' ],
		density: [ 0.8, 0.6 ],
	},
	suburb: {
		ground: [ 0.281, 0.62 ], // lawn
		buildings: SUBURB_HOUSES,
		props: [ 'suburban/tree-large', 'suburban/tree-small', 'suburban/planter', 'suburban/fence-1x4', 'suburban/tree-large' ],
		low: [ 'suburban/fence-1x4', 'suburban/planter', 'suburban/tree-small', 'suburban/fence-2x3' ],
		landmarks: [ 'industrial/water-tower', 'fantasy/house-tower', 'fantasy/house-windmill' ],
		density: [ 0.75, 0.55 ],
	},
	industrial: {
		ground: [ 0.281, 0.875 ], // concrete
		buildings: FACTORIES,
		props: [ 'industrial/shipping-container-a', 'industrial/shipping-container-b', 'industrial/shipping-container-c', 'industrial/detail-tank', 'industrial/solar-panel-landscape-group', 'roads/electricity-pole' ],
		low: [ 'industrial/shipping-container-a', 'industrial/shipping-container-b', 'industrial/shipping-container-c', 'industrial/detail-tank', 'industrial/solar-panel-landscape-group' ],
		landmarks: [ 'industrial/chimney-large', 'industrial/detail-tank-large', 'industrial/water-tower', 'industrial/windmill', 'industrial/chimney-medium' ],
		density: [ 0.7, 0.5 ],
	},
	village: {
		ground: [ 0.031, 0.62 ], // sandy path
		buildings: [ 'fantasy/house-cottage', 'fantasy/house-tall', 'fantasy/house-long', 'fantasy/house-long-tall', 'fantasy/house-tower' ],
		props: [ 'fantasy/stall-green', 'fantasy/stall-red', 'fantasy/cart', 'fantasy/lantern', 'fantasy/hedge-large', 'fantasy/tree', 'fantasy/tree-high', 'fantasy/rock-large' ],
		low: [ 'fantasy/stall-green', 'fantasy/stall-red', 'fantasy/cart', 'fantasy/hedge-large', 'fantasy/lantern' ],
		landmarks: [ 'fantasy/house-windmill', 'fantasy/house-watermill', 'fantasy/house-tower' ],
		density: [ 0.75, 0.5 ],
	},
	forest: {
		ground: [ 0.031, 0.875 ], // grass, like the forest tiles (only landmark cells take it)
		buildings: [],
		props: [ 'forest/tree', 'forest/tree-high', 'forest/rocks-low', 'forest/rocks-high', 'forest/stones', 'forest/tent', 'forest/flag' ],
		low: [ 'forest/rocks-low', 'forest/stones', 'forest/tent' ],
		landmarks: [ 'industrial/windmill', 'fantasy/house-windmill', 'forest/rocks-high', 'industrial/water-tower' ],
		density: [ 0, 0 ],
	},
};

// Every landmark, for when a track has more corners than its zones have
const ALL_LANDMARKS = [ ...new Set( Object.values( ZONES ).flatMap( ( z ) => z.landmarks ) ) ];

// Hillside cells get trees and rocks whatever the zone
const HILL_PROPS = [ 'forest/tree', 'forest/tree-high', 'forest/tree', 'forest/rocks-low', 'fantasy/tree-high', 'forest/stones' ];

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

// Where everything goes. track.scenery: [ [ first cell, zone ], … ] along
// the lap (ordered tracks); Classic and custom tracks only get corner
// landmarks and boards, in the forest they have.
export function planScenery( shape, track ) {

	const { cells } = shape;
	const zonesAlong = track.scenery || [ [ 0, 'forest' ] ];
	const zoneOf = ( i ) => zonesAlong.filter( ( [ first ] ) => first <= i ).pop()?.[ 1 ] || zonesAlong[ zonesAlong.length - 1 ][ 1 ];

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
	const landmarksTaken = new Set();
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
		const zone = ZONES[ zoneOf( i ) ];

		for ( const [ dx, dz ] of candidates ) {

			const gx = cell[ 0 ] + dx, gz = cell[ 1 ] + dz;
			const key = gx + ',' + gz;
			if ( trackKeys.has( key ) || used.has( key ) ) continue;

			const pool = [ ...zone.landmarks, ...ALL_LANDMARKS ].filter( ( id ) => ! landmarksTaken.has( id ) );
			const id = pool.length ? pool[ 0 ] : pick( zone.landmarks.length ? zone.landmarks : ALL_LANDMARKS, hash( gx, gz ) );
			landmarksTaken.add( id );
			used.add( key );

			const [ x, z ] = cellCentre( gx, gz );
			plan.items.push( { id, x, z, y: terrainHeight( x, z ), angle: snap( facing( gx, gz, cell ) ), scale: LANDMARK_SCALE } );
			plan.cells.set( key, { zone: zoneOf( i ), ground: ! raised( gx, gz ) && zone.ground ? zone.ground : null } );
			break;

		}

	} );

	// Buildings and props by zone, ring 1–2 round the track; trees on the
	// hillside
	for ( let gz = minZ; gz <= maxZ; gz ++ ) {

		for ( let gx = minX; gx <= maxX; gx ++ ) {

			const key = gx + ',' + gz;
			if ( trackKeys.has( key ) || used.has( key ) ) continue;

			const { index, ring, cell } = nearest( gx, gz );
			const [ x, z ] = cellCentre( gx, gz );

			if ( raised( gx, gz ) ) {

				used.add( key );
				plan.cells.set( key, { zone: 'hill', ground: null } );

				const count = 2 + Math.floor( hash( gx, gz, 5 ) * 3 );

				for ( let k = 0; k < count; k ++ ) {

					const px = x + ( hash( gx, gz, k * 2 + 11 ) - 0.5 ) * CELL * 0.8;
					const pz = z + ( hash( gx, gz, k * 2 + 12 ) - 0.5 ) * CELL * 0.8;
					if ( nearRoad( shape, px, pz ) ) continue;
					plan.items.push( { id: pick( HILL_PROPS, hash( gx, gz, k + 30 ) ), x: px, z: pz, y: terrainHeight( px, pz ), angle: hash( gx, gz, k + 40 ) * Math.PI * 2, scale: 0.8 + hash( gx, gz, k + 50 ) * 0.5 } );

				}

				continue;

			}

			if ( ! ordered || ring > 2 ) continue;

			const zoneName = zoneOf( index );
			const zone = ZONES[ zoneName ];
			const r = hash( gx, gz, 1 );
			if ( r >= zone.density[ ring - 1 ] ) continue;

			used.add( key );
			plan.cells.set( key, { zone: zoneName, ground: zone.ground } );

			const angle = snap( facing( gx, gz, cell ) );
			const cameraSide = ring === 1 && ( gx - cell[ 0 ] ) * CAMERA_SIDE[ 0 ] + ( gz - cell[ 1 ] ) * CAMERA_SIDE[ 1 ] > 0;

			if ( ! cameraSide && hash( gx, gz, 2 ) < 0.72 && zone.buildings.length ) {

				plan.items.push( { id: pick( zone.buildings, hash( gx, gz, 3 ) ), x, z, y: 0, angle, scale: 1 } );

			} else {

				// A few props round the cell
				const count = 2 + Math.floor( hash( gx, gz, 4 ) * 3 );

				for ( let k = 0; k < count; k ++ ) {

					const px = x + ( hash( gx, gz, k * 2 + 21 ) - 0.5 ) * CELL * 0.7;
					const pz = z + ( hash( gx, gz, k * 2 + 22 ) - 0.5 ) * CELL * 0.7;
					plan.items.push( { id: pick( cameraSide ? zone.low : zone.props, hash( gx, gz, k + 60 ) ), x: px, z: pz, y: 0, angle: angle + ( hash( gx, gz, k + 70 ) < 0.5 ? 0 : Math.PI / 2 ), scale: 1 } );

				}

			}

		}

	}

	boards( shape, plan );
	return plan;

}

function nearRoad( shape, x, z ) {

	const p = shape.line.project( x, z );
	return Math.abs( p.lateral ) < CELL / 2 + 0.8;

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

// Ground pads for the planned cells (zone colours), built with the track so
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
// group of merged meshes, one per chunk and kit.
export function buildScenery( plan, models, { variations = {}, baseMaterial, colormap } ) {

	const group = new THREE.Group();
	const baked = new Map();
	const buckets = new Map();

	for ( const item of plan.items ) {

		const info = SCENERY[ item.id ];
		const model = models[ item.id ];
		if ( ! info || ! model ) continue;

		if ( ! baked.has( item.id ) ) baked.set( item.id, bakeModel( model ) );

		const kitScale = KIT_SCALE[ info.kit ] * item.scale;
		const fit = item.scale > 1.2 ? Infinity : CELL * 0.92 / Math.max( info.w, info.d ); // landmarks may overhang
		const scale = Math.min( kitScale, fit );

		_m.makeRotationY( item.angle ).setPosition( item.x, ROAD_Y + item.y, item.z );
		_s.makeScale( scale, scale, scale );
		_m.multiply( _s );

		const key = Math.floor( item.x / ( CELL * CHUNK ) ) + ',' + Math.floor( item.z / ( CELL * CHUNK ) ) + ',' + info.kit;
		if ( ! buckets.has( key ) ) buckets.set( key, { kit: info.kit, parts: [] } );
		buckets.get( key ).parts.push( baked.get( item.id ).clone().applyMatrix4( _m ) );

	}

	const materials = {};

	for ( const { kit, parts } of buckets.values() ) {

		if ( ! materials[ kit ] ) {

			const variation = variations[ kit ];
			materials[ kit ] = baseMaterial.clone();
			materials[ kit ].map = colormap( variation ? kit + '-' + variation : kit );

		}

		const mesh = new THREE.Mesh( mergeGeometries( parts ), materials[ kit ] );
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		group.add( mesh );

	}

	return group;

}
