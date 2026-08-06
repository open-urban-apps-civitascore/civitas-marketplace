import NextAuth from 'next-auth'
import Keycloak from 'next-auth/providers/keycloak'
import { authConfig } from './auth.config'

const KC_EXTERNAL = process.env.KEYCLOAK_ISSUER!
const KC_INTERNAL = process.env.KEYCLOAK_INTERNAL_ISSUER ?? KC_EXTERNAL
// Signature algorithm of the realm's id_tokens. Keycloak's out-of-the-box
// default is RS256 (local dev realm), but the cluster realm is hardened to
// ES256 (TR-03187) — without matching this, the callback rejects the token
// with 'unexpected JWT "alg" header parameter'.
const KC_ID_TOKEN_ALG = process.env.KEYCLOAK_ID_TOKEN_ALG ?? 'RS256'

export const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,
    providers: [
        Keycloak({
            clientId: process.env.KEYCLOAK_CLIENT_ID!,
            clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
            issuer: KC_EXTERNAL,
            client: { id_token_signed_response_alg: KC_ID_TOKEN_ALG },
            authorization: { url: `${KC_EXTERNAL}/protocol/openid-connect/auth` },
            token: `${KC_INTERNAL}/protocol/openid-connect/token`,
            userinfo: `${KC_INTERNAL}/protocol/openid-connect/userinfo`,
            jwks_endpoint: `${KC_INTERNAL}/protocol/openid-connect/certs`,
        }),
    ],
})