'use client'

import { useCallback, useEffect, useState } from 'react'

import type { ShareListing, SharedPackageRow } from '@/lib/export/share-listing'

const LISTING_URL = '/api/shares'

const UNREACHABLE = 'Die Anfrage an den Server ist fehlgeschlagen.'

type Shown = Omit<ShareListing, 'rows'> & { rows: SharedPackageRow[] | null }

/** The last good reading in this tab: a visit back to „Teilen“ shows it at once while it is read again. */
let kept: ShareListing | undefined

async function fetchListing(signal: AbortSignal, fresh: boolean): Promise<ShareListing> {
    const response = await fetch(fresh ? `${LISTING_URL}?fresh` : LISTING_URL, { cache: 'no-store', headers: { Accept: 'application/json' }, signal })
    const body = (await response.json().catch(() => null)) as Partial<ShareListing> | null
    if (!response.ok) return { rows: [], error: typeof body?.error === 'string' ? body.error : UNREACHABLE }
    if (!body || !Array.isArray(body.rows)) return { rows: [], error: UNREACHABLE }
    return body as ShareListing
}

/** A GET, not a server action, so the listing never waits in line behind the page's actions. */
export function useSharedListing(enabled: boolean) {
    const [shown, setShown] = useState<Shown>(() => kept ?? { rows: null })
    const [attempt, setAttempt] = useState(0)
    const [loaded, setLoaded] = useState(0)
    const [answered, setAnswered] = useState(-1)

    useEffect(() => {
        if (!enabled) return
        const controller = new AbortController()
        const asked = attempt
        // A reload follows „Aktualisieren“ or an action: the server's reading of the last minute would not show it.
        fetchListing(controller.signal, asked > 0)
            .then((listing) => {
                if (controller.signal.aborted) return
                const read = listing.error ? listing : { ...listing, readAt: listing.readAt ?? new Date().toISOString() }
                if (!listing.error) kept = read
                setShown((before) => {
                    // Nothing new to show: what is on screen stays, with the instance it was read for.
                    if (listing.error && !listing.rows.length && before.rows?.length) return { ...before, error: listing.error }
                    return { ...read, readAt: read.readAt ?? before.readAt }
                })
            })
            .catch(() => {
                if (controller.signal.aborted) return
                setShown((before) => ({ ...before, rows: before.rows ?? [], error: UNREACHABLE }))
            })
            .finally(() => {
                if (controller.signal.aborted) return
                setLoaded((count) => count + 1)
                setAnswered(asked)
            })
        return () => controller.abort()
    }, [enabled, attempt])

    const reload = useCallback(() => setAttempt((n) => n + 1), [])
    return { ...shown, loaded, pending: enabled && answered !== attempt, reload }
}
