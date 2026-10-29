import * as THREE from 'three';
import { SMOKE_URL } from './Assets.js';

const POOL_SIZE = 1280;
const PARTICLES_PER_EMIT = 3;
const EMIT_JITTER = 0.15;
const BASE_SIZE = 1;
const MAX_LIFE = 2.5;
const INV_MAX_LIFE = 1 / MAX_LIFE;

const _blPos = new THREE.Vector3();
const _brPos = new THREE.Vector3();

export class SmokeTrails {

	// color: grey tyre smoke, or brown gravel dust
	constructor( scene, { color = 0x5E5F6B } = {} ) {

		const positions = new Float32Array( POOL_SIZE * 3 );
		const opacities = new Float32Array( POOL_SIZE );
		const sizes = new Float32Array( POOL_SIZE );

		const geometry = new THREE.BufferGeometry();

		const posAttr = new THREE.BufferAttribute( positions, 3 );
		posAttr.setUsage( THREE.DynamicDrawUsage );
		geometry.setAttribute( 'position', posAttr );

		const opacityAttr = new THREE.BufferAttribute( opacities, 1 );
		opacityAttr.setUsage( THREE.DynamicDrawUsage );
		geometry.setAttribute( 'aOpacity', opacityAttr );

		const sizeAttr = new THREE.BufferAttribute( sizes, 1 );
		sizeAttr.setUsage( THREE.DynamicDrawUsage );
		geometry.setAttribute( 'aSize', sizeAttr );

		const map = new THREE.TextureLoader().load( SMOKE_URL );

		const material = new THREE.PointsMaterial( {
			map,
			color,
			size: 1,
			sizeAttenuation: true,
			transparent: true,
			depthWrite: false,
		} );

		// PointsMaterial has no per-vertex size or alpha, so inject attributes
		// and fold them into gl_PointSize and diffuseColor.a.
		material.onBeforeCompile = ( shader ) => {

			shader.vertexShader = 'attribute float aSize;\nattribute float aOpacity;\nvarying float vOpacity;\n' + shader.vertexShader;
			shader.vertexShader = shader.vertexShader.replace(
				'void main() {',
				'void main() {\n\tvOpacity = aOpacity;'
			);
			shader.vertexShader = shader.vertexShader.replace(
				'gl_PointSize = size;',
				'gl_PointSize = size * aSize;'
			);

			shader.fragmentShader = 'varying float vOpacity;\n' + shader.fragmentShader;
			shader.fragmentShader = shader.fragmentShader.replace(
				'vec4 diffuseColor = vec4( diffuse, opacity );',
				'vec4 diffuseColor = vec4( diffuse, opacity * vOpacity );'
			);

		};

		const points = new THREE.Points( geometry, material );
		points.frustumCulled = false;
		scene.add( points );

		this.posAttr = posAttr;
		this.opacityAttr = opacityAttr;
		this.sizeAttr = sizeAttr;
		this.positions = positions;
		this.opacities = opacities;
		this.sizes = sizes;

		this.particles = [];

		for ( let i = 0; i < POOL_SIZE; i ++ ) {

			this.particles.push( {
				life: 0,
				velocity: new THREE.Vector3(),
				initialSize: 0,
			} );

		}

		this.emitIndex = 0;

	}

	// Drift smoke from a car's rear wheels (call per car, per step)
	emit( vehicle ) {

		if ( vehicle.driftIntensity <= 0.7 ) return;

		const roadY = vehicle.container.position.y + 0.05;
		const bl = vehicle.wheelBL ? vehicle.wheelBL.getWorldPosition( _blPos ) : null;
		const br = vehicle.wheelBR ? vehicle.wheelBR.getWorldPosition( _brPos ) : null;

		for ( let i = 0; i < PARTICLES_PER_EMIT; i ++ ) {

			if ( bl ) this.emitAt( bl.x, roadY, bl.z );
			if ( br ) this.emitAt( br.x, roadY, br.z );

		}

		this.emitted = true;

	}

	// Gravel dust kicked up from a car's rear wheels (call per car, per step)
	dust( vehicle, speed ) {

		if ( speed < 3 || Math.random() > speed / 25 ) return;

		const roadY = vehicle.container.position.y + 0.05;

		for ( const wheel of [ vehicle.wheelBL, vehicle.wheelBR ] ) {

			if ( ! wheel ) continue;
			wheel.getWorldPosition( _blPos );
			this.emitAt( _blPos.x, roadY, _blPos.z );

		}

		this.emitted = true;

	}

	// A burst where two cars hit
	puff( x, y, z, count ) {

		for ( let i = 0; i < count; i ++ ) this.emitAt( x, y, z );
		this.emitted = true;

	}

	update( dt ) {

		const shouldEmit = this.emitted;
		this.emitted = false;
		let aliveCount = 0;

		const damping = 1 - dt;

		for ( let i = 0; i < POOL_SIZE; i ++ ) {

			const p = this.particles[ i ];
			if ( p.life <= 0 ) continue;

			p.life -= dt;

			if ( p.life <= 0 ) {

				this.opacities[ i ] = 0;
				aliveCount ++;
				continue;

			}

			const t = 1 - p.life * INV_MAX_LIFE;

			p.velocity.multiplyScalar( damping );

			const posIdx = i * 3;
			this.positions[ posIdx ] += p.velocity.x * dt;
			this.positions[ posIdx + 1 ] += p.velocity.y * dt;
			this.positions[ posIdx + 2 ] += p.velocity.z * dt;

			this.opacities[ i ] = ( 1 - t ) * 0.25;
			this.sizes[ i ] = p.initialSize * ( 0.5 + t * 2.5 );

			aliveCount ++;

		}

		if ( shouldEmit || aliveCount > 0 ) {

			this.posAttr.needsUpdate = true;
			this.opacityAttr.needsUpdate = true;
			this.sizeAttr.needsUpdate = true;

		}

	}

	emitAt( x, y, z ) {

		const i = this.emitIndex;
		this.emitIndex = ( i + 1 ) % POOL_SIZE;

		const p = this.particles[ i ];

		const posIdx = i * 3;
		this.positions[ posIdx ] = x + ( Math.random() - 0.5 ) * EMIT_JITTER;
		this.positions[ posIdx + 1 ] = y + Math.random() * EMIT_JITTER;
		this.positions[ posIdx + 2 ] = z + ( Math.random() - 0.5 ) * EMIT_JITTER;

		p.initialSize = BASE_SIZE * ( 0.5 + Math.random() * 0.5 );

		p.velocity.set(
			( Math.random() - 0.5 ) * 0.2,
			0.5 + Math.random() * 0.5,
			( Math.random() - 0.5 ) * 0.2
		);

		p.life = MAX_LIFE;

	}

}
