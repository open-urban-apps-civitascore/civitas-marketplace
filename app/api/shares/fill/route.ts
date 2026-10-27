import { readNewVersionFill, type NewVersionFill } from '@/lib/export/new-version-fill'
import { fetchShareRight, shareRefusal, SIGNED_OUT } from '@/lib/export/share-permission'
import { accessTokenOrUndefined, currentSession } from '@/lib/session'

/**
 * The Steckbrief of a new version, from one shared before
 * (`readNewVersionFill`): `?target=…&slug=…&version=…`. A route, not a server
 * action, as `/api/shares` is: Next runs a page's actions one at a time, so
 * reading a dataset's content would wait behind it.
 *
 * It answers a `NewVersionFill` in JSON whatever happens, never a redirect to
 * the login page: 401 without a session, 403 without the right to share, 503
 * when the portal cannot say which right the person has. Not cached: the
 * answer depends on who asks.
 */
const PRIVATE = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

const answer = (body: NewVersionFill, status = 200) => Response.json(body, { status, headers: PRIVATE })

export async function GET(request: Request) {
    if (!(await currentSession())) return answer({ status: 'forbidden', detail: SIGNED_OUT }, 401)
    const token = await accessTokenOrUndefined()
    if (!token) return answer({ status: 'forbidden', detail: SIGNED_OUT }, 401)
    const right = await fetchShareRight(token)
    if (right !== 'allowed') return answer({ status: 'forbidden', detail: shareRefusal(right) }, right === 'refused' ? 403 : 503)
    const query = new URL(request.url).searchParams
    return answer(await readNewVersionFill(query.get('target') ?? '', query.get('slug') ?? '', query.get('version') ?? ''))
}
