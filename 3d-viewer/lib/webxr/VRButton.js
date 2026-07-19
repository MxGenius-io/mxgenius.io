class VRButton {

	static createButton( renderer ) {

		const button = document.createElement( 'button' );

		function showEnterVR() {

			let currentSession = null;
			let sessionRequestPending = false;

			async function onSessionStarted( session ) {

				session.addEventListener( 'end', onSessionEnded );
				await renderer.xr.setSession( session );
				button.textContent = 'EXIT VR';
				button.disabled = false;
				currentSession = session;

			}

			function onSessionEnded() {

				currentSession.removeEventListener( 'end', onSessionEnded );
				button.textContent = 'ENTER VR';
				button.disabled = false;
				currentSession = null;

			}

			function onSessionFailed( error ) {

				console.warn( 'Unable to start immersive VR session', error );
				button.disabled = false;
				button.textContent = error?.name === 'InvalidStateError' ? 'END ACTIVE VR SESSION' : 'ENTER VR';
				button.title = error?.message || 'Unable to start immersive VR';

			}

			button.style.display = '';
			button.style.cursor = 'pointer';
			button.style.left = 'calc(50% - 50px)';
			button.style.width = '100px';
			button.textContent = 'ENTER VR';

			const sessionInit = { optionalFeatures: [ 'local-floor', 'bounded-floor', 'hand-tracking', 'layers' ] };

			button.onmouseenter = function () {

				button.style.opacity = '1.0';

			};

			button.onmouseleave = function () {

				button.style.opacity = '0.5';

			};

			button.onclick = async function () {

				const rendererSession = renderer.xr.getSession();
				if ( rendererSession ) currentSession = rendererSession;

				if ( currentSession !== null ) {

					await currentSession.end();
					return;

				}

				if ( sessionRequestPending ) return;

				sessionRequestPending = true;
				button.disabled = true;
				button.textContent = 'CONNECTING…';

				try {

					const session = await navigator.xr.requestSession( 'immersive-vr', sessionInit );
					await onSessionStarted( session );

				} catch ( error ) {

					onSessionFailed( error );

				} finally {

					sessionRequestPending = false;

				}

			};

		}

		function disableButton() {

			button.style.display = '';
			button.style.cursor = 'auto';
			button.style.left = 'calc(50% - 75px)';
			button.style.width = '150px';
			button.onmouseenter = null;
			button.onmouseleave = null;
			button.onclick = null;

		}

		function showWebXRNotFound() {

			disableButton();
			button.textContent = 'VR NOT SUPPORTED';

		}

		function showVRNotAllowed( exception ) {

			disableButton();
			console.warn( 'Exception when trying to call xr.isSessionSupported', exception );
			button.textContent = 'VR NOT ALLOWED';

		}

		function stylizeElement( element ) {

			element.style.position = 'absolute';
			element.style.bottom = '20px';
			element.style.padding = '12px 6px';
			element.style.border = '1px solid #fff';
			element.style.borderRadius = '4px';
			element.style.background = 'rgba(0,0,0,0.1)';
			element.style.color = '#fff';
			element.style.font = 'normal 13px sans-serif';
			element.style.textAlign = 'center';
			element.style.opacity = '0.5';
			element.style.outline = 'none';
			element.style.zIndex = '999';

		}

		if ( 'xr' in navigator ) {

			button.id = 'VRButton';
			stylizeElement( button );
			button.style.display = '';
			button.textContent = 'CHECKING VR…';

			navigator.xr.isSessionSupported( 'immersive-vr' ).then( function ( supported ) {

				supported ? showEnterVR() : showWebXRNotFound();

			} ).catch( showVRNotAllowed );

			return button;

		}

		const message = document.createElement( 'a' );

		if ( window.isSecureContext === false ) {

			message.href = document.location.href.replace( /^http:/, 'https:' );
			message.innerHTML = 'WEBXR NEEDS HTTPS';

		} else {

			message.href = 'https://immersiveweb.dev/';
			message.innerHTML = 'WEBXR NOT AVAILABLE';

		}

		message.style.left = 'calc(50% - 90px)';
		message.style.width = '180px';
		message.style.textDecoration = 'none';
		stylizeElement( message );

		return message;

	}

	static registerSessionGrantedListener() {

		if ( typeof navigator !== 'undefined' && 'xr' in navigator ) {

			if ( /WebXRViewer\//i.test( navigator.userAgent ) ) return;

			navigator.xr.addEventListener( 'sessiongranted', () => {

				VRButton.xrSessionIsGranted = true;

			} );

		}

	}

}

VRButton.xrSessionIsGranted = false;
VRButton.registerSessionGrantedListener();

export { VRButton };
