import { formatTime } from './LapTimer.js';

// In-game panel, top left. Time trial: lap, lap time, last, best (as it has
// always been). Race: position, lap of N, race time, best lap. Plus the
// start countdown in the middle of the screen.

const ORDINAL = [ 'th', 'st', 'nd', 'rd' ];

export function ordinal( n ) {

	const v = n % 100;
	return n + ( ORDINAL[ ( v - 20 ) % 10 ] || ORDINAL[ v ] || ORDINAL[ 0 ] );

}

export class Hud {

	constructor() {

		const style = document.createElement( 'style' );
		style.textContent = `
			#lap-timer {
				position: absolute;
				top: calc(12px + env(safe-area-inset-top, 0px));
				left: calc(12px + env(safe-area-inset-left, 0px));
				color: #fff;
				font: 600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
				background: rgba(0,0,0,0.5);
				padding: 10px 14px;
				border-radius: 10px;
				line-height: 1.4;
				text-shadow: 0 1px 2px rgba(0,0,0,0.6);
				user-select: none;
				pointer-events: none;
				z-index: 10;
				min-width: 140px;
				backdrop-filter: blur(8px);
				-webkit-backdrop-filter: blur(8px);
			}
			#lap-timer .row { display: flex; justify-content: space-between; gap: 12px; }
			#lap-timer .label { opacity: 0.65; font-weight: 500; letter-spacing: 0.06em; }
			#lap-timer .current { font: 700 24px/1.1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-variant-numeric: tabular-nums; margin: 4px 0 6px; }
			#lap-timer .stat { font-size: 12px; font-variant-numeric: tabular-nums; opacity: 0.9; }
			#lap-timer .position { font: 800 28px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-style: italic; }
			#lap-timer .position small { font-size: 14px; opacity: 0.7; font-style: normal; font-weight: 600; }
			#lap-timer[data-mode="timetrial"] .race-only, #lap-timer[data-mode="race"] .trial-only { display: none; }
			#countdown {
				position: absolute;
				left: 50%;
				top: 38%;
				transform: translate(-50%, -50%);
				color: #fff;
				font: italic 900 min(28vw, 160px)/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
				text-shadow: 0 6px 30px rgba(0,0,0,0.45);
				pointer-events: none;
				z-index: 12;
				opacity: 0;
			}
			#countdown.go { color: #ffc83d; }
			#countdown.show { opacity: 1; }
		`;
		document.head.appendChild( style );

		const placeholder = formatTime( null );
		const el = document.createElement( 'div' );
		el.id = 'lap-timer';
		el.dataset.mode = 'timetrial';
		el.innerHTML =
			'<div class="row race-only"><span class="position">1<small>/1</small></span></div>' +
			'<div class="row"><span class="label">LAP</span><span class="lap">1</span></div>' +
			`<div class="current">${ placeholder }</div>` +
			`<div class="row stat trial-only"><span class="label">LAST</span><span class="last">${ placeholder }</span></div>` +
			`<div class="row stat"><span class="label">BEST</span><span class="best">${ placeholder }</span></div>`;
		document.body.appendChild( el );

		const countdown = document.createElement( 'div' );
		countdown.id = 'countdown';
		document.body.appendChild( countdown );

		this.el = el;
		this.countdownEl = countdown;
		this.positionEl = el.querySelector( '.position' );
		this.lapEl = el.querySelector( '.lap' );
		this.currentEl = el.querySelector( '.current' );
		this.lastEl = el.querySelector( '.last' );
		this.bestEl = el.querySelector( '.best' );

		this.shown = {};
		this.countdownShown = null;

	}

	// Only touch the DOM when a value changes
	set( key, el, text ) {

		if ( this.shown[ key ] === text ) return;
		this.shown[ key ] = text;
		el.textContent = text;

	}

	setMode( mode ) {

		this.el.dataset.mode = mode;
		this.shown = {};

	}

	setVisible( visible ) {

		this.el.hidden = ! visible;

	}

	update( race, best ) {

		const car = race.player;
		if ( ! car ) return;

		const counter = car.counter;

		if ( race.mode === 'race' ) {

			const position = race.position( car );
			const laps = race.laps;

			if ( this.shown.position !== position + '/' + race.cars.length ) {

				this.shown.position = position + '/' + race.cars.length;
				this.positionEl.innerHTML = `${ ordinal( position ) }<small>/${ race.cars.length }</small>`;

			}

			this.set( 'lap', this.lapEl, Math.min( counter.lap, laps ) + '/' + laps );
			this.set( 'current', this.currentEl, formatTime( car.finished ? car.finishTime : race.time ) );

		} else {

			this.set( 'lap', this.lapEl, String( counter.lap ) );
			this.set( 'current', this.currentEl, formatTime( counter.currentLapTime ) );
			this.set( 'last', this.lastEl, formatTime( counter.lastLap ) );

		}

		this.set( 'best', this.bestEl, formatTime( best ) );

		// 3 · 2 · 1 · GO
		let text = '';

		if ( race.phase === 'countdown' ) text = String( Math.ceil( race.countdown ) );
		else if ( race.mode === 'race' && race.phase === 'racing' && race.time < 0.8 ) text = 'GO';

		if ( text !== this.countdownShown ) {

			this.countdownShown = text;
			this.countdownEl.textContent = text;
			this.countdownEl.classList.toggle( 'show', text !== '' );
			this.countdownEl.classList.toggle( 'go', text === 'GO' );

			if ( text ) this.countdownEl.animate( [ { transform: 'translate(-50%, -50%) scale(1.4)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 } ], { duration: 250, easing: 'ease-out' } );

		}

	}

	// Lap done: flash green for a new best, red otherwise
	flashLap( isBest ) {

		const color = isBest ? '#5af168' : '#ff6e6e';
		this.currentEl.animate( [ { color }, { color }, { color: '#fff' } ], { duration: 1200, easing: 'ease-out' } );

	}

}
