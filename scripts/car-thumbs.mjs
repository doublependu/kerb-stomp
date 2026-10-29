// Render the car picker's thumbnail sheet (sprites/cars.webp) from the
// compressed models, through the game's own loader.
//
//   npm run models && npm run thumbs

import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { launchOptions } from './playtest/browser.mjs';

const port = 5390 + Math.floor( Math.random() * 100 );
const vite = spawn( 'npx', [ 'vite', '--port', String( port ), '--strictPort', '--host', '127.0.0.1' ], { stdio: 'ignore', detached: true } );
const url = `http://127.0.0.1:${ port }/scripts/car-thumbs.html`;

try {

	for ( let i = 0; ; i ++ ) {

		try {

			if ( ( await fetch( url ) ).ok ) break;

		} catch {}

		if ( i > 200 ) throw new Error( 'vite did not start' );
		await new Promise( ( resolve ) => setTimeout( resolve, 250 ) );

	}

	const browser = await chromium.launch( launchOptions() );
	const page = await browser.newPage();
	page.on( 'pageerror', ( e ) => console.error( e.message ) );
	await page.goto( url );
	await page.waitForFunction( () => window.thumbs, null, { timeout: 60000 } );

	const data = await page.evaluate( () => window.thumbs );
	const bytes = Buffer.from( data.split( ',' )[ 1 ], 'base64' );
	writeFileSync( 'sprites/cars.webp', bytes );
	console.log( `sprites/cars.webp: ${ ( bytes.length / 1024 ).toFixed( 1 ) } KB` );

	await browser.close();

} finally {

	process.kill( - vite.pid, 'SIGTERM' );

}
