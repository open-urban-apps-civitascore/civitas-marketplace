import type { NextAuthConfig } from 'next-auth'
import { isTokenExpired, refreshAccessToken } from '@/lib/tokenUtils'

export const authConfig = {
    session: { strategy: 'jwt', maxAge: 10 * 60 * 60 },
    pages: { signIn: '/login' },
    callbacks: {
        async jwt({ token, account }) {
            if (account) {
                // first login: move keycloak tokens in (enscrypted - via NEXT_AUTH_SECRET) session cookie
                return {
                    ...token,
                    access_token: account.access_token,
                    expires_at: account.expires_at,
                    refresh_token: account.refresh_token,
                    id_token: account.id_token,
                }
            }
            if (!isTokenExpired(token.expires_at)) return token
            return refreshAccessToken(token)
        },
        session({ session, token }) {
            return { ...session, error: token.error }
        },
    },
    events: {
        // also terminate Keycloak session (not only the local cookie)
        async signOut(message) {
            if ('token' in message && message.token?.id_token) {
                const params = new URLSearchParams({ id_token_hint: message.token.id_token as string })
                await fetch(`${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/logout?${params}`)
            }
        },
    },
    providers: [], // will be in auth.ts
} satisfies NextAuthConfig