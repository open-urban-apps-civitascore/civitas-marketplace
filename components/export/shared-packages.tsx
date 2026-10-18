'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { ExternalLink, GitMerge, RefreshCw } from 'lucide-react'

import { ProposalOutcome, useCatalogProposal } from '@/components/export/catalog-proposal'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/layout'
import { InlineNotice, Notice, Pending } from '@/components/ui/notice'

import { listSharedPackages, type ExportActionResult, type SharedPackageRow } from '@/lib/export-actions'
import { rowProgress } from '@/lib/export/in-progress-items'
import { catalogStateLabel, mergeRequestStateLabel, verificationLabel } from '@/lib/export/labels'
import { turnLabel } from '@/lib/export/share-stages'

/**
 * Everything shared through this marketplace, and where each package stands.
 * The catalogue step lives here too, one click per merged and verified
 * package: it reads the merged manifest, so nobody fills in the export form
 * again days after the merge. Loaded after the page, because it asks GitLab
 * a few questions per package (see `listSharedPackages`). The page around it
 * (/export/shared) carries the heading.
 */
export function SharedPackages() {
    const [rows, setRows] = useState<SharedPackageRow[] | null>(null)
    const [error, setError] = useState<string>()
    const [loading, startLoading] = useTransition()

    const load = useCallback(() => {
        startLoading(async () => {
            try {
                const listing = await listSharedPackages()
                setRows(listing.rows)
                setError(listing.error)
            } catch {
                setError('Die Liste konnte nicht geladen werden. Bitte erneut versuchen.')
            }
        })
    }, [])

    useEffect(() => {
        load()
    }, [load])

    const { proposing, propose, outcomeFor } = useCatalogProposal(load)

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-end">
                <Button icon={RefreshCw} pending={loading} onClick={load}>
                    Aktualisieren
                </Button>
            </div>

            {error && (
                <Notice tone="error" live>
                    {error}
                </Notice>
            )}

            {rows === null ? (
                <Pending>Stand wird bei GitLab abgefragt …</Pending>
            ) : rows.length === 0 ? (
                !error && (
                    <EmptyState
                        action={
                            <Link href="/export" className="font-medium text-primary underline-offset-2 hover:underline">
                                Ersten Datensatz teilen
                            </Link>
                        }
                    >
                        Noch nichts geteilt.
                    </EmptyState>
                )
            ) : (
                <ul className="divide-y rounded-lg border bg-card">
                    {rows.map((row) => (
                        <SharedRow
                            key={row.key}
                            row={row}
                            proposing={proposing === row.key}
                            disabled={proposing !== null || loading}
                            outcome={outcomeFor(row.key)}
                            onPropose={() => void propose(row)}
                        />
                    ))}
                </ul>
            )}
        </div>
    )
}

function SharedRow({
    row,
    proposing,
    disabled,
    outcome,
    onPropose,
}: {
    row: SharedPackageRow
    proposing: boolean
    disabled: boolean
    outcome?: ExportActionResult
    onPropose: () => void
}) {
    const verification = row.bundle?.verification
    // The same words as "In Arbeit" and the last step of "Teilen": where it stands, and whose move it is.
    const progress = rowProgress(row)
    const turn = row.problem ? undefined : turnLabel(progress)
    // Merged, verified, not in the catalogue - and not on its way out of the repository.
    const canPropose = progress.active === 'catalog' && progress.states.catalog === 'current'

    return (
        <li className="flex flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium text-foreground">{row.displayName}</span>
                <span className="rounded bg-status-label px-1.5 py-0.5 text-xs">v{row.version}</span>
                <span className="text-xs text-muted-foreground">{row.targetLabel}</span>
            </div>
            {!row.problem && (
                <p className="text-xs text-muted-foreground">
                    {progress.summary}
                    {turn && <span className="font-medium text-foreground"> · {turn}</span>}
                </p>
            )}

            <div className="flex flex-wrap items-center gap-2 text-xs">
                <Chip label={`Paket: ${row.withdrawn ? 'zurückgezogen' : mergeRequestStateLabel(row.bundleMr.state)}`} url={row.bundleMr.url} />
                {row.bundle?.removal && <Chip label={`Entfernen: ${mergeRequestStateLabel(row.bundle.removal.state)}`} url={row.bundle.removal.mrUrl} />}
                {row.bundle && row.bundle.state !== 'on-base' && (
                    <Chip label={`Stand: ${row.bundle.detail ?? 'nicht im Ablageort'}`} />
                )}
                {verification && (
                    <Chip
                        label={`Stand: ${verificationLabel(verification)}`}
                        tone={verification.state === 'verified' ? 'ok' : 'warn'}
                    />
                )}
                {row.catalog && (
                    // The state names the catalogue itself ("noch nicht im Katalog"), so it needs no "Katalog:" before it.
                    <Chip
                        label={upperFirst(catalogStateLabel(row.catalog.state))}
                        url={row.catalog.mrUrl}
                        tone={row.catalog.state === 'listed' ? 'ok' : undefined}
                    />
                )}
                {/* Not primary: several rows can offer it at once, and a surface has one main action. */}
                {canPropose && (
                    <Button icon={GitMerge} pending={proposing} disabled={disabled} onClick={onPropose} className="ml-auto">
                        Katalog-Eintrag vorschlagen
                    </Button>
                )}
            </div>

            {/* The rest of the list is fine; only this package's state is unknown for now. */}
            {row.problem && <InlineNotice tone="error">Der Stand ließ sich nicht lesen: {row.problem}</InlineNotice>}

            {outcome && <ProposalOutcome result={outcome} />}
        </li>
    )
}

function upperFirst(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1)
}

function Chip({ label, url, tone }: { label: string; url?: string; tone?: 'ok' | 'warn' }) {
    const color =
        tone === 'ok'
            ? 'bg-success/10 text-success dark:bg-success/20'
            : tone === 'warn'
              ? 'bg-warn/10 text-warn dark:bg-warn/20'
              : 'bg-muted text-muted-foreground'
    const content = (
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${color}`}>
            {label}
            {url && <ExternalLink aria-hidden className="size-3" />}
        </span>
    )
    return url ? (
        <a href={url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
            {content}
        </a>
    ) : (
        content
    )
}
