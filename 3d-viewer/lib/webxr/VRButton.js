class VRButton {

	static createButton( renderer, sessionInit = {}, button = document.createElement( 'button' ) ) {

		let currentSession = null;

		function setUnavailable( label, title ) {

			button.disabled = true;
			button.textContent = label;
			button.title = title;
			button.dataset.xrSupported = 'false';

		}

		function emit( type, detail = {} ) {

			button.dispatchEvent( new CustomEvent( type, { detail } ) );

		}

		async function onSessionStarted( session ) {

			session.addEventListener( 'end', onSessionEnded, { once: true } );
			await renderer.xr.setSession( session );
			currentSession = session;
			emit( 'webxr-session-started', { session } );

		}

		function onSessionEnded() {

			currentSession = null;
			emit( 'webxr-session-ended' );

		}

		button.addEventListener( 'click', async function () {

			if ( currentSession !== null ) {

				await currentSession.end();
				return;

			}

			try {

				const session = await navigator.xr.requestSession( 'immersive-vr', sessionInit );
				await onSessionStarted( session );

			} catch ( error ) {

				emit( 'webxr-error', { error } );

			}

		} );

		if ( 'xr' in navigator ) {

			navigator.xr.isSessionSupported( 'immersive-vr' ).then( function ( supported ) {

				button.dataset.xrSupported = String( supported );
				emit( 'webxr-support', { supported } );

				if ( ! supported ) {

					setUnavailable( 'VR unavailable', 'No compatible immersive VR runtime or headset was detected' );

				}

			} ).catch( function ( error ) {

				setUnavailable( 'VR unavailable', error?.message || 'Unable to check WebXR device support' );
				emit( 'webxr-error', { error } );

			} );

		} else if ( window.isSecureContext === false ) {

			setUnavailable( 'VR requires HTTPS', 'WebXR device access is available only in a secure context' );

		} else {

			setUnavailable( 'VR unavailable', 'This browser does not expose the WebXR Device API' );

		}

		return button;

	}

}

export { VRButton };
