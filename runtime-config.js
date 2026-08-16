// Public service coordinates only. No credentials or provider keys belong here.
globalThis.MXGENIUS_CONFIG = Object.freeze({
  ...(globalThis.MXGENIUS_CONFIG || {}),
  mcpBase: 'https://mxg-core.kindbush-8fee3a17.centralus.azurecontainerapps.io',
  fleetBase: 'https://mxg-fleet.kindbush-8fee3a17.centralus.azurecontainerapps.io',
  sensorCompanionPackage: 'io.mxgenius.sensorbridge',
  sensorCompanionLaunchUrl: 'mxgenius://sensor-bridge',
  sensorCompanionDownloadUrl: 'https://www.oculus.com/experiences/1280760725126205/release-channels/1516125643598287/',
  sensorCompanionVersion: '0.1.0-poc.2',
  sensorCompanionSdk: 'flir-atlas-android-2.22.0',
  sensorDiagnosticsSchemaUrl: '/schemas/edge-diagnostics-1.0.0.json',
  allowInsecurePilot: false,
  entraTenantId: 'bb1b06c5-1b43-4295-8c01-d7ffd3a5b366',
  entraClientId: '0874d536-cb48-4b1c-afb7-1349584a0366',
  entraApiScope: 'api://0874d536-cb48-4b1c-afb7-1349584a0366/access_as_user',
  entraRedirectUri: 'https://mxgenius.io/dashboard.html'
});
