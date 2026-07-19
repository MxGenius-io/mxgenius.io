// Public service coordinates only. No credentials or provider keys belong here.
globalThis.MXGENIUS_CONFIG = Object.freeze({
  ...(globalThis.MXGENIUS_CONFIG || {}),
  mcpBase: 'https://mxg-core.kindbush-8fee3a17.centralus.azurecontainerapps.io',
  allowInsecurePilot: true,
  organizationId: '00000000-0000-0000-0000-000000000000',
  getSession: () => ({
    organizationId: '00000000-0000-0000-0000-000000000000'
  })
});
