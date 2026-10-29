// Moves the single-file offline build next to the site as kerb-stomp.html.

import { copyFileSync, statSync } from 'node:fs';

const from = 'dist-offline/index.html';
const to = 'dist/kerb-stomp.html';

copyFileSync( from, to );

console.log( `offline build: ${ to } (${ ( statSync( to ).size / 1e6 ).toFixed( 2 ) } MB)` );
