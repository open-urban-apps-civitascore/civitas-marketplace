'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, BookCheck, ChevronDown, ChevronUp, FilePen, GitMerge, GitPullRequest, Trash2, TriangleAlert, type LucideIcon } from 'lucide-react'

import { ProposalOutcome, useCatalogProposal } from '@/components/export/catalog-proposal'
import { DeleteShareDialog, type DeletionDone } from '@/components/export/delete-share-dialog'
import { Button, ExternalAnchor } from '@/components/ui/button'
import { Panel } from '@/components/ui/layout'
import { InlineNotice, Notice, Pending } from '@/components/ui/notice'
import type { SharedPackageRow } from '@/lib/export-actions'
import { compactList, inProgressItems, isMine, type InProgressItem } from '@/lib/export/in-progress-items'
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

/** The name a row shows: a draft by the name typed so far, a shared version with its number. */
function itemTitle(item: InProgressItem): string {
    return item.kind === 'draft' ? item.draft.basics.displayName?.trim() || item.draft.datasetName : `${item.row.displayName} ${item.row.version}`
}

/**
 * "In Arbeit": everything someone started sharing and has not finished, at
 * the top of "Neu teilen" - the start-or-resume screen the patterns for long
 * flows recommend (GOV.UK One Login, 2026-10-16). Drafts from this browser
 * come first and at once; the merge requests follow when GitLab answered.
 * The panel around the form reads them (`useSharedListing`), so going into
 * a use case and back does not ask GitLab again.
 *
 * Only what is open (see `inProgressItems`), the person's own moves first,
 * and only the first few until "Alle anzeigen". Every row has one action and
 * "Löschen", which means at each stage what `share-deletion.ts` says. None
 * is a primary button, because several rows can offer one at the same time.
 */
export function InProgress({
    drafts,
    sources,
    rows,
    error,
    loaded,
    onReload,
    onContinue,
    onDiscard,
}: {
    drafts: ShareDraft[]
    sources: ExportSource[]
    /** The bot's shared packages; null while GitLab is asked. */
    rows: SharedPackageRow[] | null
    error?: string
    /** How many readings of them came back so far (`useSharedListing`). */
    loaded: number
    /** Reads the shared packages again, after something here changed them. */
    onReload: () => void
    onContinue: (draft: ShareDraft) => void
    onDiscard: (datasetId: string) => void
}) {
    const { proposing, propose, outcomeFor } = useCatalogProposal(onReload)
    const [expanded, setExpanded] = useState(false)
    const [deleting, setDeleting] = useState<InProgressItem | null>(null)
    const [deleted, setDeleted] = useState<DeletionDone | null>(null)
    // The row just deleted at GitLab, until the next reading comes back (answer or failure): no stale buttons meanwhile.
    const [settling, setSettling] = useState<{ key: string; loaded: number } | null>(null)
    const listId = useId()
    const doneRef = useRef<HTMLDivElement>(null)

    // The row and its button may be gone: the answer is where focus goes on.
    useEffect(() => {
        if (deleted) doneRef.current?.focus()
    }, [deleted])

    const items = inProgressItems(drafts, new Set(sources.map((source) => source.id)), rows ?? [])
    const settlingKey = settling && settling.loaded === loaded ? settling.key : undefined

    // Nothing to show yet, or nothing open: no block. A list that pops in empty would only say "nothing".
    if (items.length === 0 && !error && !deleted) return null
    const { shown, more, moreMine } = compactList(items, expanded, VISIBLE, isMine)

    const finish = (item: InProgressItem, done: DeletionDone) => {
        setDeleting(null)
        setDeleted(done)
        if (done.remote) {
            setSettling({ key: item.key, loaded })
            onReload()
        }
    }

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
            {deleted && (
                <div ref={doneRef} tabIndex={-1} className="outline-none">
                    <Notice tone="success" live action={deleted.mrUrl ? <ExternalAnchor href={deleted.mrUrl}>Merge Request öffnen</ExternalAnchor> : undefined}>
                        {deleted.detail}
                    </Notice>
                </div>
            )}
            {shown.length > 0 && (
                <ul id={listId} className="flex flex-col">
                    {shown.map((item) => {
                        const remove = () => {
                            setDeleted(null)
                            setDeleting(item)
                        }
                        return (
                            <li key={item.key} className="flex flex-col gap-2 border-t py-3 first:border-t-0 first:pt-0">
                                {item.kind === 'draft' ? (
                                    <DraftRow draft={item.draft} available={item.available} onContinue={onContinue} onDelete={remove} />
                                ) : (
                                    <SharedRow
                                        row={item.row}
                                        progress={item.progress}
                                        settling={item.key === settlingKey}
                                        proposing={proposing === item.row.key}
                                        disabled={proposing !== null}
                                        onPropose={() => void propose(item.row)}
                                        onDelete={remove}
                                    />
                                )}
                                {item.kind === 'shared' && outcomeFor(item.row.key) && <ProposalOutcome result={outcomeFor(item.row.key)!} />}
                            </li>
                        )
                    })}
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

            {deleting && (
                <DeleteShareDialog
                    item={deleting}
                    title={itemTitle(deleting)}
                    onCancel={(reload) => {
                        setDeleting(null)
                        if (reload) onReload()
                    }}
                    onDiscardDraft={onDiscard}
                    onDone={(done) => finish(deleting, done)}
                />
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

/** Quiet, and before the row's own action: deleting is offered everywhere, but nowhere first. */
function DeleteButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
    return (
        <Button variant="ghost" icon={Trash2} disabled={disabled} onClick={onClick}>
            Löschen
        </Button>
    )
}

function DraftRow({
    draft,
    available,
    onContinue,
    onDelete,
}: {
    draft: ShareDraft
    available: boolean
    onContinue: (draft: ShareDraft) => void
    onDelete: () => void
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
            <DeleteButton onClick={onDelete} />
            {available && <Button onClick={() => onContinue(draft)}>Fortsetzen</Button>}
        </Row>
    )
}

function SharedRow({
    row,
    progress,
    settling,
    proposing,
    disabled,
    onPropose,
    onDelete,
}: {
    row: SharedPackageRow
    progress: ShareProgress
    /** Just deleted; the list is being read again. */
    settling: boolean
    proposing: boolean
    disabled: boolean
    onPropose: () => void
    onDelete: () => void
}) {
    const title = (
        <>
            {row.displayName} <span className="font-normal text-muted-foreground">{row.version}</span>
        </>
    )
    if (settling) {
        return <Row icon={Trash2} title={title} meta="Der Stand wird neu abgefragt …" />
    }
    if (row.problem) {
        // No "Löschen": what it would mean depends on the stage, and the stage is what could not be read.
        return (
            <Row icon={TriangleAlert} title={title} meta={`Stand nicht vollständig geprüft: ${row.problem}`}>
                <Link href="/export/shared" className={linkClass}>
                    In „Geteilte Pakete“ ansehen
                </Link>
            </Row>
        )
    }
    const turn = turnLabel(progress)
    const meta = turn ? `${progress.summary} · ${turn}` : progress.summary

    // On its way out already: the removal's merge request is the one thing to look at.
    const removal = row.bundle?.removal
    if (progress.removal === 'pending' && removal) {
        return (
            <Row icon={Trash2} title={title} meta={meta}>
                <ExternalAnchor href={removal.mrUrl}>Merge Request ansehen</ExternalAnchor>
            </Row>
        )
    }

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
            <Link href="/export/shared" className={linkClass}>
                In „Geteilte Pakete“ ansehen
            </Link>
        )
    }
    return (
        <Row icon={icon} title={title} meta={meta}>
            <DeleteButton disabled={disabled} onClick={onDelete} />
            {action}
        </Row>
    )
}
