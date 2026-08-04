# CIVITAS Marketplace

Curated marketplace for reusable Civitas Core v2 'use cases;. Next.js 16 app,  
authenticates against the platform's Keycloak and talks with the portal-backend
exclusively through the APISIX gateway (`/v1/*`).

## Prerequisites (local development)

1. CivitasCore dev environment running (`civitas-core-platform/dev-environment`,
   started via `start-portal-dev.sh`) - Keycloak :8080, APISIX :9080,
   portal-backend :8089.
2. **Keycloak client `marketplace`** must exist in the local realm `civitas-core`.
   It is defined in `dev-environment/keycloak/realm-export.json`. Note: Keycloak imports the realm file **only when the realm does not exist yet** - after changing it, either reset the Keycloak volume or create the client once manually via the admin console (localhost:8080).
3. `.env.local` - see `.env.example`.

## Run

npm run dev # http://localhost:3001 (3000 is usually taken by portal-frontend default port)

## Architecture notes

* All backend calls go through APISIX (`localhost:9080/v1/...`) with the logged-in user's bearer token - never directly to portal-backend :8089.
* Authorization (scopes) is computed by the platform's OPA; this app never sets `X-Allowed-Scope-Ids` itself.