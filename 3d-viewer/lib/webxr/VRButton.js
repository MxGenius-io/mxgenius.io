class VRButton {

	static createButton( renderer, sessionInit = {} ) {

		const button = document.createElement( 'button' );
		const supportPollMs = 7500;
		const sessionOptions = {
			...sessionInit,
			optionalFeatures: [
				'local-floor',
				'bounded-floor',
				'layers',
				...( sessionInit.optionalFeatures || [] )
			]
		};
		let currentSession = null;
		let sessionRequestPending = false;
		let supportCheckPending = false;
		let supportPollId = null;

		function setState( state, title = '' ) {

			const states = {
				checking: [ 'CHECKING VR…', true ],
				ready: [ 'ENTER VR', false ],
				connecting: [ 'CONNECTING…', true ],
				active: [ 'EXIT VR', false ],
				conflict: [ 'VR SESSION ACTIVE', false ],
				unsupported: [ 'VR NOT SUPPORTED', true ],
				unavailable: [ 'VR UNAVAILABLE', true ]
			};
			const [ label, disabled ] = states[ state ];
			button.dataset.xrState = state;
			button.textContent = label;
			button.disabled = disabled;
			button.title = title;

		}

		async function detectSupport() {

			if ( supportCheckPending || sessionRequestPending || currentSession || renderer.xr.getSession() ) return;
			supportCheckPending = true;

			try {

				const supported = await navigator.xr.isSessionSupported( 'immersive-vr' );
				setState(
					supported ? 'ready' : 'unsupported',
					supported ? 'Start an immersive OpenXR session' : 'No immersive VR runtime or headset is currently available'
				);

			} catch ( error ) {

				console.warn( 'Unable to detect immersive VR support', error );
				setState( 'unavailable', error?.message || 'Unable to query WebXR support' );

			} finally {

				supportCheckPending = false;

			}

		}

		async function onSessionStarted( session ) {

			session.addEventListener( 'end', onSessionEnded, { once: true } );
			await renderer.xr.setSession( session );
			currentSession = session;
			setState( 'active', 'End the active immersive session' );

		}

		function onSessionEnded() {

			currentSession = null;
			setState( 'checking', 'Checking whether the headset remains available' );
			void detectSupport();

		}

		async function requestSession() {

			if ( sessionRequestPending ) return;

			const rendererSession = renderer.xr.getSession();
			if ( rendererSession ) {

				currentSession = rendererSession;
				await currentSession.end();
				return;

			}

			sessionRequestPending = true;
			setState( 'connecting', 'Waiting for the browser and OpenXR runtime' );

			try {

				const session = await navigator.xr.requestSession( 'immersive-vr', sessionOptions );
				await onSessionStarted( session );

			} catch ( error ) {

				console.warn( 'Unable to start immersive VR session', error );
				setState(
					error?.name === 'InvalidStateError' ? 'conflict' : 'ready',
					error?.message || 'Unable to start immersive VR'
				);

			} finally {

				sessionRequestPending = false;

			}

		}

		button.id = 'VRButton';
		button.type = 'button';
		button.style.display = '';
		button.addEventListener( 'click', requestSession );

		if ( window.isSecureContext === false ) {

			setState( 'unavailable', 'WebXR requires HTTPS' );

		} else if ( ! ( 'xr' in navigator ) ) {

			setState( 'unavailable', 'This browser does not expose the WebXR Device API' );

		} else {

			setState( 'checking', 'Checking browser headset support' );
			void detectSupport();
			supportPollId = window.setInterval( detectSupport, supportPollMs );
			document.addEventListener( 'visibilitychange', () => {

				if ( document.visibilityState === 'visible' ) void detectSupport();

			} );

			window.addEventListener( 'pagehide', () => {

				if ( supportPollId !== null ) window.clearInterval( supportPollId );

			}, { once: true } );

		}

		return button;

	}

}

export { VRButton };
