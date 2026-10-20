import { readShareListing } from '@/lib/export/share-listing'
import { fetchShareRight, LISTING_HIDDEN_BECAUSE } from '@/lib/export/share-permission'
import { accessTokenOrUndefined, currentSession } from '@/lib/session'

/**
 * What this marketplace's GitLab account has shared, for the share pages:
 * `readShareListing` as JSON (plan of 2026-10-18, section 10). A route, not
 * a server action: Next runs a page's actions one at a time, so a listing
 * that takes seconds would make reading a dataset's content, proposing an
 * entry or withdrawing wait behind it. Server actions stay for the writes.
 *
 * It answers in JSON whatever happens, never with a redirect to the login
 * page, which a fetch would follow and then fail to read: 401 without a
 * session, 403 without the right to share (submitted shares carry the
 * instance's name into a public repository, so only those who may submit see
 * them), 503 when the portal cannot say which right the person has.
 *
 * Kept by no browser and no proxy: the answer depends on who asks and moves
 * with every proposal.
 */
const PRIVATE = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: PRIVATE })

const SIGNED_OUT = 'Deine Anmeldung ist abgelaufen - bitte lade die Seite neu und melde dich wieder an.'

export async function GET() {
    if (!(await currentSession())) return answer({ error: SIGNED_OUT }, 401)
    const token = await accessTokenOrUndefined()
    if (!token) return answer({ error: SIGNED_OUT }, 401)
    const right = await fetchShareRight(token)
    if (right !== 'allowed') return answer({ error: LISTING_HIDDEN_BECAUSE[right] }, right === 'refused' ? 403 : 503)
    return answer(await readShareListing())
}
