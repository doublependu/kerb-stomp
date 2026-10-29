// Device test and graphics tiers.
//
// The tier is picked before the renderer exists, because antialiasing and the
// HalfFloat output buffer (needed for bloom) are fixed at context creation,
// and light probes are baked once at load. Pixel ratio, shadow size, bloom on
// a HalfFloat renderer and dropping the probes can change live.
//
// Measured on an Intel HD 630 (scripts: __kerb.benchmark): the HalfFloat
// output path adds ~60% to the frame (+8ms at 1366×768, +14ms at 1080p) for a
// bloom at strength 0.02, and the probe grid adds another 5–10ms; shadow map
// size barely matters. So medium keeps probes but skips HalfFloat/bloom.

export const TIERS = [ 'low', 'medium', 'high' ];

//
// The shadow box follows the view (SunShadow.js) rather than spanning the
// track, so 1024² on low is already sharper than the old 4096² was on large
// tracks. Low also swaps in Lambert shading (Materials.js).

export const PRESETS = {
	low: { pixelRatio: 1, antialias: false, halfFloat: false, bloom: false, shadowMapSize: 1024, probes: 0, probeCubemapSize: 16, lambert: true },
	medium: { pixelRatio: 1.5, antialias: true, halfFloat: false, bloom: false, shadowMapSize: 2048, probes: 0.5, probeCubemapSize: 16, lambert: false },
	high: { pixelRatio: 2, antialias: true, halfFloat: true, bloom: true, shadowMapSize: 2048, probes: 1, probeCubemapSize: 32, lambert: false },
};

const SETTING_KEY = 'kerb.quality';
const AUTO_KEY = 'kerb.quality.auto';

function probeGPU() {

	try {

		const canvas = document.createElement( 'canvas' );
		const gl = canvas.getContext( 'webgl2' );
		if ( ! gl ) return null;

		const ext = gl.getExtension( 'WEBGL_debug_renderer_info' );
		const renderer = String( ext ? gl.getParameter( ext.UNMASKED_RENDERER_WEBGL ) : gl.getParameter( gl.RENDERER ) );
		const maxTextureSize = gl.getParameter( gl.MAX_TEXTURE_SIZE );

		const lose = gl.getExtension( 'WEBGL_lose_context' );
		if ( lose ) lose.loseContext();

		return { renderer, maxTextureSize };

	} catch {

		return null;

	}

}

function isMobile() {

	const coarse = window.matchMedia( '(pointer: coarse)' ).matches;
	const short = Math.min( screen.width, screen.height );
	return ( coarse && short < 900 ) || /Android|iPhone|iPad|iPod|Mobi/i.test( navigator.userAgent );

}

function classifyGPU( name ) {

	const s = name.toLowerCase();

	if ( /swiftshader|llvmpipe|softpipe|software|basic render/.test( s ) ) return 'low';
	if ( /nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|intel.*\barc\b|apple m\d/.test( s ) ) return 'high';

	const adreno = s.match( /adreno[^\d]*(\d{3})/ );
	if ( adreno ) return Number( adreno[ 1 ] ) >= 640 ? 'medium' : 'low';

	if ( /mali-g(7\d|6\d\d|7\d\d)|immortalis|xclipse/.test( s ) ) return 'medium';
	if ( /mali|powervr|videocore/.test( s ) ) return 'low';

	// Intel HD / UHD (the typical no-dGPU PC) holds 60fps at 1080p on low but
	// not with probes; Iris Xe is roughly twice as fast
	if ( /intel.*(u?hd graphics|hd \d)/.test( s ) ) return 'low';

	// Intel Iris, AMD integrated, Apple GPU (masked) and anything unknown
	return 'medium';

}

export function detectTier() {

	const gpu = probeGPU();

	if ( gpu === null ) return { tier: null, gpu: null, reason: 'WebGL 2 unavailable' };

	const mobile = isMobile();
	let tier = classifyGPU( gpu.renderer );
	const reasons = [ gpu.renderer ];

	const memory = navigator.deviceMemory;
	const cores = navigator.hardwareConcurrency || 4;

	if ( ( memory !== undefined && memory <= 2 ) || ( mobile && cores <= 4 ) ) {

		tier = 'low';
		reasons.push( 'low memory/cores' );

	}

	// Phones render at up to 3x DPR on small GPUs: keep them off the top tier
	if ( mobile && tier === 'high' ) tier = 'medium';

	if ( gpu.maxTextureSize < 4096 && tier !== 'low' ) tier = 'low';

	return { tier, gpu: gpu.renderer, reason: reasons.join( ', ' ) };

}

// 'auto' | 'low' | 'medium' | 'high'
export function loadSetting() {

	const param = new URLSearchParams( location.search ).get( 'quality' );
	if ( param === 'auto' || TIERS.includes( param ) ) return param;

	try {

		const v = localStorage.getItem( SETTING_KEY );
		return TIERS.includes( v ) ? v : 'auto';

	} catch {

		return 'auto';

	}

}

export function saveSetting( value ) {

	try {

		localStorage.setItem( SETTING_KEY, value );

	} catch {}

}

// The adaptive step-down result, remembered per GPU so the next load starts there.
export function loadAutoTier( gpu ) {

	try {

		const data = JSON.parse( localStorage.getItem( AUTO_KEY ) );
		return data && data.gpu === gpu && TIERS.includes( data.tier ) ? data.tier : null;

	} catch {

		return null;

	}

}

export function saveAutoTier( gpu, tier ) {

	try {

		localStorage.setItem( AUTO_KEY, JSON.stringify( { gpu, tier } ) );

	} catch {}

}

export function lowerTier( tier ) {

	const i = TIERS.indexOf( tier );
	return i > 0 ? TIERS[ i - 1 ] : tier;

}

// Watches frame times after the player starts driving and reports when the
// device can't hold ~45fps at the current tier.
export class FrameMonitor {

	constructor() {

		this.samples = [];
		this.window = 180;

	}

	reset() {

		this.samples.length = 0;

	}

	push( dt ) {

		this.samples.push( dt );
		if ( this.samples.length > this.window ) this.samples.shift();

	}

	full() {

		return this.samples.length >= this.window;

	}

	percentile( p ) {

		if ( this.samples.length === 0 ) return 0;
		const sorted = this.samples.slice().sort( ( a, b ) => a - b );
		return sorted[ Math.min( sorted.length - 1, Math.floor( sorted.length * p ) ) ];

	}

}
