'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { ExternalLink, GitMerge, RefreshCw } from 'lucide-react'

import { Button, ExternalAnchor } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/layout'
import { InlineNotice, Notice, Pending } from '@/components/ui/notice'

import {
    listSharedPackages,
    proposeSharedCatalogEntry,
    type ExportActionResult,
    type SharedPackageRow,
} from '@/lib/export-actions'
import { catalogStateLabel, mergeRequestStateLabel, verificationLabel } from '@/lib/export/labels'
import { resultTone } from '@/lib/export/result-tone'

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
    const [proposing, setProposing] = useState<string | null>(null)
    const [outcome, setOutcome] = useState<{ key: string; result: ExportActionResult } | null>(null)

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

    async function propose(row: SharedPackageRow) {
        setProposing(row.key)
        setOutcome(null)
        try {
            const result = await proposeSharedCatalogEntry(row.targetKey, row.slug, row.version)
            setOutcome({ key: row.key, result })
            if (result.status === 'ok' || result.status === 'already-open') load()
        } catch {
            setOutcome({
                key: row.key,
                result: { intent: 'catalog', status: 'error', detail: 'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.' },
            })
        } finally {
            setProposing(null)
        }
    }

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
                            outcome={outcome?.key === row.key ? outcome.result : undefined}
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
    const canPropose =
        row.bundle?.state === 'on-base' && verification?.state === 'verified' && row.catalog?.state === 'none'

    return (
        <li className="flex flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium text-foreground">{row.displayName}</span>
                <span className="rounded bg-status-label px-1.5 py-0.5 text-xs">v{row.version}</span>
                <span className="text-xs text-muted-foreground">{row.targetLabel}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
                <Chip label={`Paket: ${mergeRequestStateLabel(row.bundleMr.state)}`} url={row.bundleMr.url} />
                {row.bundle && row.bundle.state !== 'on-base' && (
                    <Chip label={`Prüfung: ${row.bundle.detail ?? 'nicht auf dem Basisbranch'}`} />
                )}
                {verification && (
                    <Chip
                        label={`Prüfung: ${verificationLabel(verification)}`}
                        tone={verification.state === 'verified' ? 'ok' : 'warn'}
                    />
                )}
                {row.catalog && (
                    <Chip
                        label={`Katalog: ${catalogStateLabel(row.catalog.state)}`}
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
            {row.problem && <InlineNotice tone="error">Stand nicht vollständig geprüft: {row.problem}</InlineNotice>}

            {/* Smaller than a page-level notice: it answers one row, inside that row. */}
            {outcome && (
                <Notice
                    tone={resultTone(outcome.status)}
                    live
                    className="rounded-md px-3 py-2"
                    action={outcome.mrUrl ? <ExternalAnchor href={outcome.mrUrl}>Merge Request öffnen</ExternalAnchor> : undefined}
                >
                    {outcome.detail}
                </Notice>
            )}
        </li>
    )
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
