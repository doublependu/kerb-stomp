// Every runtime asset goes through an import so the build can hash it for
// long-lived caching, and the offline build can inline it into one HTML file.

import starterColormapUrl from '../models/src/Textures/colormap.png?url';
import carsColormapUrl from '../models/src/cars/Textures/colormap.png?url';
import smokeUrl from '../sprites/smoke.png?url';
import skidUrl from '../audio/skid.ogg?url';
import carThumbsUrl from '../sprites/cars.webp?url';

// Compressed models (scripts/models.mjs): Starter Kit pieces and trucks in
// models/, Car Kit vehicles and debris in models/cars/ (names don't
// collide), and scenery kits in models/<kit>/, named '<kit>/<model>'.
const modelModules = import.meta.glob( [ '../models/*.glb', '../models/*/*.glb', '!../models/src/**' ], { query: '?url', import: 'default', eager: true } );

export const MODEL_URLS = {};

for ( const path in modelModules ) {

	const [ folder, file ] = path.split( '/' ).slice( - 2 );
	const name = file.slice( 0, - '.glb'.length );
	MODEL_URLS[ folder === 'models' || folder === 'cars' ? name : folder + '/' + name ] = modelModules[ path ];

}

// One colormap per Kenney kit (see Loader.js), plus each scenery kit's
// colour variations as '<kit>-a' etc.
export const COLORMAP_URLS = { starter: starterColormapUrl, cars: carsColormapUrl };

const colormapModules = import.meta.glob( [ '../models/src/*/Textures/*.png', '!../models/src/cars/**' ], { query: '?url', import: 'default', eager: true } );

for ( const path in colormapModules ) {

	const parts = path.split( '/' );
	const kit = parts[ parts.length - 3 ];
	const file = parts[ parts.length - 1 ];
	COLORMAP_URLS[ file === 'colormap.png' ? kit : kit + '-' + file.slice( 'variation-'.length, - '.png'.length ) ] = colormapModules[ path ];

}

export const SMOKE_URL = smokeUrl;
export const SKID_URL = skidUrl;
export const CAR_THUMBS_URL = carThumbsUrl;
