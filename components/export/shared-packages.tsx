'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { ExternalLink, GitMerge, Loader2, RefreshCw } from 'lucide-react'

import {
    listSharedPackages,
    proposeSharedCatalogEntry,
    type ExportActionResult,
    type SharedPackageRow,
} from '@/lib/export-actions'
import { catalogStateLabel, mergeRequestStateLabel, verificationLabel } from '@/lib/export/labels'

const OUTCOME_STYLES: Record<ExportActionResult['status'], string> = {
    ok: 'text-success',
    'already-open': 'text-warn',
    unchanged: 'text-warn',
    'not-merged': 'text-warn',
    unconfigured: 'text-warn',
    invalid: 'text-error',
    error: 'text-error',
}

/**
 * Everything shared through this marketplace, and where each package stands.
 * The catalogue step lives here too, one click per merged and verified
 * package: it reads the merged manifest, so nobody fills in the export form
 * again days after the merge. Loaded after the page, because it asks GitLab
 * several questions per package.
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
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-xl font-semibold">Geteilte Pakete</h2>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                        Über diesen Marketplace vorgeschlagen, neueste zuerst. Ist ein Paket gemergt und
                        entspricht es auf dem Basisbranch genau dem gemergten Stand, lässt sich hier der
                        Katalog-Eintrag vorschlagen, ohne den Steckbrief erneut auszufüllen.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={load}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                    {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    Aktualisieren
                </button>
            </div>

            {error && (
                <p role="alert" className="text-sm text-error">
                    {error}
                </p>
            )}

            {rows === null ? (
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Stand wird bei GitLab abgefragt …
                </p>
            ) : rows.length === 0 ? (
                !error && <p className="text-sm text-muted-foreground">Noch nichts geteilt.</p>
            ) : (
                <ul className="divide-y rounded-lg border">
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
        </section>
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
                {canPropose && (
                    <button
                        type="button"
                        onClick={onPropose}
                        disabled={disabled}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                        {proposing ? <Loader2 className="size-4 animate-spin" /> : <GitMerge className="size-4" />}
                        Katalog-Eintrag vorschlagen
                    </button>
                )}
            </div>

            {outcome && (
                <div className={`text-xs leading-relaxed ${OUTCOME_STYLES[outcome.status]}`}>
                    <p>{outcome.detail}</p>
                    {outcome.mrUrl && (
                        <a href={outcome.mrUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 underline">
                            Merge Request öffnen
                            <ExternalLink className="size-3" />
                        </a>
                    )}
                </div>
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
