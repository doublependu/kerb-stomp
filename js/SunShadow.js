import * as THREE from 'three';

// The sun's shadow box covers what's on screen instead of the whole track, so
// its cost stops growing with track size and the shadow map's texels land
// where they're seen. The box is fixed per viewport (Camera.footprint) and
// its centre snaps to whole shadow texels, so edges don't crawl as the
// camera moves.

export const SUN_DIRECTION = new THREE.Vector3( 11.4, 15, - 5.3 ).normalize();

const SUN_DISTANCE = 30;
const MARGIN = 1.5;

export class SunShadow {

	constructor( light ) {

		this.light = light;
		this.target = new THREE.Object3D();
		light.target = this.target;

		// The shadow camera's axes: it looks from the sun toward the target
		const basis = new THREE.Matrix4().lookAt( SUN_DIRECTION, new THREE.Vector3(), new THREE.Vector3( 0, 1, 0 ) );
		this.right = new THREE.Vector3().setFromMatrixColumn( basis, 0 );
		this.up = new THREE.Vector3().setFromMatrixColumn( basis, 1 );

		this.texelX = 0;
		this.texelY = 0;

		// How far ground can rise above or fall below the look point (hills)
		this.rise = 0;

	}

	// footprint: ground points around the look point (see Camera.updateFootprint)
	fit( footprint ) {

		let minX = Infinity, maxX = - Infinity, minY = Infinity, maxY = - Infinity;

		for ( const p of footprint ) {

			for ( const dy of this.rise ? [ - this.rise, 0, this.rise ] : [ 0 ] ) {

				const x = p.dot( this.right ) + dy * this.right.y, y = p.dot( this.up ) + dy * this.up.y;
				minX = Math.min( minX, x );
				maxX = Math.max( maxX, x );
				minY = Math.min( minY, y );
				maxY = Math.max( maxY, y );

			}

		}

		const camera = this.light.shadow.camera;
		camera.left = minX - MARGIN;
		camera.right = maxX + MARGIN;
		camera.bottom = minY - MARGIN;
		camera.top = maxY + MARGIN;
		camera.near = 0.5;
		camera.far = SUN_DISTANCE * 2;
		camera.updateProjectionMatrix();

		const size = this.light.shadow.mapSize;
		this.texelX = ( camera.right - camera.left ) / size.x;
		this.texelY = ( camera.top - camera.bottom ) / size.y;

	}

	update( lookPoint ) {

		const x = lookPoint.dot( this.right ), y = lookPoint.dot( this.up );

		this.target.position.copy( lookPoint )
			.addScaledVector( this.right, Math.round( x / this.texelX ) * this.texelX - x )
			.addScaledVector( this.up, Math.round( y / this.texelY ) * this.texelY - y );
		this.target.updateMatrixWorld();

		this.light.position.copy( this.target.position ).addScaledVector( SUN_DIRECTION, SUN_DISTANCE );

	}

}
