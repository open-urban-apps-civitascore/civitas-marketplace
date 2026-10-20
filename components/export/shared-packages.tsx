'use client'

import { ExternalLink } from 'lucide-react'

import { useShareView } from '@/components/export/share-listing-provider'
import { EmptyTab } from '@/components/export/share-tab-states'
import { InlineNotice, Notice, Pending } from '@/components/ui/notice'

import { catalogStateLabel, mergeRequestStateLabel, verificationLabel } from '@/lib/export/labels'
import { turnLabel } from '@/lib/export/share-stages'
import type { TabRow } from '@/lib/export/share-tabs'

/**
 * „Veröffentlicht“: what this instance put into the catalogue through this
 * marketplace, one row per catalogue entry at its listed version (the tab
 * rules in `share-tabs.ts`). The rows are today's; their own content - the
 * catalogue link, „Neue Version teilen“, earlier versions - comes with rc.7.
 * Read from the share pages' one listing (`useShareView`), so coming here
 * from another tab does not ask GitLab again.
 */
export function SharedPackages() {
    const view = useShareView(true)
    if (view.rows === null) return <Pending>Stand bei GitLab wird abgefragt …</Pending>
    const rows = view.tabs.published
    return (
        <div className="flex flex-col gap-4">
            {/* In the words the other two tabs use; „Aktualisieren“ above asks again. */}
            {view.error && (
                <Notice tone="error" live>
                    Was im Katalog steht, ließ sich gerade nicht abfragen ({view.error}).
                </Notice>
            )}
            {rows.length === 0 ? (
                !view.error && <EmptyTab tab="published" />
            ) : (
                <ul className="divide-y rounded-lg border bg-card">
                    {rows.map((entry) => (
                        <SharedRow key={entry.row.key} entry={entry} />
                    ))}
                </ul>
            )}
        </div>
    )
}

function SharedRow({ entry }: { entry: TabRow }) {
    const { row, progress } = entry
    const verification = row.bundle?.verification
    // The same words as "In Arbeit" and the last step of "Teilen": where it stands, and whose move it is.
    const turn = row.problem ? undefined : turnLabel(progress)

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
                    // The state names the catalogue itself ("im Katalog"), so it needs no "Katalog:" before it.
                    <Chip
                        label={upperFirst(catalogStateLabel(row.catalog.state))}
                        url={row.catalog.mrUrl}
                        tone={row.catalog.state === 'listed' ? 'ok' : undefined}
                    />
                )}
            </div>

            {/* The rest of the list is fine; only this package's state is unknown for now. */}
            {row.problem && <InlineNotice tone="error">Der Stand ließ sich nicht lesen: {row.problem}</InlineNotice>}
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
