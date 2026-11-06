# 0015: Keycloak token verification and admin model

Status: Accepted
Date: 2026-11-06

## Context

[ADR 0013](0013-self-hosted-vps-deployment-replacing-firebase-and-cloud-tasks.md)
replaced Firebase Auth with Keycloak. Firebase gave the API a single verification
call that returned the parent UID and `auth_time`, which the API uses to require a
recent login before PIN changes and account deletion. Keycloak behaves differently,
and three properties had to be established against a running server rather than
assumed:

- A Keycloak access token carries `azp` (authorized party) but, by default, no value
  in `aud`. Audience verification therefore needs an explicit mapper.
- The access token does not contain `auth_time`; the standard session-note mapper
  did not add it. `auth_time` is an ID-token claim.
- Deleting a parent must delete their identity too, which needs an admin credential
  the API can use without holding a human administrator's password.

The alternative of trusting a client-supplied authentication time, or of using the
access token issue time, would let a refreshed token satisfy the recent-login gate
indefinitely and is not a security boundary.

## Decision

- **Audience**: each public client (`lessonbooks-site`, `lessonbooks-mobile`) has an
  Audience protocol mapper adding `lessonbooks-api` to the access token. The API
  verifies signature, RS256 algorithm, exact issuer, that audience, expiry and the
  presence of `sub` and `sid`.
- **Recent authentication**: the API resolves the SSO session start through the
  Keycloak admin API using the token's `sid`, and treats that as the authentication
  time. Session start is set by an interactive login and is unchanged by refresh, so
  it matches Firebase's `auth_time` semantics without trusting the client. Results
  are cached per session for ten minutes. If the lookup fails, the endpoint fails
  closed with `unauthenticated` rather than allowing the action.
- **Identity deletion**: a confidential `lessonbooks-api` client with a service
  account holding `view-users` and `manage-users` deletes the Keycloak user when a
  family is deleted. A 404 is treated as already deleted; any other failure aborts
  the operation.
- **Deployment shape**: the public issuer (`KEYCLOAK_ISSUER`) and the internal
  backchannel (`KEYCLOAK_BACKCHANNEL_URL`) are separate settings. Tokens are issued
  with the browser-facing issuer, while the API fetches JWKS and calls the admin API
  over the internal service URL. Neither value is ever taken from a token.
- **Registration**: the website and app send the parent to Keycloak's hosted login
  page, which also carries the registration link. A `kc_action=register` deep link is
  not used because Keycloak rejects it as an unknown action.

## Consequences

- Recent-auth endpoints make one admin API call per session per cache window instead
  of trusting a claim. This adds a dependency on Keycloak admin availability for
  those two endpoints only; ordinary requests never call it.
- The API holds a confidential client secret. It must come from injected
  configuration, never from source, and must differ per environment.
- The API service account can manage users in the realm. It must be least-privilege
  (`view-users`, `manage-users` only), and the bootstrap administrator must not be
  used by the API.
- Access tokens are short-lived (5 minutes) and refresh tokens are rotated
  (`revokeRefreshToken`), so a stolen refresh token has bounded reuse.
- Keycloak remains the system of record for parent emails and credentials, which the
  privacy record already lists as an authentication processor.

## Alternatives considered

- **Accept the ID token as the API bearer token.** It carries `auth_time`, but ID
  tokens are meant for the client and mixing them with resource-server tokens blurs
  the audience boundary.
- **Add `auth_time` with a custom protocol mapper.** The session-note mapper produced
  no claim in the access token, and a custom authenticator would add Java SPI code
  to maintain.
- **Use the access token `iat` as the authentication time.** Refreshing keeps a
  session alive indefinitely, so the gate would never trigger.
- **Let the API keep a human admin password.** Wider privilege than required and
  harder to rotate.

## Verification

- Unit tests cover issuer extraction, valid tokens, wrong issuer, wrong audience,
  expired tokens, tokens without `sid`, tokens signed by another key, unsigned and
  malformed tokens, admin token caching, user deletion (success, 404, refusal),
  session lookup and revoked sessions, plus recent-auth allow and deny paths.
- Against the running local Keycloak, an access token contained
  `aud: lessonbooks-api`, `iss: http://127.0.0.1:8081/realms/lessonbooks` and a `sid`;
  the API accepted it, and tampered and malformed tokens returned 401.
- Account deletion through the API removed the Keycloak user, confirmed through the
  admin API.
- In the browser, the website completed authorization-code + PKCE login, loaded the
  dashboard through the API, showed no console errors, and signed out through the
  Keycloak end-session endpoint.
- Remaining: VPS issuer/TLS configuration, SMTP for verification and reset, the
  invite-only decision, mobile device verification and Keycloak upgrade/backup drills.
