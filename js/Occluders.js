import * as THREE from 'three';

// Things tall enough to hide the player's car from the high chase camera
// (a bridge deck, the finish arch) fade to see-through while they're in the
// way: a ray from the camera to the car, against their triangles.

const FADED = 0.25;
const RATE = 10; // opacity per second

const _raycaster = new THREE.Raycaster();
const _target = new THREE.Vector3();
const _hits = [];

export class Occluders {

	constructor() {

		this.items = [];

	}

	// Give the mesh a material of its own so it can fade alone
	add( mesh ) {

		mesh.material = mesh.material.clone();
		this.items.push( { mesh, opacity: 1 } );

	}

	update( dt, camera, target ) {

		if ( ! this.items.length ) return;

		_target.copy( target );
		const distance = camera.position.distanceTo( _target );
		_raycaster.set( camera.position, _target.sub( camera.position ).normalize() );
		_raycaster.far = distance - 0.6;

		for ( const item of this.items ) {

			_hits.length = 0;
			item.mesh.raycast( _raycaster, _hits );
			const goal = _hits.length ? FADED : 1;
			item.opacity += Math.max( - RATE * dt, Math.min( RATE * dt, goal - item.opacity ) );

			// The material in use: Materials.setLambert may have swapped it
			const material = item.mesh.material;
			const faded = item.opacity < 0.999;

			if ( material.transparent !== faded ) {

				material.transparent = faded;
				material.depthWrite = ! faded;
				material.needsUpdate = true;

			}

			material.opacity = item.opacity;

		}

	}

}

// The finish piece's arch and posts as their own mesh, apart from the road
// under it (kit units: the road and its walls stay within |x| ≤ 5, y ≤ 1)
export function splitArch( model ) {

	model.traverse( ( child ) => {

		if ( ! child.isMesh || child.userData.arch !== undefined ) return;

		const source = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry;
		const pos = source.getAttribute( 'position' );
		const road = [], arch = [];
		const p = new THREE.Vector3();

		for ( let i = 0; i < pos.count; i += 3 ) {

			let x = 0, y = 0;

			for ( let k = 0; k < 3; k ++ ) {

				p.fromBufferAttribute( pos, i + k ).applyMatrix4( child.matrix );
				x += Math.abs( p.x ) / 3;
				y += p.y / 3;

			}

			( x > 5.05 || y > 1.05 ? arch : road ).push( i );

		}

		const pick = ( list ) => {

			const geometry = new THREE.BufferGeometry();

			for ( const name of Object.keys( source.attributes ) ) {

				const a = source.getAttribute( name );
				const array = new a.array.constructor( list.length * 3 * a.itemSize );
				list.forEach( ( start, n ) => array.set( a.array.subarray( start * a.itemSize, ( start + 3 ) * a.itemSize ), n * 3 * a.itemSize ) );
				geometry.setAttribute( name, new THREE.BufferAttribute( array, a.itemSize, a.normalized ) );

			}

			return geometry;

		};

		child.geometry = pick( road );
		child.userData.arch = false;

		const archMesh = new THREE.Mesh( pick( arch ), child.material );
		archMesh.name = 'arch';
		archMesh.userData.arch = true;
		archMesh.position.copy( child.position );
		archMesh.quaternion.copy( child.quaternion );
		archMesh.scale.copy( child.scale );
		child.parent.add( archMesh );

	} );

}
