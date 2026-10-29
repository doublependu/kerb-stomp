import * as THREE from 'three';
import { CELL_RAW, GRID_SCALE, TYPE_NAMES, computeSpawnPosition } from './Track.js';

// Lap logic for one car (no DOM, so scripts/sim can run it). A lap counts
// when the car crosses the finish line forwards having visited every other
// track cell since the last crossing, which rules out reversing over the line
// or cutting across.

const FINISH = TYPE_NAMES[ 3 ];
const STORAGE_PREFIX = 'racing.bestLap.';
const _tmp = new THREE.Vector3();

export function loadBest( trackId ) {

	try {

		const v = localStorage.getItem( STORAGE_PREFIX + ( trackId || 'default' ) );
		const n = v !== null ? Number( v ) : NaN;
		return Number.isFinite( n ) ? n : null;

	} catch {

		return null;

	}

}

export function saveBest( trackId, value ) {

	try {

		localStorage.setItem( STORAGE_PREFIX + ( trackId || 'default' ), String( value ) );

	} catch {}

}

export function formatTime( t ) {

	if ( t === null || t === undefined ) return '0:00.00';

	const m = Math.floor( t / 60 );
	const s = t - m * 60;
	return `${ m }:${ s.toFixed( 2 ).padStart( 5, '0' ) }`;

}

export class LapCounter {

	constructor( cells ) {

		this.lineCenter = new THREE.Vector3();
		this.lineForward = new THREE.Vector3( 0, 0, 1 );
		this.lineRight = new THREE.Vector3( 1, 0, 0 );

		this.cellSize = CELL_RAW * GRID_SCALE;
		this.requiredCells = new Set();
		this.visitedCells = new Set();

		this.enabled = cells.some( ( c ) => c[ 2 ] === FINISH );

		if ( this.enabled ) {

			const spawn = computeSpawnPosition( cells );
			this.lineCenter.set( spawn.position[ 0 ], 0, spawn.position[ 2 ] );
			this.lineForward.set( Math.sin( spawn.angle ), 0, Math.cos( spawn.angle ) );
			this.lineRight.set( this.lineForward.z, 0, - this.lineForward.x );

			for ( const c of cells ) {

				if ( c[ 2 ] !== FINISH ) this.requiredCells.add( c[ 0 ] + ',' + c[ 1 ] );

			}

		}

		this.reset();

	}

	reset() {

		this.lap = 1;
		this.lastLap = null;
		this.bestLap = null;
		this.currentLapTime = 0;
		this.running = false;
		this.prevForwardProj = null;
		this.visitedCells.clear();

	}

	// Returns true when this step completed a lap
	update( dt, position ) {

		if ( ! this.enabled || ! this.running ) return false;

		this.currentLapTime += dt;

		const gx = Math.floor( position.x / this.cellSize );
		const gz = Math.floor( position.z / this.cellSize );
		const key = gx + ',' + gz;
		if ( this.requiredCells.has( key ) ) this.visitedCells.add( key );

		_tmp.copy( position ).sub( this.lineCenter );
		const forwardProj = _tmp.dot( this.lineForward );
		const lateralProj = Math.abs( _tmp.dot( this.lineRight ) );
		let completed = false;

		if ( this.prevForwardProj !== null ) {

			const onLine = lateralProj <= this.cellSize * 0.5;
			const noTeleport = Math.abs( forwardProj - this.prevForwardProj ) < 5;
			const crossedForward = this.prevForwardProj < 0 && forwardProj >= 0;

			if ( onLine && noTeleport && crossedForward ) {

				if ( this.visitedCells.size === this.requiredCells.size ) {

					this.lastLap = this.currentLapTime;
					if ( this.bestLap === null || this.lastLap < this.bestLap ) this.bestLap = this.lastLap;
					this.lap ++;
					this.currentLapTime = 0;
					completed = true;

				}

				this.visitedCells.clear();

			}

		}

		this.prevForwardProj = forwardProj;
		return completed;

	}

}
