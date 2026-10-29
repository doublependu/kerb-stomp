// Shared browser + server setup for the playtest bot and the load-time check.

import { spawn } from 'node:child_process';

// New headless Chrome with the real GPU. The default headless shell falls back
// to SwiftShader (software GL), which runs the game well under 30fps, and the
// sim's 1/30 dt clamp then turns that into slow motion. On Linux ANGLE needs
// the EGL backend to reach the GPU headlessly.
export function launchOptions( { headed = false } = {} ) {

	const args = [ '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required' ];
	if ( process.platform === 'linux' ) args.push( '--use-angle=gl-egl' );

	return { headless: ! headed, channel: 'chromium', args };

}

// Serves dist/ the way Cloudflare does (brotli for text, raw GLBs, _headers,
// extensionless .html redirects) via `wrangler dev`, or with `vite preview`.
export async function startServer( kind = 'wrangler' ) {

	const port = 8790 + Math.floor( Math.random() * 200 );
	const command = kind === 'wrangler'
		? [ 'wrangler', 'dev', '--port', String( port ), '--ip', '127.0.0.1' ]
		: [ 'vite', 'preview', '--port', String( port ), '--strictPort', '--host', '127.0.0.1' ];

	const child = spawn( 'npx', command, {
		env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
		stdio: 'ignore',
		detached: true,
	} );

	let exited = null;
	child.on( 'exit', ( code ) => exited = code );

	// Poll until it answers; vite preview prints nothing to a non-TTY stdout
	const url = `http://127.0.0.1:${ port }/`;
	const deadline = Date.now() + 60000;

	for ( ;; ) {

		if ( exited !== null ) throw new Error( `${ kind } exited with ${ exited }` );
		if ( Date.now() > deadline ) throw new Error( `${ kind } did not start` );

		try {

			if ( ( await fetch( url ) ).ok ) break;

		} catch {}

		await new Promise( ( resolve ) => setTimeout( resolve, 250 ) );

	}

	// npx → wrangler → workerd: kill the whole process group, or the children
	// outlive this script
	const stop = () => {

		try {

			process.kill( - child.pid, 'SIGTERM' );

		} catch {}

	};

	return { url, stop };

}
