import type { ReactNode } from 'react'

import { ListingRefresh } from '@/components/export/listing-refresh'
import { TAB_LEADS, TAB_TITLES } from '@/components/export/share-tab-states'
import { Notice } from '@/components/ui/notice'
import type { ExportReadiness } from '@/lib/export/config'
import { LISTING_HIDDEN_BECAUSE, type ShareRight } from '@/lib/export/share-permission'
import type { ShareTab } from '@/lib/export/share-tabs'

/*
 * The frame of each tab's page, and why its list stays hidden: for the
 * server pages only, because the right to share is read on the server.
 */

/**
 * Why what was submitted is not listed for this person, or nothing when it
 * is. Neutral: setting sharing up is the operator's task, and a right is
 * nothing the person can supply here. „In Arbeit“ still lists the started
 * shares of this browser below it, the other tabs nothing.
 */
export function ShareListAccess({ tab, readiness, right }: { tab: ShareTab; readiness: ExportReadiness; right?: ShareRight }) {
    if (readiness !== 'ready') {
        return (
            <Notice tone="neutral" title="Teilen ist auf dieser Instanz noch nicht eingerichtet">
                {tab === 'in-progress'
                    ? 'Einreichen geht erst, wenn der Betrieb einen Ablageort und einen GitLab-Zugang eingerichtet hat. Was du in diesem Browser angefangen hast, steht trotzdem hier.'
                    : 'Deshalb gibt es hier noch nichts zu sehen. Das Einrichten übernimmt der Betrieb.'}
            </Notice>
        )
    }
    if (right === 'allowed') return null
    return <Notice tone="neutral">{LISTING_HIDDEN_BECAUSE[right ?? 'unknown']}</Notice>
}

/**
 * One tab's page under the tab bar: a heading for screen readers (the bar
 * names the tab for everyone else), the lead, „Aktualisieren“, the content.
 */
export function ShareTabFrame({ tab, enabled, children }: { tab: ShareTab; enabled: boolean; children: ReactNode }) {
    return (
        <section aria-labelledby={`teilen-${tab}`} className="flex flex-col gap-4">
            <h2 id={`teilen-${tab}`} className="sr-only">
                {TAB_TITLES[tab]}
            </h2>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-3xl text-sm text-muted-foreground">{TAB_LEADS[tab]}</p>
                <ListingRefresh enabled={enabled} />
            </div>
            {children}
        </section>
    )
}
