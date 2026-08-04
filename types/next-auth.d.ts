import 'next-auth'
import 'next-auth/jwt'

/**
 * The Keycloak tokens the jwt callback stores in the session cookie, and the
 * refresh failure marker the session callback exposes to the app.
 */
declare module 'next-auth' {
    interface Session {
        error?: 'RefreshTokenError'
    }
}

declare module 'next-auth/jwt' {
    interface JWT {
        access_token?: string
        refresh_token?: string
        id_token?: string
        expires_at?: number
        error?: 'RefreshTokenError'
    }
}
