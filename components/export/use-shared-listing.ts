'use client'

import { useCallback, useEffect, useState } from 'react'

import { listSharedPackages, type SharedPackageRow } from '@/lib/export-actions'

/**
 * The bot's shared packages for "In Arbeit", read once and kept by the panel
 * around the form: going into a use case and back does not ask GitLab again.
 * `reload` reads them anew, after something was proposed or deleted;
 * `loaded` counts the readings that came back, answer or failure, so a
 * caller can tell "read since" from "same as before".
 */
export function useSharedListing(enabled: boolean) {
    const [rows, setRows] = useState<SharedPackageRow[] | null>(enabled ? null : [])
    const [error, setError] = useState<string>()
    const [attempt, setAttempt] = useState(0)
    const [loaded, setLoaded] = useState(0)

    useEffect(() => {
        if (!enabled) return
        let cancelled = false
        listSharedPackages()
            .then((listing) => {
                if (cancelled) return
                setRows(listing.rows)
                setError(listing.error)
                setLoaded((count) => count + 1)
            })
            .catch(() => {
                if (cancelled) return
                setError('Die Anfrage an den Server ist fehlgeschlagen.')
                setLoaded((count) => count + 1)
            })
        return () => {
            cancelled = true
        }
    }, [enabled, attempt])

    const reload = useCallback(() => setAttempt((n) => n + 1), [])
    return { rows, error, loaded, reload }
}
