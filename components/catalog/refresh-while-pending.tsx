'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const INTERVAL_MS = 5000
/** About five minutes. An operation that takes longer has stalled, and the page stops asking. */
const MAX_REFRESHES = 60

/**
 * Renders the page again from the server while an operation on the dataset
 * runs, so "Wird freigegeben" turns into "Freigegeben" without a manual
 * reload. Client state survives a refresh, the outcome text of the install
 * dialog included. Renders nothing.
 */
export function RefreshWhilePending({ pending }: { pending: boolean }) {
    const router = useRouter()

    useEffect(() => {
        if (!pending) return
        let refreshes = 0
        const timer = setInterval(() => {
            refreshes += 1
            if (refreshes > MAX_REFRESHES) {
                clearInterval(timer)
                return
            }
            router.refresh()
        }, INTERVAL_MS)
        return () => clearInterval(timer)
    }, [pending, router])

    return null
}
