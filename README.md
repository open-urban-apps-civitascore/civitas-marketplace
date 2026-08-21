# CIVITAS Marketplace

Curated marketplace for reusable Civitas Core v2 use cases. Next.js 16 app,
authenticates against the platform's Keycloak and talks with the portal-backend
exclusively through the APISIX gateway (`/v1/*`).

## Prerequisites (local development)

1. CivitasCore dev environment running (`civitas-core-platform/dev-environment`,
   started via `start-portal-dev.sh`) - Keycloak :8080, APISIX :9080,
   portal-backend :8089.
2. **Keycloak client `marketplace`** must exist in the local realm `civitas-core`.
   Its definition is versioned here: [`docs/keycloak/marketplace-client.local.json`](docs/keycloak/marketplace-client.local.json).
   Add it to the `clients` array of `dev-environment/keycloak/realm-export.json`,
   or import it once via the admin console. Note: Keycloak imports the realm file
   **only when the realm does not exist yet** - after changing it, either reset the
   Keycloak volume or create the client manually (localhost:8080, switch the realm
   to `civitas-core` first, then Clients -> Import client).
   The secret in that file is a dev placeholder and matches `.env.example`; cluster
   deployments generate their own secret per environment.
3. **A user that actually has permissions.** Roles reach users only through groups,
   and the resulting assignments live in the portal-backend database - a user
   created in Keycloak alone can sign in but may see nothing. Simplest path: use an
   existing portal user. For a dedicated one, create it through the portal's user
   management (not directly in Keycloak) and give it Tenant Admin + Data Architect.
4. `.env.local` - see `.env.example`.

## Run

```bash
npm run dev # http://localhost:3001 (3000 is usually taken by portal-frontend default port)
```

## Architecture notes

```
browser ──▶ marketplace ──▶ APISIX :9080 ──▶ portal-backend :8089
           (session cookie)  (bearer token)   (scope-filtered data)
                                  │
                                  └──▶ OPA (computes X-Allowed-Scope-Ids)
```

* All backend calls go through APISIX (`localhost:9080/v1/...`) with the logged-in user's bearer token - never directly to portal-backend :8089. Collection endpoints reject requests without `X-Allowed-Scope-Ids`, and only APISIX may set it (the gateway strips any copy a client sends). Bypassing the gateway means either 403s or forged headers.
* Authorization (scopes) is computed by the platform's OPA; this app never sets `X-Allowed-Scope-Ids` itself.
* The signed-in user's own token is what travels - there is no service account. OPA therefore scopes every request to that user, and the backend attributes changes to them.
* The access token never reaches the browser: it stays in the encrypted session cookie and is unwrapped server-side in `lib/session.ts`.

## Project layout

| Path | Purpose |
|---|---|
| `auth.ts` / `auth.config.ts` | NextAuth setup: Keycloak provider, session-cookie callbacks, federated sign-out |
| `lib/session.ts` | `requireSession()` guard and `getAccessToken()` for server-side backend calls |
| `lib/tokenUtils.ts` | Access-token refresh against Keycloak |
| `lib/addon-catalog/` | The add-on catalogue: remote source + cache (`source.ts`), entry normalisation and installability (`listing.ts`), the one bundled example add-on |
| `lib/deployment-repo/` | Composing an add-on install as a deployment-repo change and opening it as a pull request |
| `app/(authenticated)/` | Route group for signed-in pages: shared shell plus sign-out |
| `app/login/` | Sign-in page, deliberately outside that group |

## The add-on catalogue

Add-ons are read from our curated catalogue repository
([`civitas-addon-catalog`](https://github.com/open-urban-apps-civitascore/civitas-addon-catalog),
via `ADDON_CATALOG_URL`). A pull request there is the submission, review is the
curation, and the raw `index.json` is the API - publishing an add-on needs
nothing else. The result is cached for a few minutes and kept as
last-known-good, so a temporarily unreachable catalogue degrades to visibly
stale data rather than an empty page. With no URL configured, only the bundled
example is shown and the page says so.

The catalogue holds **metadata only**. Each entry points at the add-on's own
repository at an immutable ref - a tag or a commit, never a branch, because a
branch would make two installs of "the same" listed version differ. Nothing of
the add-on's deployment code is mirrored anywhere.

**Listing and installability are separate questions.** An entry can be listed
without saying how it installs; such an entry is shown in full and its detail
page names precisely what is missing rather than hiding it. Only an entry that
carries a component name, a subdomain and a pinned version offers
"Installation vorschlagen".

### What happens on "Installation vorschlagen"

1. The deployment package is fetched from the add-on's own repository at the
   pinned ref (`lib/addon-catalog/package-source.ts`), with file-count and size
   guards. The marketplace keeps no copy, so the bytes in the pull request are
   the maintainer's bytes at that version.
2. The change is composed: the package lands under
   `deployment/addons/<componentName>/`, and one line registers the component
   in the environment's `components:` list. Helmfile prefers an add-on folder
   over the built-in `components/<name>/`, which is why a component name that
   collides with a core component is rejected in the catalogue's CI.
3. A pull request is opened against the deployment repository, naming the
   requester and the package's provenance. Nothing merges - that stays with the
   operator.

### Where auth checks belong

Every protected page calls `requireSession()` itself. The `(authenticated)` layout
also checks, but only so the shell is not rendered for signed-out visitors - it
cannot be the guard, because layouts are cached client-side and do not re-render
when navigating between pages that share them (see the Next.js authentication
guide, "Layouts and auth checks").
