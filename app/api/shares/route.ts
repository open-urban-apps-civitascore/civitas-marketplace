import { readShareListing } from '@/lib/export/share-listing'
import { fetchShareRight, LISTING_HIDDEN_BECAUSE, SIGNED_OUT } from '@/lib/export/share-permission'
import { accessTokenOrUndefined, currentSession } from '@/lib/session'

// A route, not a server action: Next runs a page's actions one at a time, and the listing is slow.
// Only those who may share see it: shares carry the instance's name into a public repository.
const PRIVATE = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: PRIVATE })

export async function GET() {
    if (!(await currentSession())) return answer({ error: SIGNED_OUT }, 401)
    const token = await accessTokenOrUndefined()
    if (!token) return answer({ error: SIGNED_OUT }, 401)
    const right = await fetchShareRight(token)
    if (right !== 'allowed') return answer({ error: LISTING_HIDDEN_BECAUSE[right] }, right === 'refused' ? 403 : 503)
    return answer(await readShareListing())
}
