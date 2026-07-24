// Public service coordinates only. No credentials or provider keys belong here.
globalThis.MXGENIUS_CONFIG = Object.freeze({
  ...(globalThis.MXGENIUS_CONFIG || {}),
  mcpBase: 'https://mxg-core.kindbush-8fee3a17.centralus.azurecontainerapps.io',
  fleetBase: 'https://mxg-fleet.kindbush-8fee3a17.centralus.azurecontainerapps.io',
  allowInsecurePilot: false,
  entraTenantId: 'bb1b06c5-1b43-4295-8c01-d7ffd3a5b366',
  entraClientId: '0874d536-cb48-4b1c-afb7-1349584a0366',
  entraRedirectUri: 'https://mxgenius.io/dashboard.html'
});
