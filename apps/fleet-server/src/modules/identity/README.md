# Identity Module

**Path:** apps/fleet-server/src/modules/identity/

## Purpose

Manages users, service identities, roles, and scoped access.

## Implemented vertical slice

- `StaticTokenIdentityProvider` authenticates bearer tokens using SHA-256 digests
  and timing-safe comparison; raw configured tokens are not retained.
- `VIEWER`, `OPERATOR`, `DISPATCHER`, `FLEET_ADMIN`, and `INTEGRATION` roles map
  to explicit API permissions.
- `x-fleet-site` is mandatory for every authenticated request and must match
  both the serving Fleet Core instance and the identity's site scope.
- `GET /api/v1/identity/me` returns the effective identity and permissions.
- Operator IDs inside request bodies are replaced with the authenticated subject,
  preventing clients from impersonating another operator in domain records.
- `FLEET_API_TOKENS` accepts a JSON array of user or service identities. Production
  startup fails closed when neither static identities nor OIDC are configured.
- `OidcIdentityProvider` validates RS256 JWT signatures against a cached JWKS,
  then enforces issuer, audience, expiry/not-before, role, and site claims.
- Production OIDC requires HTTPS issuer and JWKS URLs. Configure
  `FLEET_OIDC_ISSUER`, `FLEET_OIDC_AUDIENCE`, and `FLEET_OIDC_JWKS_URI` together.
- Sensitive settings support mutually exclusive `NAME` or `NAME_FILE` sources.
  Mounted files are recommended for `DATABASE_URL`, `FLEET_API_TOKENS`, and the
  integration webhook signing secret.

The development server provides local-only `brash-dev-viewer`,
`brash-dev-operator`, and `brash-dev-admin` tokens when `NODE_ENV` is not
`production`. They must never be used outside local development.

## Boundaries

Never store plaintext passwords, private keys, or permanent credentials in source control.
Map IdP groups to one explicit `brash_role` and a non-empty `brash_sites` array.
Key rotation is picked up when the cache expires or a previously unseen `kid`
arrives; unsupported algorithms fail closed.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
