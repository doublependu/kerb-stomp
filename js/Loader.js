import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { COLORMAP_URLS } from './Assets.js';

// Every model from a Kenney kit samples the same colormap. The compressed
// models (scripts/models.mjs) carry a 1×1 placeholder image named
// `colormap-<kit>`; this plugin hands out one shared texture per kit instead.

const colormaps = {};
const ready = {};

export function getColormap( kit ) {

	if ( ! colormaps[ kit ] ) {

		ready[ kit ] = new Promise( ( resolve ) => {

			const texture = new THREE.TextureLoader().load( COLORMAP_URLS[ kit ], resolve, undefined, resolve );
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.flipY = false;
			colormaps[ kit ] = texture;

		} );

	}

	return colormaps[ kit ];

}

// Resolves once the kit's colormap has loaded (or failed): until then its
// models draw black, which a menu that only redraws on changes would keep
export function colormapLoaded( kit ) {

	getColormap( kit );
	return ready[ kit ];

}

// The track, decorations and default truck all use it: start it right away
getColormap( 'starter' );

class SharedColorMapPlugin {

	constructor( parser ) {

		this.parser = parser;
		this.name = 'SHARED_COLORMAP';

	}

	loadTexture( textureIndex ) {

		const json = this.parser.json;
		const textureDef = json.textures[ textureIndex ];
		const name = json.images[ textureDef.source ].name || '';
		const kit = name.startsWith( 'colormap-' ) ? name.slice( 'colormap-'.length ) : null;

		if ( kit in COLORMAP_URLS ) return Promise.resolve( getColormap( kit ) );

		return null;

	}

}

export class ColorMapGLTFLoader extends GLTFLoader {

	constructor( manager ) {

		super( manager );
		this.setMeshoptDecoder( MeshoptDecoder );
		this.register( ( parser ) => new SharedColorMapPlugin( parser ) );

	}

}
