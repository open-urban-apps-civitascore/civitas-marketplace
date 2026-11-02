import type { NextRequest } from 'next/server'

import { exportConfig } from '@/lib/export/config'
import { readShareListing } from '@/lib/export/share-listing'
import { fetchShareRight, LISTING_HIDDEN_BECAUSE, SIGNED_OUT } from '@/lib/export/share-permission'
import { accessTokenOrUndefined, currentSession } from '@/lib/session'

// A route, not a server action: Next runs a page's actions one at a time, and the listing is slow.
// Only those who may share see it: shares carry the instance's name into a public repository.
const PRIVATE = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: PRIVATE })

/** One reading serves every visit for a minute; „Aktualisieren“ and the reading after an action ask `?fresh`. */
const LISTING_KEPT_MS = 60_000

export async function GET(request: NextRequest) {
    if (!(await currentSession())) return answer({ error: SIGNED_OUT }, 401)
    const token = await accessTokenOrUndefined()
    if (!token) return answer({ error: SIGNED_OUT }, 401)
    const right = await fetchShareRight(token)
    if (right !== 'allowed') return answer({ error: LISTING_HIDDEN_BECAUSE[right] }, right === 'refused' ? 403 : 503)
    const fresh = request.nextUrl.searchParams.has('fresh')
    return answer(await readShareListing(exportConfig(), { maxAgeMs: fresh ? 0 : LISTING_KEPT_MS }))
}
