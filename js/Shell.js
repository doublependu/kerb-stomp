// Loading / start / pause / error overlay. The markup and its CSS live inline
// in index.html so the loading screen paints before any script has arrived.

const OFFLINE = import.meta.env.MODE === 'offline';
const VERSION = import.meta.env.VITE_APP_VERSION;

const QUALITY_LABELS = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' };

export class Shell {

	constructor( { onStart, onPause, onResume, onQuality } ) {

		this.el = document.getElementById( 'shell' );
		this.state = 'loading';

		this.bar = this.el.querySelector( '.progress-bar' );
		this.status = this.el.querySelector( '.status' );
		this.errorMessage = this.el.querySelector( '.error-message' );
		this.qualityNote = document.getElementById( 'quality-note' );
		this.qualityButtons = this.el.querySelectorAll( '[data-quality]' );
		this.reloadButton = document.getElementById( 'reload-btn' );

		this.onStart = onStart;

		this.setupLinks();

		// Start: first key, tap or click anywhere on the overlay (links and
		// buttons keep their own behaviour). The key event is not swallowed,
		// so W / ↑ starts driving straight away. Pause keys live in the same
		// listener so one Escape can't both start and pause.

		window.addEventListener( 'keydown', ( e ) => {

			if ( e.repeat ) return;

			const pauseKey = e.code === 'Escape' || e.code === 'KeyP';

			if ( this.state === 'ready' ) {

				if ( e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Tab' ) return;
				this.start();

			} else if ( this.state === 'playing' && pauseKey ) {

				onPause();

			} else if ( this.state === 'paused' && pauseKey ) {

				onResume();

			}

		} );

		this.el.addEventListener( 'pointerdown', ( e ) => {

			if ( this.state !== 'ready' ) return;
			if ( e.target.closest( 'a, button' ) ) return;
			this.start();

		} );

		document.getElementById( 'resume-btn' ).addEventListener( 'click', () => onResume() );

		for ( const button of this.qualityButtons ) {

			button.addEventListener( 'click', () => onQuality( button.dataset.quality ) );

		}

		this.reloadButton.addEventListener( 'click', () => location.reload() );

		const fullscreen = document.getElementById( 'fullscreen-btn' );

		if ( document.fullscreenEnabled ) {

			const label = () => fullscreen.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
			label();
			document.addEventListener( 'fullscreenchange', label );

			fullscreen.addEventListener( 'click', () => {

				if ( document.fullscreenElement ) document.exitFullscreen();
				else document.documentElement.requestFullscreen().catch( () => {} );

			} );

		} else {

			fullscreen.hidden = true;

		}

	}

	setupLinks() {

		const map = new URLSearchParams( location.search ).get( 'map' );

		for ( const link of document.querySelectorAll( '.editor-link' ) ) {

			if ( OFFLINE ) {

				link.hidden = true;
				continue;

			}

			if ( map ) {

				link.href = 'editor.html?map=' + map;
				link.textContent = 'Edit this track';

			}

		}

		const download = document.getElementById( 'download-link' );

		if ( OFFLINE || import.meta.env.DEV ) {

			download.hidden = true;

		} else {

			download.download = `kerb-stomp-${ VERSION }.html`;
			const size = import.meta.env.VITE_OFFLINE_SIZE;
			if ( size ) download.textContent += ` (${ size })`;

		}

	}

	setState( state ) {

		this.state = state;
		this.el.dataset.state = state;
		document.body.dataset.state = state;

	}

	setProgress( fraction, text ) {

		this.bar.style.transform = `scaleX(${ Math.max( 0, Math.min( 1, fraction ) ) })`;
		if ( text ) this.status.textContent = text;

	}

	ready() {

		this.setProgress( 1 );
		this.setState( 'ready' );

	}

	start() {

		this.setState( 'playing' );
		this.onStart();

	}

	pause() {

		this.setState( 'paused' );
		document.getElementById( 'resume-btn' ).focus( { preventScroll: true } );

	}

	resume() {

		this.setState( 'playing' );

	}

	showError( message ) {

		this.errorMessage.textContent = message;
		this.setState( 'error' );

	}

	// setting: 'auto' | tier, tier: the tier in effect, needsReload: some
	// options (antialias, bloom buffer) only change on the next load
	setQuality( setting, tier, needsReload ) {

		for ( const button of this.qualityButtons ) {

			button.classList.toggle( 'active', button.dataset.quality === setting );
			button.setAttribute( 'aria-pressed', button.dataset.quality === setting );

		}

		let note = setting === 'auto' ? `Using ${ QUALITY_LABELS[ tier ] } for this device.` : '';
		if ( needsReload ) note += ' Some changes (antialiasing, lighting, bloom) apply after a reload.';
		this.qualityNote.textContent = note;
		this.reloadButton.hidden = ! needsReload;

	}

}

// Stop touch gestures that zoom the page: on iOS, Safari ignores
// user-scalable=no, and a pinched-in game has no UI to zoom back out.
export function lockViewport() {

	const prevent = ( e ) => e.preventDefault();

	document.addEventListener( 'gesturestart', prevent, { passive: false } );
	document.addEventListener( 'gesturechange', prevent, { passive: false } );
	document.addEventListener( 'gestureend', prevent, { passive: false } );

	document.addEventListener( 'touchmove', ( e ) => {

		if ( e.touches.length > 1 ) e.preventDefault();

	}, { passive: false } );

	document.addEventListener( 'dblclick', prevent, { passive: false } );

	// Trackpad pinch arrives as ctrl+wheel
	document.addEventListener( 'wheel', ( e ) => {

		if ( e.ctrlKey ) e.preventDefault();

	}, { passive: false } );

}
