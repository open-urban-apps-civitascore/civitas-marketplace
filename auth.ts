import NextAuth from 'next-auth'
import Keycloak from 'next-auth/providers/keycloak'
import { authConfig } from './auth.config'

const KC_EXTERNAL = process.env.KEYCLOAK_ISSUER!
const KC_INTERNAL = process.env.KEYCLOAK_INTERNAL_ISSUER ?? KC_EXTERNAL

export const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,
    providers: [
        Keycloak({
            clientId: process.env.KEYCLOAK_CLIENT_ID!,
            clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
            issuer: KC_EXTERNAL,
            authorization: { url: `${KC_EXTERNAL}/protocol/openid-connect/auth` },
            token: `${KC_INTERNAL}/protocol/openid-connect/token`,
            userinfo: `${KC_INTERNAL}/protocol/openid-connect/userinfo`,
            jwks_endpoint: `${KC_INTERNAL}/protocol/openid-connect/certs`,
        }),
    ],
})