import { readNewVersionFill, type NewVersionFill } from '@/lib/export/new-version-fill'
import { fetchShareRight, shareRefusal, SIGNED_OUT } from '@/lib/export/share-permission'
import { accessTokenOrUndefined, currentSession } from '@/lib/session'

// A route, not a server action, as Next runs a page's actions one at a time.
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
