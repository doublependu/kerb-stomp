import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL_RAW, GRID_SCALE, ORIENT_DEG } from './Track.js';
import { passEdges } from './TrackPath.js';
import { ROAD_Y } from './TrackShape.js';

// Track pieces bent to a hilly track's height profile, merged into one mesh;
// the hillside terrain; bridge decks and pillars. Every vertex is lifted by
// the profile at its fraction t of the way through its cell: along the axis
// for straights, around the pivot for corners. The profile is straight
// ramps between cell centres (TrackPath.Profile), which bend a flat face
// exactly, so a piece only needs slicing where the gradient changes: across
// the rounded join at the centre of a cell with a crest or a dip.

const DIRS = { N: [ 0, - 1 ], S: [ 0, 1 ], E: [ 1, 0 ], W: [ - 1, 0 ] };
const HALF = CELL_RAW / 2;
const SLICES = 8; // along a bridge deck
const CUTS = [ 0.28, 0.39, 0.5, 0.61, 0.72 ]; // across a join (TrackPath's FILLET 0.22)
const EPS = 1e-4; // kit units: on a cutting plane, and the thinnest triangle kept

// Colormap swatches (Starter Kit): grass, rock, the walls' grey
const GRASS_UV = [ 0.031, 0.875 ];
const ROCK_UV = [ 0.281, 0.9 ];
const WALL_UV = [ 0.594, 0.875 ];

const DOWN = [ 0, - 1, 0 ];

const _m = new THREE.Matrix4();
const _place = new THREE.Matrix4();
const _v = new THREE.Vector3();

// A model's meshes as one float, non-indexed geometry in the model's own
// space (meshopt models are quantized, with a dequantization matrix on each
// mesh node)
function bake( model, filter ) {

	model.updateMatrixWorld( true );
	const inverse = new THREE.Matrix4().copy( model.matrixWorld ).invert();
	const parts = [];
	let material = null;

	model.traverse( ( child ) => {

		if ( ! child.isMesh || ! filter( child ) ) return;
		material = material || child.material;

		const source = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry;
		const geometry = new THREE.BufferGeometry();

		for ( const name of [ 'position', 'normal', 'uv' ] ) {

			const a = source.getAttribute( name );
			const array = new Float32Array( a.count * a.itemSize );
			for ( let i = 0; i < a.count; i ++ ) for ( let k = 0; k < a.itemSize; k ++ ) array[ i * a.itemSize + k ] = a.getComponent( i, k );
			geometry.setAttribute( name, new THREE.BufferAttribute( array, a.itemSize ) );

		}

		geometry.applyMatrix4( _m.multiplyMatrices( inverse, child.matrixWorld ) );
		parts.push( geometry );

	} );

	return { geometry: parts.length ? mergeGeometries( parts ) : null, material };

}

// Split triangles by the vertical plane nx·x + nz·z = d (positions, uvs). A
// vertex within EPS of the plane counts as on it, so no piece comes out as a
// zero-area sliver: those get zero-length normals, which the lit materials
// turn into NaN pixels (and bloom spreads them over the whole frame)
function split( tris, nx, nz, d ) {

	const out = [];
	const lerp = ( a, b, t ) => a.map( ( v, i ) => v + ( b[ i ] - v ) * t );

	for ( const tri of tris ) {

		const dist = tri.map( ( v ) => v[ 0 ] * nx + v[ 2 ] * nz - d );
		const side = dist.map( ( x ) => x > EPS ? 1 : x < - EPS ? - 1 : 0 );

		if ( ! side.includes( 1 ) || ! side.includes( - 1 ) ) {

			out.push( tri );
			continue;

		}

		// Through a corner: two triangles
		const on = side.indexOf( 0 );

		if ( on >= 0 ) {

			const a = tri[ on ], b = tri[ ( on + 1 ) % 3 ], c = tri[ ( on + 2 ) % 3 ];
			const db = dist[ ( on + 1 ) % 3 ], dc = dist[ ( on + 2 ) % 3 ];
			const p = lerp( b, c, db / ( db - dc ) );
			out.push( [ a, b, p ], [ a, p, c ] );
			continue;

		}

		// The vertex alone on its side, then the other two in winding order
		const lone = side.findIndex( ( s, k ) => s !== side[ ( k + 1 ) % 3 ] && s !== side[ ( k + 2 ) % 3 ] );
		const a = tri[ lone ], b = tri[ ( lone + 1 ) % 3 ], c = tri[ ( lone + 2 ) % 3 ];
		const da = dist[ lone ], db = dist[ ( lone + 1 ) % 3 ], dc = dist[ ( lone + 2 ) % 3 ];
		const p = lerp( a, b, da / ( da - db ) ), q = lerp( a, c, da / ( da - dc ) );

		out.push( [ a, p, q ], [ p, b, c ], [ p, c, q ] );

	}

	return out;

}

// A triangle too thin to draw (under EPS high on its longest side): its
// normal would come out zero or pointing anywhere
function sliver( a, b, c ) {

	const ux = b[ 0 ] - a[ 0 ], uy = b[ 1 ] - a[ 1 ], uz = b[ 2 ] - a[ 2 ];
	const vx = c[ 0 ] - a[ 0 ], vy = c[ 1 ] - a[ 1 ], vz = c[ 2 ] - a[ 2 ];
	const area2 = Math.hypot( uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx );
	const edge = Math.max( Math.hypot( ux, uy, uz ), Math.hypot( vx, vy, vz ), Math.hypot( c[ 0 ] - b[ 0 ], c[ 1 ] - b[ 1 ], c[ 2 ] - b[ 2 ] ) );
	return area2 <= EPS * edge;

}

function toTriangles( geometry ) {

	const pos = geometry.getAttribute( 'position' ), uv = geometry.getAttribute( 'uv' );
	const tris = [];

	for ( let i = 0; i < pos.count; i += 3 ) {

		const tri = [];
		for ( let k = 0; k < 3; k ++ ) tri.push( [ pos.getX( i + k ), pos.getY( i + k ), pos.getZ( i + k ), uv.getX( i + k ), uv.getY( i + k ) ] );
		tris.push( tri );

	}

	return tris;

}

// Pieces in their own space, sliced so they can bend: straights across
// their axis (local z), corners radially around their pivot (local −x, +z)
function slicedPiece( model, corner, filter, cuts ) {

	const { geometry, material } = bake( model, filter );
	if ( ! geometry ) return null;
	let tris = toTriangles( geometry );

	for ( const t of cuts ) {

		if ( corner ) {

			const a = t * Math.PI / 2;
			const nx = Math.sin( a ), nz = Math.cos( a );
			tris = split( tris, nx, nz, nx * - HALF + nz * HALF );

		} else {

			tris = split( tris, 0, 1, - HALF + CELL_RAW * t );

		}

	}

	return { tris: tris.filter( ( t ) => ! sliver( ...t ) ), material };

}

// t (0 at the entry edge, 1 at the exit) of a point in cell i, in the track
// group's units
function cellFraction( x, z, cx, cz, e, f ) {

	if ( e[ 0 ] === - f[ 0 ] && e[ 1 ] === - f[ 1 ] ) {

		const t = ( ( x - ( cx + e[ 0 ] * HALF ) ) * f[ 0 ] + ( z - ( cz + e[ 1 ] * HALF ) ) * f[ 1 ] ) / CELL_RAW;
		return Math.max( 0, Math.min( 1, t ) );

	}

	const px = cx + ( e[ 0 ] + f[ 0 ] ) * HALF, pz = cz + ( e[ 1 ] + f[ 1 ] ) * HALF;
	const vx = x - px, vz = z - pz;
	const a = Math.atan2( - ( vx * e[ 0 ] + vz * e[ 1 ] ), - ( vx * f[ 0 ] + vz * f[ 1 ] ) );
	return Math.max( 0, Math.min( 1, a / ( Math.PI / 2 ) ) );

}

class Builder {

	constructor() {

		this.positions = [];
		this.uvs = [];

	}

	triangle( a, b, c, uv = null ) {

		for ( const v of [ a, b, c ] ) {

			this.positions.push( v[ 0 ], v[ 1 ], v[ 2 ] );
			this.uvs.push( uv ? uv[ 0 ] : v[ 3 ], uv ? uv[ 1 ] : v[ 4 ] );

		}

	}

	// A quad facing `out` (whatever order its corners come in)
	quad( a, b, c, d, uv, out ) {

		const ux = b[ 0 ] - a[ 0 ], uy = b[ 1 ] - a[ 1 ], uz = b[ 2 ] - a[ 2 ];
		const vx = c[ 0 ] - a[ 0 ], vy = c[ 1 ] - a[ 1 ], vz = c[ 2 ] - a[ 2 ];
		const facing = ( uy * vz - uz * vy ) * out[ 0 ] + ( uz * vx - ux * vz ) * out[ 1 ] + ( ux * vy - uy * vx ) * out[ 2 ];

		if ( facing >= 0 ) {

			this.triangle( a, b, c, uv );
			this.triangle( a, c, d, uv );

		} else {

			this.triangle( a, c, b, uv );
			this.triangle( a, d, c, uv );

		}

	}

	geometry() {

		// No slivers (see split), judged on the positions as stored
		const p = new Float32Array( this.positions ), positions = [], uvs = [];

		for ( let i = 0; i < p.length; i += 9 ) {

			if ( sliver( p.subarray( i, i + 3 ), p.subarray( i + 3, i + 6 ), p.subarray( i + 6, i + 9 ) ) ) continue;
			for ( let k = 0; k < 9; k ++ ) positions.push( p[ i + k ] );
			for ( let k = 0; k < 6; k ++ ) uvs.push( this.uvs[ i / 3 * 2 + k ] );

		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
		geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
		geometry.computeVertexNormals(); // non-indexed: flat faces, like the kits
		return geometry;

	}

}

// The bent track in the track group's space (raw kit units, before its
// 0.75 scale): the road as one mesh, plus the bridge and the finish arch as
// their own (they fade when they hide the car, Occluders.js), and the
// hillside in world units
export function bendTrack( models, shape ) {

	const { cells, line } = shape;
	const profile = line.profile;
	const pieces = {};
	const bridgeParts = new Builder(), arch = new Builder();

	// The road in 4×4-cell chunks, so what's off screen is culled
	const chunks = new Map();
	const chunkOf = ( gx, gz ) => {

		const key = Math.floor( gx / 4 ) + ',' + Math.floor( gz / 4 );
		if ( ! chunks.has( key ) ) chunks.set( key, new Builder() );
		return chunks.get( key );

	};
	let material = null;

	const piece = ( key, corner, part, kink ) => {

		const id = key + ':' + part + ( kink ? ':cut' : '' );
		if ( ! ( id in pieces ) ) pieces[ id ] = slicedPiece( models[ key ], corner, ( mesh ) => Boolean( mesh.userData.arch ) === ( part === 'arch' ), kink ? CUTS : [] );
		return pieces[ id ];

	};

	const heights = profile.heights, n = heights.length;

	cells.forEach( ( cell, i ) => {

		const [ gx, gz, type, orient ] = cell;
		const key = shape.unsealed.has( i ) ? type + '-gravel' : type;
		const onBridge = shape.bridges.has( i );
		const cx = ( gx + 0.5 ) * CELL_RAW, cz = ( gz + 0.5 ) * CELL_RAW;
		const [ entry, exit ] = passEdges( cells, i );
		const e = DIRS[ entry ], f = DIRS[ exit ];
		_place.makeRotationY( THREE.MathUtils.degToRad( ORIENT_DEG[ orient ] ?? 0 ) ).setPosition( cx, 0.5, cz );

		// The gradient changes at this cell's centre
		const kink = Math.abs( ( heights[ i ] - heights[ ( i - 1 + n ) % n ] ) - ( heights[ ( i + 1 ) % n ] - heights[ i ] ) ) > 1e-6;

		for ( const part of [ 'road', 'arch' ] ) {

			const sliced = piece( key, type === 'track-corner', part, kink );
			if ( ! sliced ) continue;
			material = material || sliced.material;
			const builder = part === 'arch' ? arch : onBridge ? bridgeParts : chunkOf( gx, gz );

			// Placed in the cell and lifted (inline: this runs for every
			// vertex of every cell)
			const m = _place.elements;
			const { positions, uvs } = builder;

			for ( const tri of sliced.tris ) {

				for ( const v of tri ) {

					const x = m[ 0 ] * v[ 0 ] + m[ 4 ] * v[ 1 ] + m[ 8 ] * v[ 2 ] + m[ 12 ];
					const y = m[ 1 ] * v[ 0 ] + m[ 5 ] * v[ 1 ] + m[ 9 ] * v[ 2 ] + m[ 13 ];
					const z = m[ 2 ] * v[ 0 ] + m[ 6 ] * v[ 1 ] + m[ 10 ] * v[ 2 ] + m[ 14 ];
					positions.push( x, y + profile.at( i + cellFraction( x, z, cx, cz, e, f ) ) / GRID_SCALE, z );
					uvs.push( v[ 3 ], v[ 4 ] );

				}

			}

		}

		if ( onBridge ) bridge( bridgeParts, shape, i, cx, cz, entry, exit );

	} );

	const mesh = ( builder ) => {

		if ( ! builder.positions.length ) return null;
		const m = new THREE.Mesh( builder.geometry(), material );
		m.castShadow = true;
		m.receiveShadow = true;
		return m;

	};

	const track = new THREE.Group();
	for ( const builder of chunks.values() ) track.add( mesh( builder ) );

	return { track, bridge: mesh( bridgeParts ), arch: mesh( arch ), terrain: terrainMesh( shape.terrain, material ) };

}

// Under a bridge cell: a deck slab following the road, and pillars down to
// the ground (none in the crossing cell itself: the road below runs there)
function bridge( builder, shape, i, cx, cz, entry, exit ) {

	const profile = shape.line.profile;
	const crossing = shape.crossings.some( ( c ) => c.over === i );
	const e = DIRS[ entry ], f = DIRS[ exit ];
	const side = [ - f[ 1 ], f[ 0 ] ]; // across the road (this cell is straight)
	const top = ( t ) => 0.5 + profile.at( i + t ) / GRID_SCALE - 0.02;
	const at = ( t, lateral, y ) => [ cx + e[ 0 ] * HALF * ( 1 - 2 * t ) + side[ 0 ] * lateral, y, cz + e[ 1 ] * HALF * ( 1 - 2 * t ) + side[ 1 ] * lateral ];
	const depth = 0.8;

	for ( let k = 0; k < SLICES; k ++ ) {

		const t0 = k / SLICES, t1 = ( k + 1 ) / SLICES;
		const y0 = top( t0 ), y1 = top( t1 );

		builder.quad( at( t0, - HALF, y0 - depth ), at( t0, HALF, y0 - depth ), at( t1, HALF, y1 - depth ), at( t1, - HALF, y1 - depth ), WALL_UV, DOWN );
		builder.quad( at( t0, HALF, y0 ), at( t1, HALF, y1 ), at( t1, HALF, y1 - depth ), at( t0, HALF, y0 - depth ), WALL_UV, [ side[ 0 ], 0, side[ 1 ] ] );
		builder.quad( at( t1, - HALF, y1 ), at( t0, - HALF, y0 ), at( t0, - HALF, y0 - depth ), at( t1, - HALF, y1 - depth ), WALL_UV, [ - side[ 0 ], 0, - side[ 1 ] ] );

	}

	if ( crossing ) return;

	for ( const lateral of [ - 3.2, 3.2 ] ) {

		const yTop = top( 0.5 ) - depth, w = 0.5;
		const c = at( 0.5, lateral, 0 );
		const x = [ c[ 0 ] - w, c[ 0 ] + w ], z = [ c[ 2 ] - w, c[ 2 ] + w ];
		const p = ( a, b, y ) => [ x[ a ], y, z[ b ] ];

		builder.quad( p( 0, 1, 0.5 ), p( 1, 1, 0.5 ), p( 1, 1, yTop ), p( 0, 1, yTop ), WALL_UV, [ 0, 0, 1 ] );
		builder.quad( p( 1, 0, 0.5 ), p( 0, 0, 0.5 ), p( 0, 0, yTop ), p( 1, 0, yTop ), WALL_UV, [ 0, 0, - 1 ] );
		builder.quad( p( 1, 1, 0.5 ), p( 1, 0, 0.5 ), p( 1, 0, yTop ), p( 1, 1, yTop ), WALL_UV, [ 1, 0, 0 ] );
		builder.quad( p( 0, 0, 0.5 ), p( 0, 1, 0.5 ), p( 0, 1, yTop ), p( 0, 0, yTop ), WALL_UV, [ - 1, 0, 0 ] );

	}

}

// The hillside (TrackShape.Terrain) in world units, where it rises off the
// flat ground: grass, rock where it's steep
export function terrainMesh( terrain, material ) {

	const builder = new Builder();
	const v = ( i, j ) => [ terrain.x0 + i * terrain.step, ROAD_Y + terrain.vertex( i, j ) - 0.02, terrain.z0 + j * terrain.step ];

	for ( let j = 0; j < terrain.nz - 1; j ++ ) {

		for ( let i = 0; i < terrain.nx - 1; i ++ ) {

			const h = [ terrain.vertex( i, j ), terrain.vertex( i + 1, j ), terrain.vertex( i, j + 1 ), terrain.vertex( i + 1, j + 1 ) ];
			if ( Math.max( ...h ) < 0.02 ) continue;

			const a = v( i, j ), b = v( i + 1, j ), c = v( i, j + 1 ), d = v( i + 1, j + 1 );

			for ( const tri of [ [ a, c, d ], [ a, d, b ] ] ) {

				const ys = tri.map( ( p ) => p[ 1 ] );
				const steep = ( Math.max( ...ys ) - Math.min( ...ys ) ) / terrain.step > 0.85;
				builder.triangle( tri[ 0 ], tri[ 1 ], tri[ 2 ], steep ? ROCK_UV : GRASS_UV );

			}

		}

	}

	// Flat grass under everything, where no tile or hillside covers the ground
	const x0 = terrain.x0 - 200, x1 = terrain.x0 + terrain.nx * terrain.step + 200;
	const z0 = terrain.z0 - 200, z1 = terrain.z0 + terrain.nz * terrain.step + 200;
	const y = ROAD_Y - 0.04;
	builder.quad( [ x0, y, z0 ], [ x1, y, z0 ], [ x1, y, z1 ], [ x0, y, z1 ], GRASS_UV, [ 0, 1, 0 ] );

	const mesh = new THREE.Mesh( builder.geometry(), material );
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;

}
