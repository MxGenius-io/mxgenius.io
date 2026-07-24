# Dashboard Entra gate

The dashboard is now a Microsoft Entra SPA. `dashboard.html` loads MSAL Browser,
requires an Entra account before application boot, and passes the signed identity
token through `MXGENIUS_CONFIG.getSession()` to the existing application client.

## Registered application

- Display name: `MXGenius Dashboard`
- Application ID: `0874d536-cb48-4b1c-afb7-1349584a0366`
- Tenant: `bb1b06c5-1b43-4295-8c01-d7ffd3a5b366`
- Redirects: `https://mxgenius.io/dashboard.html`, `https://www.mxgenius.io/dashboard.html`,
  `https://mxgenius.io/login.html`, and the two localhost test routes.

The public runtime file contains identifiers only. No provider credential or client
credential is stored in the repository.

## Production MCP identity

When the core is moved from pilot authentication to production OIDC, set these
server-side values on `mxg-core`:

```text
MXGENIUS_OIDC_DISCOVERY_URL=https://login.microsoftonline.com/bb1b06c5-1b43-4295-8c01-d7ffd3a5b366/v2.0/.well-known/openid-configuration
MXGENIUS_OIDC_AUDIENCE=0874d536-cb48-4b1c-afb7-1349584a0366
```

Keep `DATABASE_URL` and `MXGENIUS_CONFIRMATION_SECRET` in Container App secrets.
Membership remains server-side: the Entra issuer and subject must have a row in
`users` and an active `organization_memberships` row before MCP calls are allowed.

JetNet provider credentials remain in `mxg-fleet` and are refreshed through the
provider's Swagger flow; they are not part of the browser sign-in change.

## Smoke test

1. Open `login.html` and select **Sign in with Microsoft**.
2. Confirm the browser returns to `dashboard.html` and the dashboard initializes only
   after the account is present.
3. Confirm a signed-out dashboard request redirects back to `login.html`.
4. Confirm the fleet proxy remains the only place that handles JetNet credentials.
5. After production OIDC is enabled, confirm a member can call `/mcp` and a non-member
   receives `AUTH_REQUIRED`/membership denial.

## MFA / 2FA

The application delegates second-factor enforcement to Microsoft Entra. The SPA must
not implement or store one-time codes. The tenant currently has no Conditional Access
policy visible to this operator, and the security-defaults policy could not be read
with the current administrative token. Before the pilot is opened, an Entra admin
should enable Security Defaults or create a Conditional Access policy scoped to the
`MXGenius Dashboard` application that requires multifactor authentication. No code
change is required after that policy is enabled; MSAL follows the resulting Entra
challenge automatically.
