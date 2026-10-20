'use client'

import { useShareView } from '@/components/export/share-listing-provider'
import { EmptyTab } from '@/components/export/share-tab-states'
import { ExternalAnchor } from '@/components/ui/button'
import { Notice, Pending } from '@/components/ui/notice'
import { endedLine, type EndedLine } from '@/lib/export/ended-lines'

/**
 * „Beendet“, a first list (plan of 2026-10-18, slice 5): one row per ended
 * proposal, and per version the catalogue team took out, newest first, with
 * what, how, when and who as far as GitLab tells. The actions („Erneut
 * einreichen“, „Neue Version teilen“) and the paging come with rc.7.
 */
export function EndedShares() {
    const view = useShareView(true)
    if (view.rows === null) return <Pending>Stand bei GitLab wird abgefragt …</Pending>
    const lines = view.tabs.ended.map((entry) => ({ key: entry.key, line: endedLine(entry) }))
    return (
        <div className="flex flex-col gap-4">
            {view.error && (
                <Notice tone="error" live>
                    Was beendet ist, ließ sich gerade nicht abfragen ({view.error}).
                </Notice>
            )}
            {lines.length === 0 ? (
                !view.error && <EmptyTab tab="ended" />
            ) : (
                <ul className="flex flex-col gap-4">
                    {lines.map(({ key, line }) => (
                        <EndedRow key={key} line={line} />
                    ))}
                </ul>
            )}
        </div>
    )
}

export function EndedRow({ line }: { line: EndedLine }) {
    return (
        <li className="flex flex-col gap-3 rounded-lg border bg-card p-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
                <p className="break-words text-sm font-semibold text-foreground">
                    {line.title} <span className="font-normal text-muted-foreground">Version {line.version}</span>
                </p>
                <p className="text-sm text-foreground">
                    {line.what ? `${line.what} · ${line.ending}` : line.ending}
                </p>
                <p className="text-xs text-muted-foreground">{line.who ? `${line.when} · ${line.who}` : line.when}</p>
                {line.reason && <p className="text-xs text-muted-foreground">Grund: {line.reason}</p>}
            </div>
            <ExternalAnchor href={line.url} className="shrink-0 text-sm">
                In GitLab ansehen
            </ExternalAnchor>
        </li>
    )
}
