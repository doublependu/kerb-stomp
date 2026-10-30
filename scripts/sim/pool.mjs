// Runs sim tasks (optimize-worker.mjs) on every core
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

export class Pool {

	constructor( size = availableParallelism() ) {

		this.workers = [];
		this.idle = [];
		this.queue = [];
		this.pending = new Map();
		this.next = 0;

		for ( let i = 0; i < size; i ++ ) {

			const worker = new Worker( new URL( './optimize-worker.mjs', import.meta.url ) );
			worker.on( 'message', ( { id, result } ) => {

				this.pending.get( id )( result );
				this.pending.delete( id );
				this.idle.push( worker );
				this.drain();

			} );
			this.workers.push( worker );
			this.idle.push( worker );

		}

	}

	run( task ) {

		return new Promise( ( resolve ) => {

			this.queue.push( { task, resolve } );
			this.drain();

		} );

	}

	all( tasks ) {

		return Promise.all( tasks.map( ( task ) => this.run( task ) ) );

	}

	drain() {

		while ( this.idle.length && this.queue.length ) {

			const { task, resolve } = this.queue.shift();
			const id = this.next ++;
			this.pending.set( id, resolve );
			this.idle.pop().postMessage( { id, task } );

		}

	}

	close() {

		for ( const worker of this.workers ) worker.terminate();

	}

}
