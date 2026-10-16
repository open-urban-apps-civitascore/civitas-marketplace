'use client'

import { useCallback, useEffect, useState } from 'react'

import { listSharedPackages, type SharedPackageRow } from '@/lib/export-actions'

/**
 * The bot's shared packages for "In Arbeit", read once and kept by the panel
 * around the form: going into a use case and back does not ask GitLab again.
 * `reload` reads them anew, after something was proposed.
 */
export function useSharedListing(enabled: boolean) {
    const [rows, setRows] = useState<SharedPackageRow[] | null>(enabled ? null : [])
    const [error, setError] = useState<string>()
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        if (!enabled) return
        let cancelled = false
        listSharedPackages()
            .then((listing) => {
                if (cancelled) return
                setRows(listing.rows)
                setError(listing.error)
            })
            .catch(() => {
                if (!cancelled) setError('Die Anfrage an den Server ist fehlgeschlagen.')
            })
        return () => {
            cancelled = true
        }
    }, [enabled, attempt])

    const reload = useCallback(() => setAttempt((n) => n + 1), [])
    return { rows, error, reload }
}
