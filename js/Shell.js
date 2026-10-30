// Loading / setup / pause / results / error overlay. The markup and its CSS
// live inline in index.html so the loading screen paints before any script
// has arrived.
//
// States: loading → ready (race setup, with a car picker view) → playing ⇄
// paused, → finished (race results) → ready or playing again; error.

import { CARS } from './CarList.js';
import { TRACKS } from './Tracks.js';
import { thumbStyle } from './CarThumbs.js';
import { MAX_NPCS, loadMedals } from './Settings.js';
import { medalSVG, badgeCount } from './Podium.js';
import { formatTime } from './LapTimer.js';
import { ordinal } from './Hud.js';

const OFFLINE = import.meta.env.MODE === 'offline';
const VERSION = import.meta.env.VITE_APP_VERSION;

const QUALITY_LABELS = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' };

// Weight class (CarList.js mass: handling and who shoves whom), with pips.
// No speed stats: every car has the same top speed.
export function weightLabel( car ) {

	const mass = car.mass ?? 1;
	return mass < 0.6 ? 'Light ●○○' : mass < 1.1 ? 'Medium ●●○' : 'Heavy ●●●';

}

export class Shell {

	// handlers: onStart, onPause, onResume, onQuality( setting ), onCar( id ),
	// onNpcs( count ), onTouch( scheme ), onTrack( id ), onRestart, onSetup,
	// onReset
	constructor( handlers ) {

		this.handlers = handlers;
		this.el = document.getElementById( 'shell' );
		this.state = 'loading';

		this.bar = this.el.querySelector( '.progress-bar' );
		this.status = this.el.querySelector( '.status' );
		this.errorMessage = this.el.querySelector( '.error-message' );
		this.qualityNote = document.getElementById( 'quality-note' );
		this.qualityButtons = this.el.querySelectorAll( '[data-quality]' );
		this.reloadButton = document.getElementById( 'reload-btn' );
		this.startButton = document.getElementById( 'start-btn' );
		this.setView( 'setup' );

		this.setupLinks();

		// Keys: Enter / W / ↑ start from the setup screen (W keeps the old one-key
		// start: the key isn't swallowed, so the car pulls away at once in
		// time trial). Pause keys live in the same listener so one Escape
		// can't both start and pause.

		window.addEventListener( 'keydown', ( e ) => {

			if ( e.repeat ) return;

			const pauseKey = e.code === 'Escape' || e.code === 'KeyP';
			const onButton = document.activeElement && document.activeElement.closest( 'button, a' );
			const confirm = ( e.code === 'Enter' && ! onButton ) || e.code === 'KeyW' || e.code === 'ArrowUp';

			if ( this.state === 'ready' ) {

				if ( this.view === 'cars' ) {

					if ( e.code === 'Escape' ) this.setView( 'setup' );

				} else if ( confirm ) {

					this.start();

				}

			} else if ( this.state === 'playing' && pauseKey ) {

				handlers.onPause();

			} else if ( this.state === 'paused' && pauseKey ) {

				handlers.onResume();

			} else if ( this.state === 'finished' && e.code === 'Enter' && ! onButton ) {

				handlers.onRestart();

			}

		} );

		this.startButton.addEventListener( 'click', () => this.start() );
		document.getElementById( 'resume-btn' ).addEventListener( 'click', () => handlers.onResume() );
		document.getElementById( 'reset-btn' ).addEventListener( 'click', () => handlers.onReset() );
		document.getElementById( 'again-btn' ).addEventListener( 'click', () => handlers.onRestart() );
		for ( const b of this.el.querySelectorAll( '.restart-btn' ) ) b.addEventListener( 'click', () => handlers.onRestart() );
		for ( const b of this.el.querySelectorAll( '.setup-btn' ) ) b.addEventListener( 'click', () => handlers.onSetup() );

		for ( const button of this.qualityButtons ) {

			button.addEventListener( 'click', () => handlers.onQuality( button.dataset.quality ) );

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

		// Opponents steppers (setup and pause menu)
		for ( const stepper of this.el.querySelectorAll( '.npc-stepper' ) ) {

			stepper.addEventListener( 'click', ( e ) => {

				const button = e.target.closest( '[data-step]' );
				if ( button ) handlers.onNpcs( this.npcs + Number( button.dataset.step ) );

			} );

		}

		for ( const button of this.el.querySelectorAll( '[data-touch]' ) ) {

			button.addEventListener( 'click', () => handlers.onTouch( button.dataset.touch ) );

		}

		document.getElementById( 'car-btn' ).addEventListener( 'click', () => this.setView( 'cars' ) );
		document.getElementById( 'cars-back' ).addEventListener( 'click', () => this.setView( 'setup' ) );

	}

	setupLinks() {

		for ( const link of document.querySelectorAll( '.editor-link' ) ) link.hidden = OFFLINE;

		const download = document.getElementById( 'download-link' );

		if ( OFFLINE || import.meta.env.DEV ) {

			download.hidden = true;

		} else {

			download.download = `kerb-stomp-${ VERSION }.html`;
			const size = import.meta.env.VITE_OFFLINE_SIZE;
			if ( size ) download.textContent += ` (${ size })`;

		}

	}

	// The pickers: tracks (with the custom one from ?map=, if any) and cars
	buildPickers( track, editorQuery ) {

		const tracks = document.getElementById( 'track-picker' );
		const list = track.custom ? [ ...TRACKS, track ] : TRACKS;

		const medals = loadMedals();

		for ( const t of list ) {

			const button = document.createElement( 'button' );
			button.textContent = t.name;
			if ( medals[ t.id ] ) button.insertAdjacentHTML( 'beforeend', ' ' + medalSVG( medals[ t.id ], 15 ) );
			button.title = t.inspiredBy ? 'Inspired by ' + t.inspiredBy : '';
			button.classList.toggle( 'active', t.id === track.id );
			button.setAttribute( 'aria-pressed', t.id === track.id );
			if ( t.id !== track.id ) button.addEventListener( 'click', () => this.handlers.onTrack( t.id ) );
			tracks.appendChild( button );

		}

		// "Edit this track": the road and scenery of a custom track, the scenery
		// of a built-in one (and the road, on those without hills)
		if ( ! OFFLINE ) {

			for ( const link of document.querySelectorAll( '.editor-link' ) ) {

				link.href = 'editor.html?' + editorQuery;
				link.textContent = 'Edit this track';

			}

		}

		const grid = document.getElementById( 'car-grid' );

		CARS.forEach( ( car, i ) => {

			const button = document.createElement( 'button' );
			button.className = 'car-tile';
			button.dataset.car = car.id;
			button.innerHTML = `<span class="thumb" style="${ thumbStyle( i, 76 ) }"></span>${ car.name }<small>${ weightLabel( car ) }</small>`;
			button.addEventListener( 'click', () => {

				this.handlers.onCar( car.id );
				this.setView( 'setup' );

			} );
			grid.appendChild( button );

		} );

		// Not raceable (a dead-end custom track): time trial only
		if ( ! track.raceable ) for ( const el of this.el.querySelectorAll( '.npc-setting' ) ) el.hidden = true;

	}

	setView( view ) {

		this.view = view;
		this.el.dataset.view = view;

		if ( view === 'cars' ) {

			const active = this.el.querySelector( '.car-tile.active' );
			if ( active ) active.focus( { preventScroll: true } );
			active?.scrollIntoView( { block: 'nearest' } );

		}

	}

	setCar( id ) {

		const index = CARS.findIndex( ( c ) => c.id === id );
		const car = CARS[ index ];
		const button = document.getElementById( 'car-btn' );
		button.querySelector( '.thumb' ).setAttribute( 'style', thumbStyle( index, 72 ) );
		button.querySelector( '.car-name' ).textContent = car.name;
		button.querySelector( '.car-size' ).textContent = weightLabel( car ) + ' · ' + ( car.kit === 'starter' ? 'Starter Kit' : 'Car Kit' );

		for ( const tile of this.el.querySelectorAll( '.car-tile' ) ) tile.classList.toggle( 'active', tile.dataset.car === id );

	}

	setNpcs( count, raceable ) {

		this.npcs = count;
		this.raceable = raceable;

		for ( const stepper of this.el.querySelectorAll( '.npc-stepper' ) ) {

			stepper.querySelector( 'output' ).textContent = count;
			stepper.querySelector( '[data-step="-1"]' ).disabled = count <= 0;
			stepper.querySelector( '[data-step="1"]' ).disabled = count >= MAX_NPCS;

		}

		this.startButton.textContent = count > 0 && raceable ? 'Race' : 'Drive';

	}

	setTouch( scheme ) {

		document.body.dataset.touch = scheme;

		for ( const button of this.el.querySelectorAll( '[data-touch]' ) ) {

			button.classList.toggle( 'active', button.dataset.touch === scheme );
			button.setAttribute( 'aria-pressed', button.dataset.touch === scheme );

		}

	}

	// Waiting for opponents' models to arrive (a start meanwhile waits too)
	setBusy( busy ) {

		this.startButton.textContent = busy ? 'Getting ready…' : ( this.npcs > 0 && this.raceable ? 'Race' : 'Drive' );

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

		this.handlers.onStart();

	}

	play() {

		this.setState( 'playing' );
		this.setView( 'setup' );
		if ( document.activeElement && document.activeElement.blur ) document.activeElement.blur();

	}

	pause() {

		this.setState( 'paused' );
		document.getElementById( 'resume-btn' ).focus( { preventScroll: true } );

	}

	resume() {

		this.setState( 'playing' );

	}

	setup() {

		this.setState( 'ready' );
		this.setView( 'setup' );

	}

	// Results, refreshed while the rest of the field finishes
	showResults( race ) {

		if ( this.state !== 'finished' ) {

			this.setState( 'finished' );
			document.getElementById( 'again-btn' ).focus( { preventScroll: true } );

		}

		const standings = race.standings();
		const player = race.player;
		const position = standings.indexOf( player ) + 1;
		this.el.querySelector( '.result-title' ).textContent = position === 1 ? 'You won!' : `You finished ${ ordinal( position ) }`;

		const winner = standings[ 0 ];
		const badges = badgeCount( standings.length );
		const rows = standings.map( ( car, i ) => {

			let time;

			if ( car.finished ) time = car === winner ? formatTime( car.finishTime ) : '+' + ( car.finishTime - winner.finishTime ).toFixed( 2 );
			else time = race.phase === 'done' ? 'DNF' : 'racing…';

			const best = car.counter.bestLap !== null ? `<small>best ${ formatTime( car.counter.bestLap ) }</small>` : '';
			const pos = i < badges && car.finished ? medalSVG( i + 1 ) : i + 1;
			return `<li class="${ car === player ? 'you' : '' }${ i === 0 && car.finished ? ' winner' : '' }"><span class="pos">${ pos }</span><span>${ car === player ? 'You' : car.name }${ best }</span><span class="time">${ time }</span></li>`;

		} );

		const html = rows.join( '' );
		const list = document.getElementById( 'results' );
		if ( list.innerHTML !== html ) list.innerHTML = html;

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

		// Also fires for two thumbs on the pads; blocking the touch default
		// doesn't stop their pointer events
		if ( e.touches.length > 1 ) e.preventDefault();

	}, { passive: false } );

	document.addEventListener( 'dblclick', prevent, { passive: false } );

	// Trackpad pinch arrives as ctrl+wheel
	document.addEventListener( 'wheel', ( e ) => {

		if ( e.ctrlKey ) e.preventDefault();

	}, { passive: false } );

}
