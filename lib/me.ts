import { getAccessToken } from '@/lib/session'

/**
 * The signed-in person's `GET /v1/users/me` (open to every signed-in person),
 * or undefined when the platform cannot be asked. One read for every page that
 * decides what to offer from the person's rights (lib/permissions.ts).
 */
export async function fetchMe(token?: string): Promise<unknown | undefined> {
    // Outside the try block: a missing session redirects by throwing. A route handler hands in the token it checked itself.
    const accessToken = token ?? (await getAccessToken())
    try {
        const res = await fetch(`${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/users/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
        })
        return res.ok ? await res.json() : undefined
    } catch {
        return undefined
    }
}
