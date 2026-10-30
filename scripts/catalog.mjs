// Contact sheets of every scenery model at the size it stands in the game,
// for reading each one's front and size (js/SceneryCatalog.js).
//
//   npm run catalog     (writes playtests/catalog/<kit>.png)

import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { launchOptions } from './playtest/browser.mjs';

const port = 5490 + Math.floor( Math.random() * 100 );
const vite = spawn( 'npx', [ 'vite', '--port', String( port ), '--strictPort', '--host', '127.0.0.1' ], { stdio: 'ignore', detached: true } );
const url = `http://127.0.0.1:${ port }/scripts/catalog.html`;

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
	await page.waitForFunction( () => window.sheets, null, { timeout: 120000 } );

	mkdirSync( 'playtests/catalog', { recursive: true } );

	for ( const [ kit, data ] of Object.entries( await page.evaluate( () => window.sheets ) ) ) {

		writeFileSync( `playtests/catalog/${ kit }.png`, Buffer.from( data.split( ',' )[ 1 ], 'base64' ) );
		console.log( `playtests/catalog/${ kit }.png` );

	}

	await browser.close();

} finally {

	process.kill( - vite.pid, 'SIGTERM' );

}
