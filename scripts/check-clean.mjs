// Warns before a deploy from a dirty tree: the version label is stamped from
// HEAD, so uncommitted changes would ship under a commit that doesn't hold them.

import { execSync } from 'node:child_process';

try {

	const status = execSync( 'git status --porcelain', { encoding: 'utf8' } ).trim();

	if ( status ) {

		const sha = execSync( 'git rev-parse --short=4 HEAD', { encoding: 'utf8' } ).trim();
		console.warn( `\n⚠  Working tree has uncommitted changes; this deploy will be labelled v.${ sha } but includes them.\n` );

	}

} catch {

	console.warn( '⚠  Could not read git status; the version label may be "v.dev".' );

}
