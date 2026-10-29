// Keyboard, gamepad and touch input. update() returns one input object:
//   { x, z, mode, pause, reset, anyButton }
// mode 'car': x steers (−1 left … 1 right), z is throttle/brake (keyboard,
// gamepad, touch pads). mode 'world': (x, z) is a world-space direction to
// drive in, its length the speed (touch joystick).
//
// Touch has two schemes (Settings.touch):
//   joystick: a fixed base low in the middle of the screen. Drag from its
//             centre toward where to go; drag further to go faster.
//   pads:     a left pad you slide sideways to steer and a right pad you
//             slide up to accelerate, down to brake and reverse.

const JOY_RANGE = 60; // px from the joystick's centre to full speed
const JOY_DEAD = 0.15;
const PAD_RANGE = 50; // px from a pad's centre to full deflection
const PAD_DEAD = 0.08;

export class Controls {

	constructor( scheme = 'joystick' ) {

		this.keys = {};
		this.scheme = scheme;

		// Touch state per role: 'joy', 'steer', 'throttle'
		this.touches = {};
		this.cancelTouches = () => {};
		this.hasTouch = false;

		// Gamepad / key edge state (Start pauses, any button dismisses the
		// start screen, R resets the car)
		this.prevStart = false;
		this.prevAnyButton = false;
		this.prevReset = false;

		this.input = { x: 0, z: 0, mode: 'car', pause: false, reset: false, anyButton: false };

		window.addEventListener( 'keydown', ( e ) => this.keys[ e.code ] = true );
		window.addEventListener( 'keyup', ( e ) => this.keys[ e.code ] = false );

		// A keyup that lands while the window is unfocused never arrives, which
		// would leave the truck driving on its own after alt-tab
		window.addEventListener( 'blur', () => this.reset() );

		this.setupTouchUI();

	}

	setScheme( scheme ) {

		this.cancelTouches();
		this.scheme = scheme;
		if ( this.ui ) this.ui.dataset.scheme = scheme;

	}

	setupTouchUI() {

		if ( ! ( 'ontouchstart' in window ) ) return;

		this.hasTouch = true;

		const css = document.createElement( 'style' );
		css.textContent = `
			.touch-controls { position: absolute; inset: 0; pointer-events: none; z-index: 10; display: none; }
			body[data-state="playing"] .touch-controls { display: block; }
			.touch-zone { position: absolute; inset: 0; pointer-events: auto; touch-action: none; }
			.touch-controls[data-scheme="pads"] .joy, .touch-controls[data-scheme="joystick"] .pad { display: none; }
			.joy-base { position: absolute; width: 140px; height: 140px; margin: -70px 0 0 -70px; border-radius: 50%; background: rgba(255,255,255,0.1); border: 2px solid rgba(255,255,255,0.28); box-sizing: border-box; }
			.joy-base::after { content: ''; position: absolute; inset: 44px; border-radius: 50%; border: 1px dashed rgba(255,255,255,0.25); }
			.knob { position: absolute; top: 50%; left: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%; background: rgba(255,255,255,0.4); box-shadow: 0 2px 8px rgba(0,0,0,0.25); }
			.pad-track { position: absolute; border-radius: 999px; background: rgba(255,255,255,0.1); border: 2px solid rgba(255,255,255,0.28); box-sizing: border-box; }
			.pad-steer { width: 156px; height: 64px; margin: -32px 0 0 -78px; }
			.pad-throttle { width: 64px; height: 156px; margin: -78px 0 0 -32px; }
			.pad-track span { position: absolute; color: rgba(255,255,255,0.6); font: 700 14px sans-serif; }
			.pad-steer span:first-of-type { left: 12px; top: 50%; transform: translateY(-50%); }
			.pad-steer span:last-of-type { right: 12px; top: 50%; transform: translateY(-50%); }
			.pad-throttle span:first-of-type { top: 8px; left: 50%; transform: translateX(-50%); }
			.pad-throttle span:last-of-type { bottom: 8px; left: 50%; transform: translateX(-50%); }
		`;
		document.head.appendChild( css );

		const ui = document.createElement( 'div' );
		ui.className = 'touch-controls';
		ui.dataset.scheme = this.scheme;
		ui.innerHTML = `
			<div class="touch-zone"></div>
			<div class="joy joy-base"><div class="knob"></div></div>
			<div class="pad pad-track pad-steer"><span>◀</span><div class="knob"></div><span>▶</span></div>
			<div class="pad pad-track pad-throttle"><span>▲</span><div class="knob"></div><span>▼</span></div>
		`;
		document.body.appendChild( ui );
		this.ui = ui;

		const zone = ui.querySelector( '.touch-zone' );
		const joy = ui.querySelector( '.joy-base' );
		const steerPad = ui.querySelector( '.pad-steer' );
		const throttlePad = ui.querySelector( '.pad-throttle' );
		const knobs = { joy: joy.firstElementChild, steer: steerPad.querySelector( '.knob' ), throttle: throttlePad.querySelector( '.knob' ) };

		// Fixed positions, kept clear of the safe-area insets
		const centres = { joy: [ 0, 0 ], steer: [ 0, 0 ], throttle: [ 0, 0 ] };
		const insets = document.createElement( 'div' );
		insets.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;left:env(safe-area-inset-left,0px);right:env(safe-area-inset-right,0px);bottom:env(safe-area-inset-bottom,0px);';
		document.body.appendChild( insets );

		const layout = () => {

			const w = window.innerWidth, h = window.innerHeight;
			const left = parseFloat( getComputedStyle( insets ).left ) || 0;
			const right = parseFloat( getComputedStyle( insets ).right ) || 0;
			const bottom = parseFloat( getComputedStyle( insets ).bottom ) || 0;
			const portrait = h > w;

			centres.joy = [ w / 2, Math.min( h * ( portrait ? 0.78 : 0.72 ), h - bottom - 90 ) ];
			centres.steer = [ left + 30 + 78, h - bottom - 40 - 32 ];
			centres.throttle = [ w - right - 30 - 32, h - bottom - 40 - 78 ];

			joy.style.left = centres.joy[ 0 ] + 'px';
			joy.style.top = centres.joy[ 1 ] + 'px';
			steerPad.style.left = centres.steer[ 0 ] + 'px';
			steerPad.style.top = centres.steer[ 1 ] + 'px';
			throttlePad.style.left = centres.throttle[ 0 ] + 'px';
			throttlePad.style.top = centres.throttle[ 1 ] + 'px';

		};

		layout();
		window.addEventListener( 'resize', layout );

		const clamp = ( v ) => Math.max( - 1, Math.min( 1, v ) );

		const move = ( role, clientX, clientY ) => {

			const touch = this.touches[ role ];
			const [ cx, cy ] = centres[ role ];

			if ( role === 'joy' ) {

				let dx = ( clientX - cx ) / JOY_RANGE, dy = ( clientY - cy ) / JOY_RANGE;
				const mag = Math.hypot( dx, dy );

				if ( mag > 1 ) {

					dx /= mag;
					dy /= mag;

				}

				touch.x = dx;
				touch.y = dy;
				knobs.joy.style.transform = `translate(${ dx * JOY_RANGE }px, ${ dy * JOY_RANGE }px)`;

			} else if ( role === 'steer' ) {

				touch.x = clamp( ( clientX - cx ) / PAD_RANGE );
				knobs.steer.style.transform = `translateX(${ touch.x * PAD_RANGE }px)`;

			} else {

				touch.y = clamp( ( clientY - cy ) / PAD_RANGE );
				knobs.throttle.style.transform = `translateY(${ touch.y * PAD_RANGE }px)`;

			}

		};

		zone.addEventListener( 'pointerdown', ( e ) => {

			const role = this.scheme === 'joystick' ? 'joy' : e.clientX < window.innerWidth / 2 ? 'steer' : 'throttle';
			if ( this.touches[ role ] ) return;

			zone.setPointerCapture( e.pointerId );
			this.touches[ role ] = { id: e.pointerId, x: 0, y: 0 };
			move( role, e.clientX, e.clientY );

		} );

		const roleOf = ( e ) => Object.keys( this.touches ).find( ( r ) => this.touches[ r ] && this.touches[ r ].id === e.pointerId );

		zone.addEventListener( 'pointermove', ( e ) => {

			const role = roleOf( e );
			if ( role ) move( role, e.clientX, e.clientY );

		} );

		const end = ( e ) => {

			const role = roleOf( e );
			if ( ! role ) return;

			this.touches[ role ] = null;
			knobs[ role ].style.transform = '';

		};

		zone.addEventListener( 'pointerup', end );
		zone.addEventListener( 'pointercancel', end );

		this.cancelTouches = () => {

			for ( const role of Object.keys( this.touches ) ) {

				const touch = this.touches[ role ];
				if ( ! touch ) continue;
				if ( zone.hasPointerCapture( touch.id ) ) zone.releasePointerCapture( touch.id );
				end( { pointerId: touch.id } );

			}

		};

		// The touch origins are in screen space and meaningless after rotation
		window.addEventListener( 'orientationchange', () => {

			this.cancelTouches();
			layout();

		} );

	}

	reset() {

		this.keys = {};
		this.cancelTouches();

	}

	// A short buzz for the kerbs: gamepad rumble where the browser has it,
	// the phone's vibration on touch (Android; iOS has no vibration API).
	// strength 0–1, called every frame; it paces itself.
	buzz( strength, now ) {

		if ( strength <= 0.05 || now - ( this.lastBuzz || 0 ) < 0.12 ) return;
		this.lastBuzz = now;

		const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

		for ( const gp of gamepads ) {

			if ( gp && gp.vibrationActuator && gp.vibrationActuator.playEffect ) gp.vibrationActuator.playEffect( 'dual-rumble', { duration: 90, weakMagnitude: 0.6 * strength, strongMagnitude: 0.25 * strength } ).catch( () => {} );

		}

		if ( Object.keys( this.touches ).length && navigator.vibrate ) navigator.vibrate( Math.round( 10 + 15 * strength ) );

	}

	update() {

		let x = 0, z = 0, mode = 'car';
		let start = false, anyButton = false;

		// Keyboard

		if ( this.keys[ 'KeyA' ] || this.keys[ 'ArrowLeft' ] ) x -= 1;
		if ( this.keys[ 'KeyD' ] || this.keys[ 'ArrowRight' ] ) x += 1;
		if ( this.keys[ 'KeyW' ] || this.keys[ 'ArrowUp' ] ) z += 1;
		if ( this.keys[ 'KeyS' ] || this.keys[ 'ArrowDown' ] ) z -= 1;

		// Gamepad

		const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

		for ( const gp of gamepads ) {

			if ( ! gp ) continue;

			const stickX = gp.axes[ 0 ];
			if ( Math.abs( stickX ) > 0.15 ) x = stickX;

			const rt = gp.buttons[ 7 ] ? gp.buttons[ 7 ].value : 0;
			const lt = gp.buttons[ 6 ] ? gp.buttons[ 6 ].value : 0;

			if ( rt > 0.1 || lt > 0.1 ) z = rt - lt;

			start = gp.buttons[ 9 ] ? gp.buttons[ 9 ].pressed : false;
			anyButton = gp.buttons.some( ( b ) => b.pressed );

			break;

		}

		// Touch

		const joy = this.touches.joy, steer = this.touches.steer, throttle = this.touches.throttle;

		if ( joy ) {

			// Screen drag → world direction through the 45° camera azimuth;
			// drag length past the dead zone → speed
			const mag = Math.hypot( joy.x, joy.y );
			mode = 'world';
			x = z = 0;

			if ( mag > JOY_DEAD ) {

				const speed = Math.min( 1, ( mag - JOY_DEAD ) / ( 1 - JOY_DEAD ) );
				x = ( joy.x + joy.y ) * Math.SQRT1_2 / mag * speed;
				z = ( - joy.x + joy.y ) * Math.SQRT1_2 / mag * speed;

			}

		}

		if ( steer && Math.abs( steer.x ) > PAD_DEAD ) x = steer.x;
		if ( throttle && Math.abs( throttle.y ) > PAD_DEAD ) z = - throttle.y;

		const resetKey = Boolean( this.keys[ 'KeyR' ] );

		const input = this.input;
		input.x = x;
		input.z = z;
		input.mode = mode;
		input.pause = start && ! this.prevStart;
		input.anyButton = anyButton && ! this.prevAnyButton;
		input.reset = resetKey && ! this.prevReset;

		this.prevStart = start;
		this.prevAnyButton = anyButton;
		this.prevReset = resetKey;

		return input;

	}

}
