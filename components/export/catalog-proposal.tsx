'use client'

import { useCallback, useState } from 'react'

import { ExternalAnchor } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { proposeSharedCatalogEntry, type ExportActionResult, type SharedPackageRow } from '@/lib/export-actions'
import { resultTone } from '@/lib/export/result-tone'

/**
 * The catalogue step from a list of shared packages, one click per merged and
 * verified package: "Geteilte Pakete" and "In Arbeit" offer it the same way,
 * so they share one implementation. `onProposed` runs after a proposal that
 * changed something (a new or an already open merge request), to read the
 * list again.
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
                if (result.status === 'ok' || result.status === 'already-open') onProposed()
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
