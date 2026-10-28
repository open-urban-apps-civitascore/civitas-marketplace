'use client'

import { useCallback, useEffect, useState } from 'react'

import type { ShareListing, SharedPackageRow } from '@/lib/export/share-listing'

const LISTING_URL = '/api/shares'

const UNREACHABLE = 'Die Anfrage an den Server ist fehlgeschlagen.'

async function fetchListing(signal: AbortSignal): Promise<ShareListing> {
    const response = await fetch(LISTING_URL, { cache: 'no-store', headers: { Accept: 'application/json' }, signal })
    const body = (await response.json().catch(() => null)) as Partial<ShareListing> | null
    if (!response.ok) return { rows: [], error: typeof body?.error === 'string' ? body.error : UNREACHABLE }
    if (!body || !Array.isArray(body.rows)) return { rows: [], error: UNREACHABLE }
    return body as ShareListing
}

/** A GET, not a server action, so the listing never waits in line behind the page's actions. */
export function useSharedListing(enabled: boolean) {
    const [rows, setRows] = useState<SharedPackageRow[] | null>(null)
    const [instance, setInstance] = useState<string>()
    const [older, setOlder] = useState<string>()
    const [error, setError] = useState<string>()
    const [readAt, setReadAt] = useState<string>()
    const [attempt, setAttempt] = useState(0)
    const [loaded, setLoaded] = useState(0)
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
                setOlder(listing.older)
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
    return { rows, instance, older, error, readAt, loaded, pending: enabled && answered !== attempt, reload }
}
