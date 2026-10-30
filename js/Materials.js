import * as THREE from 'three';

const _point = new THREE.Vector3();
const _uv = new THREE.Vector3();

// The low tier shades everything with Lambert instead of the models' matte
// standard materials. On an Intel HD 630 that saves 2–3ms a frame at 1080p
// (scripts/bench.mjs), and the two look nearly the same.

const lambertOf = new WeakMap();
const standardOf = new WeakMap();
const paletted = new WeakMap();

// The material with another palette: the same UV transform, a shared copy per
// material and palette
export function withColormap( material, texture ) {

	if ( ! paletted.has( material ) ) paletted.set( material, new Map() );
	const copies = paletted.get( material );

	if ( ! copies.has( texture ) ) {

		const copy = material.clone();
		const map = texture.clone();
		map.offset.copy( material.map.offset );
		map.repeat.copy( material.map.repeat );
		map.needsUpdate = true;
		copy.map = map;
		copies.set( texture, copy );

	}

	return copies.get( texture );

}

// A Starter Kit tile on a themed track: in the theme's palette, its pines in
// the theme's leaves. Grass and pines share a swatch, so the pines (nothing else
// in that swatch stands over 1 kit unit: the ground's mounds stop at 0.7) get a
// vertex colour. tint: [ r, g, b ], leaf over grass in linear colour.
export function paintTile( model, texture, tint ) {

	model.updateMatrixWorld( true );

	model.traverse( ( child ) => {

		if ( ! child.isMesh ) return;

		const { position, uv } = child.geometry.attributes;
		const { material } = child;
		const colors = new Float32Array( position.count * 3 ).fill( 1 );
		material.map.updateMatrix();

		for ( let i = 0; i < position.count; i ++ ) {

			_point.fromBufferAttribute( position, i ).applyMatrix4( child.matrixWorld );
			_uv.set( uv.getX( i ), uv.getY( i ), 1 ).applyMatrix3( material.map.matrix );
			if ( _point.y > 0.85 && _uv.x < 1 / 8 && _uv.y > 3 / 4 ) colors.set( tint, i * 3 );

		}

		child.geometry.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) );

		const copy = withColormap( material, texture ).clone();
		copy.vertexColors = true;
		child.material = copy;

	} );

}

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
					vertexColors: material.vertexColors,
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
