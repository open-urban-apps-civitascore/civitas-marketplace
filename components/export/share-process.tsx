'use client'

import { useState } from 'react'

import { useShareView } from '@/components/export/share-listing-provider'
import { Disclosure } from '@/components/ui/disclosure'
import { NumberedSteps } from '@/components/ui/numbered-steps'

/** The four steps of sharing, by the names „So geht es weiter“ and the progress line use. */
export const SHARE_PROCESS_STEPS = [
    { title: 'Datensatz wählen und Steckbrief ergänzen' },
    { title: 'Paket-Prüfung durch das Katalog-Team' },
    { title: 'Katalog-Eintrag vorschlagen' },
    { title: 'Eintrags-Prüfung, dann veröffentlicht' },
]

/**
 * Whether „So läuft Teilen ab“ opens by itself: only once it is known that
 * this instance has nothing in progress and nothing published - a first
 * visit, a demo visitor. While the browser or GitLab is still read, or when
 * GitLab could not be read, it stays folded, so it never jumps open and shut.
 * Decided from the lists, no stored setting (decision of 18.10.).
 */
export function shareProcessOpens(view: {
    enabled: boolean
    draftsReady: boolean
    rows: unknown[] | null
    error?: string
    counts: { inProgress: number; published: number }
}): boolean {
    if (!view.draftsReady) return false
    if (view.enabled && (view.rows === null || view.error)) return false
    return view.counts.inProgress === 0 && view.counts.published === 0
}

/** The block itself, open or folded; server-renderable, for the page and its tests. */
export function ShareProcessBlock({ open, onOpenChange }: { open: boolean; onOpenChange?: (open: boolean) => void }) {
    return (
        <Disclosure
            summary="So läuft Teilen ab"
            open={open}
            onOpenChange={onOpenChange}
            summaryClassName="text-sm font-medium text-foreground"
        >
            {/* The same look as the front page's „So funktioniert’s“; the titles are no headings of their own here. */}
            <NumberedSteps steps={SHARE_PROCESS_STEPS} titleAs="p" className="mt-4" />
            <div className="mt-6 flex flex-col gap-1 text-sm text-muted-foreground">
                <p>Geteilt wird der Aufbau, nie die Daten.</p>
                <p>Dein Name steht im öffentlichen Vorschlag bei GitLab.</p>
            </div>
        </Disclosure>
    )
}

/**
 * „So läuft Teilen ab“ under the tab bar (decision of 18.10.): open for
 * whoever has nothing here yet, otherwise one line that opens on click. Once
 * the person opened or folded it, that holds for the visit.
 */
export function ShareProcess({ enabled }: { enabled: boolean }) {
    const view = useShareView(enabled)
    const [chosen, setChosen] = useState<boolean>()
    const opens = shareProcessOpens({ enabled, draftsReady: view.draftsReady, rows: view.rows, error: view.error, counts: view.tabs.counts })
    return <ShareProcessBlock open={chosen ?? opens} onOpenChange={setChosen} />
}
