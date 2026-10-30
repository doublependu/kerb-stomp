import * as THREE from 'three';
import { rigidBody, box, sphere, triangleMesh, MotionType, MotionQuality } from 'crashcat';
import { TRACK_CELLS, CELL_RAW, ORIENT_DEG, GRID_SCALE } from './Track.js';
import { GROUND_Y, ROAD_Y, WALL_CENTER } from './TrackShape.js';

const WALL_HALF_THICK = 0.1875;
const ROAD_FRICTION = 5.0;
const GRAVEL_FRICTION = 2.0;
const WALL_HALF_HEIGHT = 1.125;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _along = new THREE.Vector3();
const _upish = new THREE.Vector3();
const _across = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _q = new THREE.Quaternion();

function staticMesh( world, positions, indices, friction ) {

	return rigidBody.create( world, {
		shape: triangleMesh.create( { positions, indices } ),
		motionType: MotionType.STATIC,
		objectLayer: world._OL_STATIC,
		friction,
		restitution: 0,
		enhancedInternalEdgeRemoval: true,
	} );

}

// Up-facing triangle a, b, c (indices into positions)
function upTriangle( positions, indices, a, b, c ) {

	const ux = positions[ b * 3 ] - positions[ a * 3 ], uz = positions[ b * 3 + 2 ] - positions[ a * 3 + 2 ];
	const vx = positions[ c * 3 ] - positions[ a * 3 ], vz = positions[ c * 3 + 2 ] - positions[ a * 3 + 2 ];
	if ( uz * vx - ux * vz > 0 ) indices.push( a, b, c );
	else indices.push( a, c, b );

}

// Tracks with hills (TrackShape): walls as boxes tilted to the slope (none
// on the outside of gravel cells: that's the cliff) and the hillside
// terrain. Returns the bodies a car can drive on. The road itself is no
// collider here: see RoadTile.
export function buildHillColliders( world, shape ) {

	const line = shape.line;
	const ground = [];

	// Walls, a box every ~1.9 m along each side of each cell
	const wallPoint = ( s, side, out ) => {

		const p = line.pointAt( s ), dir = line.directionAt( s );
		return out.set( p[ 0 ] - Math.cos( dir ) * side * WALL_CENTER, ROAD_Y + line.heightAt( s ), p[ 1 ] + Math.sin( dir ) * side * WALL_CENTER );

	};

	for ( let i = 0; i < shape.cells.length; i ++ ) {

		const s0 = shape.cellStart[ i ], s1 = shape.cellStart[ i + 1 ];
		const mid = ( s0 + s1 ) / 2;

		for ( const side of [ - 1, 1 ] ) {

			if ( shape.unsealed.has( i ) && side === shape.outsideAt( mid ) ) continue;

			let length = 0;
			for ( let k = 0; k < 8; k ++ ) length += wallPoint( s0 + ( s1 - s0 ) * k / 8, side, _a ).distanceTo( wallPoint( s0 + ( s1 - s0 ) * ( k + 1 ) / 8, side, _b ) );
			const pieces = Math.max( 1, Math.round( length / 1.9 ) );

			for ( let k = 0; k < pieces; k ++ ) {

				wallPoint( s0 + ( s1 - s0 ) * k / pieces, side, _a );
				wallPoint( s0 + ( s1 - s0 ) * ( k + 1 ) / pieces, side, _b );

				const len = _a.distanceTo( _b );
				if ( len < 1e-3 ) continue;

				_along.subVectors( _b, _a ).divideScalar( len );
				_upish.set( 0, 1, 0 ).addScaledVector( _along, - _along.y ).normalize();
				_across.crossVectors( _upish, _along );
				_q.setFromRotationMatrix( _basis.makeBasis( _across, _upish, _along ) );

				rigidBody.create( world, {
					shape: box.create( { halfExtents: [ WALL_HALF_THICK, WALL_HALF_HEIGHT, len / 2 + 0.05 ] } ),
					motionType: MotionType.STATIC,
					objectLayer: world._OL_STATIC,
					position: [ ( _a.x + _b.x ) / 2 + _upish.x * WALL_HALF_HEIGHT, ( _a.y + _b.y ) / 2 + _upish.y * WALL_HALF_HEIGHT, ( _a.z + _b.z ) / 2 + _upish.z * WALL_HALF_HEIGHT ],
					quaternion: [ _q.x, _q.y, _q.z, _q.w ],
					friction: 0.0,
					restitution: 0.1,
				} );

			}

		}

	}

	// Terrain, where it rises off the flat ground
	{

		const t = shape.terrain;
		const positions = [], indices = [];
		const index = new Map();
		const vertex = ( i, j ) => {

			const key = j * t.nx + i;
			if ( ! index.has( key ) ) {

				index.set( key, positions.length / 3 );
				positions.push( t.x0 + i * t.step, GROUND_Y + t.vertex( i, j ), t.z0 + j * t.step );

			}

			return index.get( key );

		};

		for ( let j = 0; j < t.nz - 1; j ++ ) {

			for ( let i = 0; i < t.nx - 1; i ++ ) {

				if ( Math.max( t.vertex( i, j ), t.vertex( i + 1, j ), t.vertex( i, j + 1 ), t.vertex( i + 1, j + 1 ) ) < 0.02 ) continue;

				const a = vertex( i, j ), b = vertex( i + 1, j ), c = vertex( i, j + 1 ), d = vertex( i + 1, j + 1 );
				upTriangle( positions, indices, a, b, d );
				upTriangle( positions, indices, a, d, c );

			}

		}

		if ( indices.length ) ground.push( staticMesh( world, positions, indices, ROAD_FRICTION ) );

	}

	return ground;

}

// The road under one car on a track with hills: a flat tile laid at the
// road's exact height and slope under the car every step. A triangle mesh
// can't carry the car: its sphere catches the edges of the strips ahead,
// even coplanar ones, and at 20 rad/s of spin that kicks it 2–5 m/s into
// the air (ai/next_4.md). On a tile it rolls on one clean plane, as on the
// flat tracks' ground box. Each car rolls only on its own tile
// (collisionGroups: bit 0 for everything else, then a bit per tile).
const TILE_HALF = [ 2, 0.1, 2 ];
const GROUND_TOP = 0.04; // the ground box's real face above GROUND_Y: it's as thick as its convex radius
const OFF_WORLD = [ 0, - 100, 0 ];
const _p = [ 0, 0, 0 ];
const _q4 = [ 0, 0, 0, 1 ];
const _n = new THREE.Vector3();
const _Y = new THREE.Vector3( 0, 1, 0 );
const _normal = [ 0, 1, 0 ];

export class RoadTile {

	constructor( world, shape, sphere, slot ) {

		this.world = world;
		this.shape = shape;
		const bit = 2 ** ( slot + 1 );

		this.body = rigidBody.create( world, {
			shape: box.create( { halfExtents: TILE_HALF } ),
			motionType: MotionType.STATIC,
			objectLayer: world._OL_STATIC,
			position: OFF_WORLD,
			friction: ROAD_FRICTION,
			restitution: 0,
			collisionGroups: bit,
			collisionMask: bit,
		} );

		sphere.collisionGroups = bit | 1;
		sphere.collisionMask = bit | 1;

	}

	// Under the sphere at (x, z), on the pass of the road its projection
	// follows. Off the road's edge, or fallen below it, there's no tile: the
	// terrain carries the car
	place( x, y, z, proj ) {

		const { shape, body } = this;
		const s = proj.s;
		const height = GROUND_Y + GROUND_TOP + shape.line.heightAt( s );

		if ( Math.abs( proj.lateral ) > shape.roadHalf( s ) + 0.3 || y - 0.5 < height - 0.3 ) {

			if ( body.position[ 1 ] !== OFF_WORLD[ 1 ] ) rigidBody.setPosition( this.world, body, OFF_WORLD, false );
			return;

		}

		shape.roadNormal( s, proj.lateral, _normal );
		_n.fromArray( _normal );
		_q.setFromUnitVectors( _Y, _n );
		_q4[ 0 ] = _q.x; _q4[ 1 ] = _q.y; _q4[ 2 ] = _q.z; _q4[ 3 ] = _q.w;
		_p[ 0 ] = x - _n.x * TILE_HALF[ 1 ];
		_p[ 1 ] = height - _n.y * TILE_HALF[ 1 ];
		_p[ 2 ] = z - _n.z * TILE_HALF[ 1 ];
		body.friction = shape.isUnsealed( s ) ? GRAVEL_FRICTION : ROAD_FRICTION;
		rigidBody.setTransform( this.world, body, _p, _q4, false );

	}

	remove() {

		rigidBody.remove( this.world, this.body );

	}

}

const _debugMat = new THREE.MeshBasicMaterial( { color: 0x00ff00, wireframe: true } );

function addDebugBox( group, halfExtents, position, quaternion ) {

	const geo = new THREE.BoxGeometry( halfExtents[ 0 ] * 2, halfExtents[ 1 ] * 2, halfExtents[ 2 ] * 2 );
	const mesh = new THREE.Mesh( geo, _debugMat );
	mesh.position.set( position[ 0 ], position[ 1 ], position[ 2 ] );
	if ( quaternion ) mesh.quaternion.set( quaternion[ 0 ], quaternion[ 1 ], quaternion[ 2 ], quaternion[ 3 ] );
	group.add( mesh );

}

export function buildWallColliders( world, debugGroup, customCells ) {

	const S = GRID_SCALE;
	const CELL_HALF = CELL_RAW / 2;

	const WALL_HALF_THICK = 0.25;
	const WALL_X = 4.75;
	const WALL_HALF_H = 1.5;

	const wallY = ( 0.5 + WALL_HALF_H ) * S - 0.5;
	const hThick = WALL_HALF_THICK * S;
	const hHeight = WALL_HALF_H * S;
	const hLen = CELL_HALF * S;

	const ARC_SPAN = - Math.PI / 2;
	const ARC_CENTER_X = - CELL_HALF;
	const ARC_CENTER_Z = CELL_HALF;
	const OUTER_R = 2 * CELL_HALF - WALL_HALF_THICK;
	const OUTER_SEG = 8;
	const OUTER_SEG_HALF_LEN = ( OUTER_R * ( Math.PI / 2 ) / OUTER_SEG / 2 ) * S;
	const INNER_R = WALL_HALF_THICK;
	const INNER_SEG = 3;
	const INNER_SEG_HALF_LEN = ( INNER_R * ( Math.PI / 2 ) / INNER_SEG / 2 ) * S;

	function addArcWall( wcx, wcz, arcStart, radius, numSeg, segHalfLen ) {

		for ( let i = 0; i < numSeg; i ++ ) {

			const aMid = arcStart + ( ( i + 0.5 ) / numSeg ) * ARC_SPAN;
			const halfExtents = [ hThick, hHeight, segHalfLen ];
			const position = [
				wcx + radius * Math.cos( aMid ) * S,
				wallY,
				wcz + radius * Math.sin( aMid ) * S
			];
			const quaternion = [ 0, Math.sin( - aMid / 2 ), 0, Math.cos( - aMid / 2 ) ];

			rigidBody.create( world, {
				shape: box.create( { halfExtents } ),
				motionType: MotionType.STATIC,
				objectLayer: world._OL_STATIC,
				position,
				quaternion,
				friction: 0.0,
				restitution: 0.1,
			} );

			if ( debugGroup ) addDebugBox( debugGroup, halfExtents, position, quaternion );

		}

	}

	const cells = customCells || TRACK_CELLS;

	for ( const [ gx, gz, key, orient ] of cells ) {

		if ( key === 'track-bump' ) continue;

		const cx = ( gx + 0.5 ) * CELL_RAW * S;
		const cz = ( gz + 0.5 ) * CELL_RAW * S;

		const deg = ORIENT_DEG[ orient ] ?? 0;
		const rad = deg * Math.PI / 180;
		const cr = Math.cos( rad ), sr = Math.sin( rad );

		if ( key === 'track-straight' || key === 'track-finish' ) {

			for ( const side of [ - 1, 1 ] ) {

				const lx = side * WALL_X;
				const wx = cx + ( lx * cr ) * S;
				const wz = cz + ( - lx * sr ) * S;
				const halfExtents = [ hThick, hHeight, hLen ];
				const position = [ wx, wallY, wz ];
				const quaternion = [ 0, Math.sin( rad / 2 ), 0, Math.cos( rad / 2 ) ];

				rigidBody.create( world, {
					shape: box.create( { halfExtents } ),
					motionType: MotionType.STATIC,
					objectLayer: world._OL_STATIC,
					position,
					quaternion,
					friction: 0.0,
					restitution: 0.1,
				} );

				if ( debugGroup ) addDebugBox( debugGroup, halfExtents, position, quaternion );

			}

		} else if ( key === 'track-corner' ) {

			const wcx = cx + ( ARC_CENTER_X * cr + ARC_CENTER_Z * sr ) * S;
			const wcz = cz + ( - ARC_CENTER_X * sr + ARC_CENTER_Z * cr ) * S;
			const arcStart = - rad;

			addArcWall( wcx, wcz, arcStart, OUTER_R, OUTER_SEG, OUTER_SEG_HALF_LEN );
			addArcWall( wcx, wcz, arcStart, INNER_R, INNER_SEG, INNER_SEG_HALF_LEN );

		}

	}

}

export function createSphereBody( world, spawnPos ) {

	const body = rigidBody.create( world, {
		shape: sphere.create( { radius: 0.5 } ),
		motionType: MotionType.DYNAMIC,
		objectLayer: world._OL_MOVING,
		position: spawnPos || [ 3.5, 0.5, 5 ],
		mass: 1000.0,
		friction: 5.0,
		restitution: 0.1,
		linearDamping: 0.1,
		angularDamping: 4.0,
		gravityFactor: 1.5,
		motionQuality: MotionQuality.LINEAR_CAST,
	} );

	return body;

}
