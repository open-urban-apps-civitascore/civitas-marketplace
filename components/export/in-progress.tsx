'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { BookCheck, FilePen, GitMerge, GitPullRequest, Trash2, TriangleAlert, Undo2, type LucideIcon } from 'lucide-react'

import { ProposalOutcome, useCatalogProposal } from '@/components/export/catalog-proposal'
import { DeleteShareDialog, type DeletionDone } from '@/components/export/delete-share-dialog'
import { useShareView } from '@/components/export/share-listing-provider'
import { EmptyTab } from '@/components/export/share-tab-states'
import { Button, buttonClass, ExternalAnchor } from '@/components/ui/button'
import { Panel } from '@/components/ui/layout'
import { Notice, Pending } from '@/components/ui/notice'
import { inProgressItems, type InProgressItem } from '@/lib/export/in-progress-items'
import { draftStartedOn, type ShareDraft } from '@/lib/export/share-drafts'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import { turnLabel, type ShareProgress } from '@/lib/export/share-stages'
import { resumeHref } from '@/lib/export/wizard-address'

const STAGE_ICON: Record<string, LucideIcon> = {
    review: GitPullRequest,
    catalog: GitMerge,
    listing: BookCheck,
}

/** The name a row shows: a draft by the name typed so far, a shared version with its number. */
function itemTitle(item: InProgressItem): string {
    return item.kind === 'draft' ? item.draft.basics.displayName?.trim() || item.draft.datasetName : `${item.row.displayName} ${item.row.version}`
}

/**
 * The tab „In Arbeit“ on its page (/export), fed from the share pages' one
 * listing: the rows the tab rules put here (`share-tabs.ts`, so other
 * instances' shares stay out, as in the count), and the started shares of
 * this browser. `enabled`: this person may see what was submitted; without
 * it only the started shares show. `datasetIds`: the datasets this person
 * may read here, to tell a started share whose dataset is gone; undefined
 * when they could not be read, and then every started share can go on.
 */
export function InProgressTab({ enabled, datasetIds }: { enabled: boolean; datasetIds?: string[] }) {
    const view = useShareView(enabled)
    // Until the browser was read, an empty list would only flash „Gerade ist nichts in Arbeit.“.
    if (!view.draftsReady) return null
    return (
        <InProgress
            drafts={view.drafts}
            datasetIds={datasetIds}
            rows={view.rows === null ? null : view.tabs.inProgress.map((entry) => entry.row)}
            error={view.error}
            loaded={view.loaded}
            onReload={view.reload}
            onDiscard={view.discardDraft}
        />
    )
}

/**
 * "In Arbeit": everything someone started sharing and has not finished.
 * Drafts from this browser come first and at once; the proposals follow when
 * GitLab answered. All of them, the person's own moves first - the tab is
 * the place for them, so nothing is cut off at a few rows any more.
 *
 * Every row has one action and a way out: „Verwerfen“ for what was only
 * started, „Zurückziehen“ for what was submitted, which means at each stage
 * what `share-deletion.ts` says. None is a primary button, because several
 * rows can offer one at the same time and the page's one primary is
 * „Neues Paket teilen“.
 */
export function InProgress({
    drafts,
    datasetIds,
    rows,
    error,
    loaded,
    onReload,
    onDiscard,
}: {
    drafts: ShareDraft[]
    datasetIds?: string[]
    /** The shared versions „In Arbeit“ holds; null while GitLab is asked. */
    rows: SharedPackageRow[] | null
    error?: string
    /** How many readings of them came back so far (`useSharedListing`). */
    loaded: number
    /** Reads the shared packages again, after something here changed them. */
    onReload: () => void
    onDiscard: (datasetId: string) => void
}) {
    const { proposing, propose, outcomeFor } = useCatalogProposal(onReload)
    const [deleting, setDeleting] = useState<InProgressItem | null>(null)
    const [deleted, setDeleted] = useState<DeletionDone | null>(null)
    // The row just withdrawn at GitLab, until the next reading comes back (answer or failure): no stale buttons meanwhile.
    const [settling, setSettling] = useState<{ key: string; loaded: number } | null>(null)
    // „Erneut versuchen“ was pressed at this reading: it shows as busy until the next one comes back.
    const [retriedAt, setRetriedAt] = useState<number | null>(null)
    const doneRef = useRef<HTMLDivElement>(null)

    // The row and its button may be gone: the answer is where focus goes on.
    useEffect(() => {
        if (deleted) doneRef.current?.focus()
    }, [deleted])

    // Unknown datasets count as there: a portal that did not answer is no reason to stop anyone going on.
    const available = { has: (id: string) => !datasetIds || datasetIds.includes(id) }
    const items = inProgressItems(drafts, available, rows ?? [])
    const settlingKey = settling && settling.loaded === loaded ? settling.key : undefined

    if (items.length === 0 && !deleted) {
        if (rows === null && !error) return <Pending>Stand bei GitLab wird abgefragt …</Pending>
        if (!error) return <EmptyTab tab="in-progress" />
    }

    const finish = (item: InProgressItem, done: DeletionDone) => {
        setDeleting(null)
        setDeleted(done)
        if (done.remote) {
            setSettling({ key: item.key, loaded })
            onReload()
        }
    }

    return (
        <div className="flex flex-col gap-4">
            {deleted && (
                <div ref={doneRef} tabIndex={-1} className="outline-none">
                    <Notice tone="success" live action={deleted.mrUrl ? <ExternalAnchor href={deleted.mrUrl}>In GitLab ansehen</ExternalAnchor> : undefined}>
                        {deleted.detail}
                    </Notice>
                </div>
            )}
            {items.length > 0 && (
                <Panel>
                    <ul className="flex flex-col">
                        {items.map((item) => {
                            const remove = () => {
                                setDeleted(null)
                                setDeleting(item)
                            }
                            return (
                                <li key={item.key} className="flex flex-col gap-2 border-t py-3 first:border-t-0 first:pt-0 last:pb-0">
                                    {item.kind === 'draft' ? (
                                        <DraftRow draft={item.draft} available={item.available} onDiscard={remove} />
                                    ) : (
                                        <SharedRow
                                            row={item.row}
                                            progress={item.progress}
                                            settling={item.key === settlingKey}
                                            proposing={proposing === item.row.key}
                                            disabled={proposing !== null}
                                            onPropose={() => void propose(item.row)}
                                            onWithdraw={remove}
                                        />
                                    )}
                                    {item.kind === 'shared' && outcomeFor(item.row.key) && <ProposalOutcome result={outcomeFor(item.row.key)!} />}
                                </li>
                            )
                        })}
                    </ul>
                </Panel>
            )}
            {rows === null && !error && <Pending>Stand bei GitLab wird abgefragt …</Pending>}
            {/* Started shares above still show: they live in this browser, not at GitLab. */}
            {error && (
                <Notice
                    tone="error"
                    live
                    action={
                        <Button
                            pending={retriedAt === loaded}
                            onClick={() => {
                                setRetriedAt(loaded)
                                onReload()
                            }}
                        >
                            Erneut versuchen
                        </Button>
                    }
                >
                    Was bei GitLab offen ist, ließ sich gerade nicht abfragen ({error}).
                </Notice>
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
        </div>
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

/**
 * The way out of a row, quiet and before the row's own action: offered
 * everywhere, but nowhere first. „Verwerfen“ for what lives only in this
 * browser, „Zurückziehen“ for what was submitted; both ask first.
 */
function EndButton({ kind, disabled, onClick }: { kind: 'discard' | 'withdraw'; disabled?: boolean; onClick: () => void }) {
    return (
        <Button variant="ghost" icon={kind === 'discard' ? Trash2 : Undo2} disabled={disabled} onClick={onClick}>
            {kind === 'discard' ? 'Verwerfen' : 'Zurückziehen'}
        </Button>
    )
}

function DraftRow({ draft, available, onDiscard }: { draft: ShareDraft; available: boolean; onDiscard: () => void }) {
    const title = draft.basics.displayName?.trim() || draft.datasetName
    return (
        <Row
            icon={FilePen}
            title={title}
            meta={
                // The day it was started, as „Auswählen“ names it too: the last save would give two dates for one share.
                available
                    ? `Angefangen am ${draftStartedOn(draft)} - noch nicht eingereicht · Du bist dran`
                    : `Der Datensatz „${draft.datasetName}“ ist auf dieser Instanz nicht mehr da.`
            }
        >
            <EndButton kind="discard" onClick={onDiscard} />
            {/* Into the wizard at the step it was saved at, continued rather than asked about. */}
            {available && (
                <Link href={resumeHref(draft)} className={buttonClass('secondary')}>
                    Weitermachen
                </Link>
            )}
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
    onWithdraw,
}: {
    row: SharedPackageRow
    progress: ShareProgress
    /** Just withdrawn; the list is being read again. */
    settling: boolean
    proposing: boolean
    disabled: boolean
    onPropose: () => void
    onWithdraw: () => void
}) {
    const title = (
        <>
            {row.displayName} <span className="font-normal text-muted-foreground">{row.version}</span>
        </>
    )
    if (settling) {
        return <Row icon={Undo2} title={title} meta="Der Stand wird neu abgefragt …" />
    }
    if (row.problem) {
        // No „Zurückziehen“: what it would mean depends on the stage, and the stage is what could not be read.
        return (
            <Row icon={TriangleAlert} title={title} meta={`Der Stand ließ sich nicht lesen: ${row.problem}`}>
                <ExternalAnchor href={row.bundleMr.url}>In GitLab ansehen</ExternalAnchor>
            </Row>
        )
    }
    const turn = turnLabel(progress)
    const meta = turn ? `${progress.summary} · ${turn}` : progress.summary

    // On its way out already: the removal's merge request is the one thing to look at.
    const removal = row.bundle?.removal
    if (progress.removal === 'pending' && removal) {
        return (
            <Row icon={Undo2} title={title} meta={meta}>
                <ExternalAnchor href={removal.mrUrl}>In GitLab ansehen</ExternalAnchor>
            </Row>
        )
    }

    // It would bring back what the catalogue team took out: withdrawing it is the move, in the same dialog as on every row.
    if (row.catalog?.state === 'mr-open' && row.catalog.bringsBack) {
        return (
            <Row icon={TriangleAlert} title={title} meta={meta}>
                {row.catalog.mrUrl && <ExternalAnchor href={row.catalog.mrUrl}>In GitLab ansehen</ExternalAnchor>}
                <Button icon={Undo2} disabled={disabled} onClick={onWithdraw}>
                    Zurückziehen
                </Button>
            </Row>
        )
    }

    const icon = progress.states.catalog === 'blocked' ? TriangleAlert : (STAGE_ICON[progress.active ?? ''] ?? GitPullRequest)
    let action: React.ReactNode
    if (progress.active === 'catalog' && progress.states.catalog === 'current') {
        action = (
            <Button icon={GitMerge} pending={proposing} disabled={disabled} onClick={onPropose}>
                Katalog-Eintrag vorschlagen
            </Button>
        )
    } else if (progress.active === 'review') {
        action = <ExternalAnchor href={row.bundleMr.url}>In GitLab ansehen</ExternalAnchor>
    } else if (progress.active === 'listing' && row.catalog?.mrUrl) {
        action = <ExternalAnchor href={row.catalog.mrUrl}>In GitLab ansehen</ExternalAnchor>
    } else {
        // Nothing to do here at this stage (changed after the review, no catalogue, unreadable folder): the proposal says why.
        action = <ExternalAnchor href={row.bundleMr.url}>In GitLab ansehen</ExternalAnchor>
    }
    return (
        <Row icon={icon} title={title} meta={meta}>
            <EndButton kind="withdraw" disabled={disabled} onClick={onWithdraw} />
            {action}
        </Row>
    )
}
