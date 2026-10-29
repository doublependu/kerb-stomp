// Every runtime asset goes through an import so the build can hash it for
// long-lived caching, and the offline build can inline it into one HTML file.

import starterColormapUrl from '../models/src/Textures/colormap.png?url';
import carsColormapUrl from '../models/src/cars/Textures/colormap.png?url';
import smokeUrl from '../sprites/smoke.png?url';
import skidUrl from '../audio/skid.ogg?url';
import carThumbsUrl from '../sprites/cars.webp?url';

// Compressed models (scripts/models.mjs): Starter Kit pieces and trucks in
// models/, Car Kit vehicles and debris in models/cars/. Names don't collide.
const modelModules = import.meta.glob( [ '../models/*.glb', '../models/cars/*.glb' ], { query: '?url', import: 'default', eager: true } );

export const MODEL_URLS = {};

for ( const path in modelModules ) {

	const name = path.slice( path.lastIndexOf( '/' ) + 1, - '.glb'.length );
	MODEL_URLS[ name ] = modelModules[ path ];

}

// One colormap per Kenney kit (see Loader.js)
export const COLORMAP_URLS = { starter: starterColormapUrl, cars: carsColormapUrl };
export const SMOKE_URL = smokeUrl;
export const SKID_URL = skidUrl;
export const CAR_THUMBS_URL = carThumbsUrl;
