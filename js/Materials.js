import * as THREE from 'three';

// The low tier shades everything with Lambert instead of the models' matte
// standard materials. On an Intel HD 630 that saves 2–3ms a frame at 1080p
// (scripts/bench.mjs), and the two look nearly the same.

const lambertOf = new WeakMap();
const standardOf = new WeakMap();

export function setLambert( root, enabled ) {

	root.traverse( ( object ) => {

		if ( ! object.isMesh ) return;

		const material = object.material;

		if ( enabled && material.isMeshStandardMaterial ) {

			let lambert = lambertOf.get( material );

			if ( ! lambert ) {

				lambert = new THREE.MeshLambertMaterial( {
					map: material.map,
					color: material.color,
					side: material.side,
					transparent: material.transparent,
					opacity: material.opacity,
				} );

				lambertOf.set( material, lambert );
				standardOf.set( lambert, material );

			}

			object.material = lambert;

		} else if ( ! enabled && standardOf.has( material ) ) {

			object.material = standardOf.get( material );

		}

	} );

}
