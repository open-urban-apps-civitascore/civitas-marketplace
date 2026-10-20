'use client'

import { RefreshCw } from 'lucide-react'

import { useShareView } from '@/components/export/share-listing-provider'
import { Button } from '@/components/ui/button'

const CLOCK = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })

/**
 * „Aktualisieren“ and „Stand von 14:32“ on each list tab (plan of
 * 2026-10-18, section 2): one place to ask GitLab again, instead of a
 * button per row. Nothing for a person who may not see what was submitted.
 */
export function ListingRefresh({ enabled }: { enabled: boolean }) {
    const view = useShareView(enabled)
    if (!enabled) return null
    return (
        <div className="flex shrink-0 items-center gap-3">
            {view.readAt && <span className="text-xs text-muted-foreground">Stand von {CLOCK.format(new Date(view.readAt))}</span>}
            <Button icon={RefreshCw} pending={view.pending} onClick={view.reload}>
                Aktualisieren
            </Button>
        </div>
    )
}
