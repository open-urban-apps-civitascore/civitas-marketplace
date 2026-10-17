'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, BookCheck, ChevronDown, ChevronUp, FilePen, GitMerge, GitPullRequest, TriangleAlert, type LucideIcon } from 'lucide-react'

import { ProposalOutcome, useCatalogProposal } from '@/components/export/catalog-proposal'
import { Button, ExternalAnchor } from '@/components/ui/button'
import { Panel } from '@/components/ui/layout'
import { InlineNotice, Pending } from '@/components/ui/notice'
import type { SharedPackageRow } from '@/lib/export-actions'
import { compactList, inProgressItems, isMine } from '@/lib/export/in-progress-items'
import { draftTime, type ShareDraft } from '@/lib/export/share-drafts'
import { turnLabel, type ShareProgress } from '@/lib/export/share-stages'
import type { ExportSource } from '@/lib/export/sources'

const STAGE_ICON: Record<string, LucideIcon> = {
    review: GitPullRequest,
    catalog: GitMerge,
    listing: BookCheck,
}

/**
 * How many rows show before "Alle anzeigen": enough for what waits on the
 * person, few enough that "Welchen Use Case möchtest du teilen?" stays in
 * sight below (Ewa, 2026-10-17).
 */
const VISIBLE = 3

const linkClass = 'inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline'

/**
 * "In Arbeit": everything someone started sharing and has not finished, at
 * the top of "Neu teilen" - the start-or-resume screen the patterns for long
 * flows recommend (GOV.UK One Login, 2026-10-16). Drafts from this browser
 * come first and at once; the merge requests follow when GitLab answered.
 * The panel around the form reads them (`useSharedListing`), so going into
 * a use case and back does not ask GitLab again.
 *
 * Only what is open (see `inProgressItems`), the person's own moves first,
 * and only the first few until "Alle anzeigen". What is in the catalogue,
 * replaced or closed stays in "Geteilte Pakete". Every row has one action.
 * None is a primary button, because several rows can offer one at the same
 * time.
 */
export function InProgress({
    drafts,
    sources,
    rows,
    error,
    onReload,
    onContinue,
    onDiscard,
}: {
    drafts: ShareDraft[]
    sources: ExportSource[]
    /** The bot's shared packages; null while GitLab is asked. */
    rows: SharedPackageRow[] | null
    error?: string
    /** Reads the shared packages again, after a proposal from here changed them. */
    onReload: () => void
    onContinue: (draft: ShareDraft) => void
    onDiscard: (datasetId: string) => void
}) {
    const { proposing, propose, outcomeFor } = useCatalogProposal(onReload)
    const [expanded, setExpanded] = useState(false)
    const listId = useId()

    const items = inProgressItems(drafts, new Set(sources.map((source) => source.id)), rows ?? [])

    // Nothing to show yet, or nothing open: no block. A list that pops in empty would only say "nothing".
    if (items.length === 0 && !error) return null
    const { shown, more, moreMine } = compactList(items, expanded, VISIBLE, isMine)

    return (
        <Panel
            title="In Arbeit"
            aside={
                <Link href="/export/shared" className={linkClass}>
                    Alle geteilten Pakete
                    <ArrowRight aria-hidden className="size-3.5" />
                </Link>
            }
        >
            {shown.length > 0 && (
                <ul id={listId} className="flex flex-col">
                    {shown.map((item) => (
                        <li key={item.key} className="flex flex-col gap-2 border-t py-3 first:border-t-0 first:pt-0">
                            {item.kind === 'draft' ? (
                                <DraftRow draft={item.draft} available={item.available} onContinue={onContinue} onDiscard={onDiscard} />
                            ) : (
                                <SharedRow
                                    row={item.row}
                                    progress={item.progress}
                                    proposing={proposing === item.row.key}
                                    disabled={proposing !== null}
                                    onPropose={() => void propose(item.row)}
                                />
                            )}
                            {item.kind === 'shared' && outcomeFor(item.row.key) && <ProposalOutcome result={outcomeFor(item.row.key)!} />}
                        </li>
                    ))}
                </ul>
            )}
            {items.length > VISIBLE && (
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)} className={linkClass}>
                        {expanded ? 'Weniger anzeigen' : `Alle ${items.length} anzeigen`}
                        {expanded ? <ChevronUp aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
                    </button>
                    {/* Own moves come first, so this only says something when more of them than fit wait below. */}
                    {!expanded && moreMine > 0 && (
                        <span className="text-xs text-muted-foreground">
                            {more === moreMine ? `bei allen ${more} weiteren bist du dran` : `bei ${moreMine} der ${more} weiteren bist du dran`}
                        </span>
                    )}
                </div>
            )}
            {rows === null && !error && <Pending>Stand bei GitLab wird abgefragt …</Pending>}
            {/* Neutral: nothing on this page can fix it, and the list page tries again. */}
            {error && (
                <InlineNotice tone="neutral">
                    Was bei GitLab offen ist, ließ sich gerade nicht abfragen ({error}).{' '}
                    <Link href="/export/shared" className="font-medium text-primary underline-offset-2 hover:underline">
                        Geteilte Pakete öffnen
                    </Link>
                </InlineNotice>
            )}
        </Panel>
    )
}

function Row({ icon: Icon, title, meta, children }: { icon: LucideIcon; title: React.ReactNode; meta: React.ReactNode; children?: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-foreground">{title}</p>
                    <p className="text-xs text-muted-foreground">{meta}</p>
                </div>
            </div>
            {children && <div className="flex shrink-0 flex-wrap items-center gap-3 pl-7 sm:pl-0">{children}</div>}
        </div>
    )
}

function DraftRow({
    draft,
    available,
    onContinue,
    onDiscard,
}: {
    draft: ShareDraft
    available: boolean
    onContinue: (draft: ShareDraft) => void
    onDiscard: (datasetId: string) => void
}) {
    const title = draft.basics.displayName?.trim() || draft.datasetName
    return (
        <Row
            icon={FilePen}
            title={title}
            meta={
                available
                    ? `Entwurf vom ${draftTime(draft.savedAt)} - noch nicht geteilt · Du bist dran`
                    : `Entwurf vom ${draftTime(draft.savedAt)} - der Datensatz „${draft.datasetName}“ ist nicht mehr verfügbar`
            }
        >
            {available ? (
                <>
                    <Button variant="ghost" className="text-xs" onClick={() => onDiscard(draft.datasetId)}>
                        Entwurf löschen
                    </Button>
                    <Button onClick={() => onContinue(draft)}>Fortsetzen</Button>
                </>
            ) : (
                <Button onClick={() => onDiscard(draft.datasetId)}>Entwurf löschen</Button>
            )}
        </Row>
    )
}

function SharedRow({
    row,
    progress,
    proposing,
    disabled,
    onPropose,
}: {
    row: SharedPackageRow
    progress: ShareProgress
    proposing: boolean
    disabled: boolean
    onPropose: () => void
}) {
    const title = (
        <>
            {row.displayName} <span className="font-normal text-muted-foreground">{row.version}</span>
        </>
    )
    if (row.problem) {
        return (
            <Row icon={TriangleAlert} title={title} meta={`Stand nicht vollständig geprüft: ${row.problem}`}>
                <Link href="/export/shared" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                    In „Geteilte Pakete“ ansehen
                </Link>
            </Row>
        )
    }
    const turn = turnLabel(progress)
    const meta = turn ? `${progress.summary} · ${turn}` : progress.summary
    const icon = progress.states.catalog === 'blocked' ? TriangleAlert : (STAGE_ICON[progress.active ?? ''] ?? GitPullRequest)

    let action: React.ReactNode
    if (progress.active === 'catalog' && progress.states.catalog === 'current') {
        action = (
            <Button icon={GitMerge} pending={proposing} disabled={disabled} onClick={onPropose}>
                In den Katalog eintragen
            </Button>
        )
    } else if (progress.active === 'review') {
        action = <ExternalAnchor href={row.bundleMr.url}>Merge Request ansehen</ExternalAnchor>
    } else if (progress.active === 'listing' && row.catalog?.mrUrl) {
        action = <ExternalAnchor href={row.catalog.mrUrl}>Merge Request ansehen</ExternalAnchor>
    } else {
        action = (
            <Link href="/export/shared" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                In „Geteilte Pakete“ ansehen
            </Link>
        )
    }
    return (
        <Row icon={icon} title={title} meta={meta}>
            {action}
        </Row>
    )
}
