'use client'

import { useCallback, useState } from 'react'

import { ExternalAnchor } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { proposeSharedCatalogEntry, type ExportActionResult } from '@/lib/export-actions'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import { resultTone } from '@/lib/export/result-tone'
import { listingIsStale } from '@/lib/export/share-state'

/**
 * The catalogue step from the list „In Arbeit“, one click per merged and
 * verified package, with its answer kept for the row it answers.
 * `onProposed` runs after an answer that leaves the list behind
 * (`listingIsStale`), to read the list again.
 */
export function useCatalogProposal(onProposed: () => void) {
    const [proposing, setProposing] = useState<string | null>(null)
    const [outcome, setOutcome] = useState<{ key: string; result: ExportActionResult } | null>(null)

    const propose = useCallback(
        async (row: SharedPackageRow) => {
            setProposing(row.key)
            setOutcome(null)
            try {
                const result = await proposeSharedCatalogEntry(row.targetKey, row.slug, row.version)
                setOutcome({ key: row.key, result })
                if (listingIsStale(result)) onProposed()
            } catch {
                setOutcome({
                    key: row.key,
                    result: { intent: 'catalog', status: 'error', detail: 'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.' },
                })
            } finally {
                setProposing(null)
            }
        },
        [onProposed],
    )

    /** The answer for one row, if the last proposal was for it. */
    const outcomeFor = (key: string) => (outcome?.key === key ? outcome.result : undefined)
    return { proposing, propose, outcomeFor }
}

/** The answer to a catalogue proposal, inside the row it answers: smaller than a page-level notice. */
export function ProposalOutcome({ result }: { result: ExportActionResult }) {
    return (
        <Notice
            tone={resultTone(result.status)}
            live
            className="rounded-md px-3 py-2"
            action={result.mrUrl ? <ExternalAnchor href={result.mrUrl}>In GitLab ansehen</ExternalAnchor> : undefined}
        >
            {result.detail}
        </Notice>
    )
}
