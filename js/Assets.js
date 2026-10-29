// Every runtime asset goes through an import so the build can hash it for
// long-lived caching, and the offline build can inline it into one HTML file.

import colormapUrl from '../models/Textures/colormap.png?url';
import smokeUrl from '../sprites/smoke.png?url';
import skidUrl from '../audio/skid.ogg?url';

// track-tents.glb is unused (the decoration-tents variant is placed instead)
const modelModules = import.meta.glob( [ '../models/*.glb', '!../models/track-tents.glb' ], { query: '?url', import: 'default', eager: true } );

export const MODEL_URLS = {};

for ( const path in modelModules ) {

	const name = path.slice( path.lastIndexOf( '/' ) + 1, - '.glb'.length );
	MODEL_URLS[ name ] = modelModules[ path ];

}

export const COLORMAP_URL = colormapUrl;
export const SMOKE_URL = smokeUrl;
export const SKID_URL = skidUrl;
