// Public service coordinates only. No credentials or provider keys belong here.
globalThis.MXGENIUS_CONFIG = Object.freeze({
  ...(globalThis.MXGENIUS_CONFIG || {}),
  mcpBase: 'https://mxg-core.kindbush-8fee3a17.centralus.azurecontainerapps.io',
  fleetBase: 'https://mxg-fleet.kindbush-8fee3a17.centralus.azurecontainerapps.io',
  sensorCompanionPackage: 'io.mxgenius.sensorbridge',
  sensorCompanionLaunchUrl: 'mxgenius://sensor-bridge',
  sensorCompanionDownloadUrl: 'https://www.oculus.com/experiences/1280760725126205/release-channels/1516125643598287/',
  sensorCompanionVersion: '0.1.0-poc.4',
  sensorCompanionSdk: 'flir-atlas-android-2.22.0',
  sensorDiagnosticsSchemaUrl: '/schemas/edge-diagnostics-1.0.0.json',
  allowInsecurePilot: false,
  entraTenantId: 'bb1b06c5-1b43-4295-8c01-d7ffd3a5b366',
  entraClientId: '0874d536-cb48-4b1c-afb7-1349584a0366',
  entraApiScope: 'api://0874d536-cb48-4b1c-afb7-1349584a0366/access_as_user',
  entraRedirectUri: 'https://mxgenius.io/dashboard.html'
});

// Served from a developer's own machine, talk to a local backend rather than
// the deployed one. Production is never on localhost, so this is inert there.
// The local server runs with --insecure-local, which accepts an unauthenticated
// caller; that is why the pilot allowance is enabled only under the same
// condition and never in a deployed build.
if (['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location?.hostname)) {
  globalThis.MXGENIUS_CONFIG = Object.freeze({
    ...globalThis.MXGENIUS_CONFIG,
    mcpBase: globalThis.MXGENIUS_LOCAL_MCP_BASE || 'http://127.0.0.1:3030',
    allowInsecurePilot: true,
    entraRedirectUri: `${globalThis.location.origin}/dashboard.html`
  });
}
