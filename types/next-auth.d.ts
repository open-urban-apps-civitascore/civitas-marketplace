import 'next-auth'
import 'next-auth/jwt'

/**
 * The Keycloak tokens the jwt callback stores in the session cookie, and the
 * refresh failure marker the session callback exposes to the app.
 */
/**
 * `RefreshTokenExpired` is terminal (Keycloak rejected the grant) and makes the
 * jwt callback drop the session; `RefreshTokenError` is inconclusive (Keycloak
 * unreachable) and keeps it so the next request can retry.
 */
declare module 'next-auth' {
    interface Session {
        error?: 'RefreshTokenError' | 'RefreshTokenExpired'
    }
}

declare module 'next-auth/jwt' {
    interface JWT {
        access_token?: string
        refresh_token?: string
        id_token?: string
        expires_at?: number
        error?: 'RefreshTokenError' | 'RefreshTokenExpired'
    }
}
