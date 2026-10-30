// A track's shape beyond its flat grid of cells: which cells are gravel or
// bridge, which side of the loop is outside, the hillside terrain around
// raised road, and the ground under a car (height and slope) for Race.js
// and Vehicle.js. Shared by the game, the Node sim and the editor-free
// tools, so nothing here touches the DOM or three.js scenes.

import { CELL } from './TrackPath.js';

// Physics ground (top of the ground box, Race.js) and the road's visual
// surface, both at height 0 of the profile
export const GROUND_Y = - 0.115;
export const ROAD_Y = - 0.125;

// Lateral offsets from the centerline (m), measured from the Starter Kit
// pieces: the rumble strip, the red-and-white kerb, the wall's inner face,
// centre and outer face, and the cell edge
export const STRIP_IN = 2.63;
export const KERB_IN = 3.0;
export const WALL_FACE = 3.375;
export const WALL_CENTER = 3.5625;
export const WALL_OUTER = 3.75;
export const CELL_HALF = CELL / 2;

const TERRAIN_STEP = CELL / 4;
const TERRAIN_PAD = 2; // cells beyond the track
const GRASS_SLOPE = 0.6;
const CLIFF_SLOPE = 3;

export class TrackShape {

	constructor( track, line ) {

		this.track = track;
		this.cells = track.cells;
		this.line = line;
		this.hilly = Boolean( line.profile );
		this.ordered = Boolean( track.layout ); // cells listed in driving order
		this.maxHeight = this.hilly ? line.profile.max : 0;

		const n = this.cells.length;

		this.unsealed = new Set();
		for ( const [ a, b ] of track.unsealed || [] ) for ( let i = a; i <= b; i ++ ) this.unsealed.add( i );

		// A crossing's higher pass is a bridge, and the cells either side of
		// it along that pass stand on pillars too
		this.crossings = [];
		this.bridges = new Set();

		if ( track.layout ) {

			const visits = new Map();
			this.cells.forEach( ( c, i ) => visits.set( c[ 0 ] + ',' + c[ 1 ], [ ...( visits.get( c[ 0 ] + ',' + c[ 1 ] ) || [] ), i ] ) );

			for ( const list of visits.values() ) {

				if ( list.length !== 2 ) continue;

				const [ a, b ] = list;
				const over = track.heights[ a ] > track.heights[ b ] ? a : b;
				this.crossings.push( { over, under: over === a ? b : a } );
				for ( const d of [ - 1, 0, 1 ] ) this.bridges.add( ( over + d + n ) % n );

			}

		}

		// Where each cell's span starts along the lap (s), for ordered tracks
		this.cellStart = [];

		if ( line.us ) {

			line.us.forEach( ( u, k ) => {

				if ( u === Math.floor( u ) && this.cellStart[ u ] === undefined ) this.cellStart[ u ] = line.cumulative[ k ];

			} );

			this.cellStart.push( line.length );

		}

		// The cells in driving order (as listed, on ordered tracks; else by
		// walking the centerline), for anything that needs each cell's way in
		// and out
		this.walk = this.ordered ? this.cells : this.cellStart.slice( 0, - 1 ).map( ( s ) => {

			const p = line.pointAt( s + 0.5 );
			const gx = Math.floor( p[ 0 ] / CELL ), gz = Math.floor( p[ 1 ] / CELL );
			return this.cells.find( ( c ) => c[ 0 ] === gx && c[ 1 ] === gz );

		} );

		this.terrain = this.hilly ? new Terrain( this ) : null;

	}

	cellAt( s ) {

		return this.line.cellAt( s );

	}

	isUnsealed( s ) {

		return this.unsealed.size > 0 && this.unsealed.has( this.line.cellAt( s ) );

	}

	// +1 if the outside of the loop is to the left of the driving direction
	// at s, −1 if to the right
	outsideAt( s ) {

		const p = this.line.pointAt( s );
		const dir = this.line.directionAt( s );
		return inside( this.line.points, p[ 0 ] - Math.cos( dir ), p[ 1 ] + Math.sin( dir ) ) ? - 1 : 1;

	}

	// Drivable half-width of the road at s (gravel runs to the cell edge)
	roadHalf( s ) {

		return this.isUnsealed( s ) ? CELL_HALF : WALL_FACE;

	}

	// The road's exact normal at s, `lateral` left of the centerline. Height
	// goes by s alone, and round a turn s passes faster on the inside and
	// slower on the outside (dq/ds = t · (1 + lateral · dθ/ds) at a point q
	// offset from the line), so the road there is a helix, steeper than the
	// centerline's slope on the inside. Capped: at the pivot it's a wall.
	roadNormal( s, lateral, out ) {

		const line = this.line;
		const dir = line.directionAt( s );
		const a = line.directionAt( s + 0.25 ) - line.directionAt( s - 0.25 );
		const turn = Math.atan2( Math.sin( a ), Math.cos( a ) ) / 0.5;
		const k = line.slopeAt( s ) / Math.max( 0.25, 1 + lateral * turn );
		setNormal( out, - k * Math.sin( dir ), - k * Math.cos( dir ) );
		return out;

	}

	// The ground under a car at (x, z), on the pass its projection follows:
	// out.height (y of the surface), out.normal [x, y, z], out.road
	surface( x, z, proj, out ) {

		const line = this.line;

		if ( ! this.hilly ) {

			out.height = GROUND_Y;
			out.normal[ 0 ] = 0; out.normal[ 1 ] = 1; out.normal[ 2 ] = 0;
			out.road = Math.abs( proj.lateral ) <= WALL_FACE;
			return out;

		}

		if ( Math.abs( proj.lateral ) <= this.roadHalf( proj.s ) + 0.2 ) {

			const k = line.slopeAt( proj.s );
			const dir = line.directionAt( proj.s );
			setNormal( out.normal, - k * Math.sin( dir ), - k * Math.cos( dir ) );
			out.height = GROUND_Y + line.heightAt( proj.s );
			out.road = true;

		} else {

			const g = this.terrain.gradient( x, z, _gradient );
			setNormal( out.normal, - g[ 0 ], - g[ 1 ] );
			out.height = GROUND_Y + this.terrain.at( x, z );
			out.road = false;

		}

		return out;

	}

}

const _gradient = [ 0, 0 ];

function setNormal( n, x, z ) {

	const l = Math.hypot( x, 1, z );
	n[ 0 ] = x / l; n[ 1 ] = 1 / l; n[ 2 ] = z / l;

}

// Even-odd point in polygon (a figure-8 gives two inside lobes)
export function inside( points, x, z ) {

	let result = false;

	for ( let i = 0, j = points.length - 1; i < points.length; j = i ++ ) {

		const a = points[ i ], b = points[ j ];
		if ( ( a[ 1 ] > z ) !== ( b[ 1 ] > z ) && x < ( b[ 0 ] - a[ 0 ] ) * ( z - a[ 1 ] ) / ( b[ 1 ] - a[ 1 ] ) + a[ 0 ] ) result = ! result;

	}

	return result;

}

// The hillside: a heightfield over the track and a margin round it. Near
// the road it sits just under the road surface; beyond the edge it falls
// away at a grassy slope (a rock cliff beside gravel road), and inside the
// loop it blends between the surrounding road heights into a hill, never
// more than half a metre above the road next to it (it mustn't hide a car
// from the camera). Bridge cells give it no support: they stand on pillars.
export class Terrain {

	constructor( shape ) {

		const { cells, line } = shape;
		const xs = cells.map( ( c ) => c[ 0 ] ), zs = cells.map( ( c ) => c[ 1 ] );

		this.step = TERRAIN_STEP;
		this.x0 = ( Math.min( ...xs ) - TERRAIN_PAD ) * CELL;
		this.z0 = ( Math.min( ...zs ) - TERRAIN_PAD ) * CELL;
		this.nx = ( Math.max( ...xs ) - Math.min( ...xs ) + 1 + 2 * TERRAIN_PAD ) * 4 + 1;
		this.nz = ( Math.max( ...zs ) - Math.min( ...zs ) + 1 + 2 * TERRAIN_PAD ) * 4 + 1;
		this.heights = new Float32Array( this.nx * this.nz );
		this.cliff = new Uint8Array( this.nx * this.nz );

		const sources = [];

		for ( let s = 0; s < line.length; s += 1 ) {

			if ( shape.bridges.has( line.cellAt( s ) ) ) continue;
			const p = line.pointAt( s );
			sources.push( { x: p[ 0 ], z: p[ 1 ], h: line.heightAt( s ), cliff: shape.isUnsealed( s ) } );

		}

		for ( let j = 0; j < this.nz; j ++ ) {

			for ( let i = 0; i < this.nx; i ++ ) {

				// The height of the road nearby: the nearest road's, blended
				// with any other road almost as near (no steps where the
				// nearest road changes)
				const x = this.x0 + i * this.step, z = this.z0 + j * this.step;
				const within = inside( line.points, x, z );
				let nearest = null, best2 = Infinity, sum = 0, weight = 0;

				for ( const src of sources ) {

					src.d2 = ( src.x - x ) ** 2 + ( src.z - z ) ** 2;
					if ( src.d2 < best2 ) { best2 = src.d2; nearest = src; }
					const w = 1 / ( src.d2 + 1 );
					sum += src.h * w;
					weight += w;

				}

				const best = Math.sqrt( best2 );
				const reach = ( best + 9 ) ** 2; // weights beyond are under e⁻⁹
				let near = 0, nearWeight = 0;

				for ( const src of sources ) {

					if ( src.d2 > reach ) continue;
					const w = Math.exp( - ( ( ( Math.sqrt( src.d2 ) - best ) / 3 ) ** 2 ) );
					near += src.h * w;
					nearWeight += w;

				}

				near /= nearWeight;

				const beyond = Math.max( 0, best - CELL_HALF );
				const cliff = nearest.cliff && ! within;
				let h = Math.max( 0, near - 0.25 - beyond * ( cliff ? CLIFF_SLOPE : GRASS_SLOPE ) );

				// Inside the loop it may rise from the road's edge, gently
				if ( within ) h = Math.max( h, Math.min( sum / weight, near - 0.25 + beyond * GRASS_SLOPE ) );

				// Never through the road itself
				if ( best < CELL_HALF ) h = Math.min( h, nearest.h - 0.25 );

				this.heights[ j * this.nx + i ] = Math.max( 0, h );
				this.cliff[ j * this.nx + i ] = cliff && beyond > 0 ? 1 : 0;

			}

		}

	}

	vertex( i, j ) {

		i = Math.max( 0, Math.min( this.nx - 1, i ) );
		j = Math.max( 0, Math.min( this.nz - 1, j ) );
		return this.heights[ j * this.nx + i ];

	}

	at( x, z ) {

		const fx = ( x - this.x0 ) / this.step, fz = ( z - this.z0 ) / this.step;
		if ( fx < 0 || fz < 0 || fx > this.nx - 1 || fz > this.nz - 1 ) return 0;

		const i = Math.floor( fx ), j = Math.floor( fz );
		const tx = fx - i, tz = fz - j;
		const a = this.vertex( i, j ), b = this.vertex( i + 1, j ), c = this.vertex( i, j + 1 ), d = this.vertex( i + 1, j + 1 );
		return ( a * ( 1 - tx ) + b * tx ) * ( 1 - tz ) + ( c * ( 1 - tx ) + d * tx ) * tz;

	}

	gradient( x, z, out ) {

		const e = this.step / 2;
		out[ 0 ] = ( this.at( x + e, z ) - this.at( x - e, z ) ) / ( 2 * e );
		out[ 1 ] = ( this.at( x, z + e ) - this.at( x, z - e ) ) / ( 2 * e );
		return out;

	}

	// Highest point of the terrain in grid cell (gx, gz): flat cells keep the
	// usual decoration tiles
	cellMax( gx, gz ) {

		const i0 = Math.round( ( gx * CELL - this.x0 ) / this.step ), j0 = Math.round( ( gz * CELL - this.z0 ) / this.step );
		let max = 0;
		for ( let j = j0; j <= j0 + 4; j ++ ) for ( let i = i0; i <= i0 + 4; i ++ ) max = Math.max( max, this.vertex( i, j ) );
		return max;

	}

}
