'use client'

import { useCallback, useEffect, useState } from 'react'

import type { ShareListing, SharedPackageRow } from '@/lib/export/share-listing'

/** Where the listing is served (app/api/shares/route.ts). */
const LISTING_URL = '/api/shares'

/** Said when the server could not be reached at all, or answered with something that is no listing. */
const UNREACHABLE = 'Die Anfrage an den Server ist fehlgeschlagen.'

/**
 * Reads the listing from the route. A refusal (401, 403, 503) comes back as
 * JSON with the reason, which is shown as the error; the rows are then empty.
 */
async function fetchListing(signal: AbortSignal): Promise<ShareListing> {
    const response = await fetch(LISTING_URL, { cache: 'no-store', headers: { Accept: 'application/json' }, signal })
    const body = (await response.json().catch(() => null)) as Partial<ShareListing> | null
    if (!response.ok) return { rows: [], error: typeof body?.error === 'string' ? body.error : UNREACHABLE }
    if (!body || !Array.isArray(body.rows)) return { rows: [], error: UNREACHABLE }
    return body as ShareListing
}

/**
 * The account's shared packages from `GET /api/shares`, read by the one
 * provider of the share pages (`share-listing-provider.tsx`), which keeps
 * them for the visit: going from tab to tab, or into the wizard and back,
 * does not ask GitLab again. A GET, not a server action, so the listing never
 * waits in line behind the page's actions, nor they behind it.
 *
 * Nothing is read while `enabled` is false; `rows` stays null until the first
 * answer, so "not read yet" is never mistaken for "nothing shared".
 * `reload` reads them anew, on „Aktualisieren“ and after something was
 * proposed or withdrawn; a reading still under way is dropped then, and one
 * asked for while disabled happens once enabled. `loaded` counts the
 * readings that came back, answer or failure, so a caller can tell "read
 * since" from "same as before"; `pending` is true while one is under way;
 * `readAt` is when the last one came back without an error. `instance` is
 * this instance as the listing names it, for the tab rules (`share-tabs.ts`).
 */
export function useSharedListing(enabled: boolean) {
    const [rows, setRows] = useState<SharedPackageRow[] | null>(null)
    const [instance, setInstance] = useState<string>()
    const [error, setError] = useState<string>()
    const [readAt, setReadAt] = useState<string>()
    const [attempt, setAttempt] = useState(0)
    const [loaded, setLoaded] = useState(0)
    // The attempt whose answer came last: one is under way while it is not the current one.
    const [answered, setAnswered] = useState(-1)

    useEffect(() => {
        if (!enabled) return
        const controller = new AbortController()
        const asked = attempt
        fetchListing(controller.signal)
            .then((listing) => {
                if (controller.signal.aborted) return
                setRows(listing.rows)
                setInstance(listing.instance)
                setError(listing.error)
                if (!listing.error) setReadAt(new Date().toISOString())
            })
            .catch(() => {
                if (controller.signal.aborted) return
                setRows((previous) => previous ?? [])
                setError(UNREACHABLE)
            })
            .finally(() => {
                if (controller.signal.aborted) return
                setLoaded((count) => count + 1)
                setAnswered(asked)
            })
        return () => controller.abort()
    }, [enabled, attempt])

    const reload = useCallback(() => setAttempt((n) => n + 1), [])
    return { rows, instance, error, readAt, loaded, pending: enabled && answered !== attempt, reload }
}
