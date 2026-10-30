// Each theme's colours (js/Scenery.js THEMES variations), so that no two tracks
// share a look: the ground and the filler tiles, the Racing Kit's stands and
// trees, and the Mini Forest's leaves. Written next to each kit's colormap
// (models/src/<kit>/Textures/variation-<theme>.png, Assets.js picks them up).
// The outputs are committed.
//
//   npm run palettes

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readPNG, writePNG } from './png.mjs';
import { THEMES } from '../js/Scenery.js';

const SRC = 'models/src/';
const rgb = ( hex ) => [ hex >> 16 & 255, hex >> 8 & 255, hex & 255 ];
const key = ( r, g, b ) => r << 16 | g << 8 | b;

function save( path, width, height, pixels ) {

	mkdirSync( dirname( path ), { recursive: true } );
	writeFileSync( path, writePNG( width, height, pixels ) );
	console.log( path );

}

// The Racing Kit's swatches, by what they paint
const STRUCTURE = 0xf9f9fb, WHITE = 0xffffff, SEATS = 0xf59c9b, GREY = 0x8d8d8d, GLASS = 0x94a5b6, LEAVES = 0x95c5af, GOLD = 0xfbdd8b, TRUNK = 0xebd4ae;

const RACING = {
	// Timber tribunes with purple seats, under the village's roofs
	village: { [ STRUCTURE ]: 0xd9b68a, [ WHITE ]: 0xf3e6cc, [ SEATS ]: 0x8f6fd6, [ GREY ]: 0x7a5a42, [ LEAVES ]: 0x8fae4f, [ TRUNK ]: 0xb98a5e },
	// White and sea blue, the Riviera
	suburb: { [ STRUCTURE ]: 0xfbfbf6, [ WHITE ]: 0xffffff, [ SEATS ]: 0x3f9fe0, [ GREY ]: 0x2f6f9f, [ GLASS ]: 0x9fd4ee, [ GOLD ]: 0xffffff },
	// Galvanised steel, safety-yellow seats; the trees are dark cedars
	industrial: { [ STRUCTURE ]: 0x8c94a3, [ WHITE ]: 0xa9b0bd, [ SEATS ]: 0xf2b632, [ GREY ]: 0x4f5563, [ GLASS ]: 0x5f6b7e, [ LEAVES ]: 0x2c5e52, [ TRUNK ]: 0x5c4a44 },
	// Rough timber bleachers with bush-green benches
	mountain: { [ STRUCTURE ]: 0x9a6a44, [ WHITE ]: 0xb98a5e, [ SEATS ]: 0x5f8a4e, [ GREY ]: 0x5e4230, [ LEAVES ]: 0x7f9a58, [ TRUNK ]: 0x8a6a4a },
};

function racing( theme, swaps ) {

	const { width, height, pixels } = readPNG( readFileSync( SRC + 'racing/Textures/colormap.png' ) );

	for ( let o = 0; o < pixels.length; o += 4 ) {

		const to = swaps[ key( pixels[ o ], pixels[ o + 1 ], pixels[ o + 2 ] ) ];
		if ( to !== undefined ) pixels.set( rgb( to ), o );

	}

	save( `${ SRC }racing/Textures/variation-${ theme }.png`, width, height, pixels );

}

// The Starter Kit's grass and its pines share one column of swatches (rows 6
// and 7 of 8, shaded). The theme's grass takes their place, keeping the shading.
const SWATCH = 64, GRASS = rgb( 0x328260 );

function ground( theme, grass ) {

	const { width, height, pixels } = readPNG( readFileSync( SRC + 'Textures/colormap.png' ) );
	const to = rgb( grass );
	const base = GRASS[ 0 ] + GRASS[ 1 ] + GRASS[ 2 ];

	for ( let y = SWATCH * 6; y < height; y ++ ) {

		for ( let x = 0; x < SWATCH; x ++ ) {

			const o = ( y * width + x ) * 4;
			const shade = ( pixels[ o ] + pixels[ o + 1 ] + pixels[ o + 2 ] ) / base;
			pixels.set( to.map( ( v ) => Math.min( 255, Math.round( v * shade ) ) ), o );

		}

	}

	save( `${ SRC }starter/Textures/variation-${ theme }.png`, width, height, pixels );

}

// The Mini Forest's greens toward a gum tree's dry grey-green
function gums( theme ) {

	const { width, height, pixels } = readPNG( readFileSync( SRC + 'forest/Textures/colormap.png' ) );

	for ( let o = 0; o < pixels.length; o += 4 ) {

		const [ r, g, b ] = [ pixels[ o ], pixels[ o + 1 ], pixels[ o + 2 ] ];
		if ( g <= r * 1.05 || g <= b * 1.05 ) continue;

		// Greener than anything else: pull the blue out and the red up
		const light = ( r + g + b ) / 3;
		pixels.set( [ light * 0.8, light * 0.9, light * 0.52 ].map( ( v ) => Math.min( 255, Math.round( v ) ) ), o );

	}

	save( `${ SRC }forest/Textures/variation-${ theme }.png`, width, height, pixels );

}

for ( const [ theme, swaps ] of Object.entries( RACING ) ) racing( theme, swaps );

for ( const [ theme, t ] of Object.entries( THEMES ) ) if ( t.variations.starter ) ground( theme, t.grass );

gums( 'mountain' );
