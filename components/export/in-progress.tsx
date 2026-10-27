'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import Link from 'next/link'
import { GitMerge, PackagePlus, Trash2, Undo2 } from 'lucide-react'

import { ProposalOutcome, useCatalogProposal } from '@/components/export/catalog-proposal'
import { DeleteShareDialog, type DeletionDone } from '@/components/export/delete-share-dialog'
import { useShareView } from '@/components/export/share-listing-provider'
import { ShareRow, StatusLine } from '@/components/export/share-row'
import { EmptyTab } from '@/components/export/share-tab-states'
import { Button, buttonClass, ExternalAnchor } from '@/components/ui/button'
import { Notice, Pending } from '@/components/ui/notice'
import {
    ACTION_LABELS,
    GROUP_LEADS,
    GROUP_TITLES,
    inProgressItems,
    keptPlaces,
    placesOf,
    rowAnchor,
    rowView,
    shownGroups,
    withPlace,
    type DatasetsHere,
    type GroupsKnown,
    type InProgressGroup,
    type InProgressItem,
    type Placed,
    type RowAction,
} from '@/lib/export/in-progress-items'
import type { ShareDraft } from '@/lib/export/share-drafts'
import type { TabRow } from '@/lib/export/share-tabs'

/** The name a dialog uses: a started share by the name typed so far, a shared version with its number. */
function itemTitle(item: InProgressItem): string {
    return item.kind === 'draft' ? item.draft.basics.displayName?.trim() || item.draft.datasetName : `${item.row.displayName} ${item.row.version}`
}

/** Datasets that could not be read count as there: a portal that did not answer is no reason to stop anyone going on. */
const ANY_DATASET: DatasetsHere = { has: () => true }

/** „2 weitere Einträge stammen von anderen Instanzen.“ */
export function elsewhereLine(count: number): string {
    return count === 1 ? '1 weiterer Eintrag stammt von einer anderen Instanz.' : `${count} weitere Einträge stammen von anderen Instanzen.`
}

/**
 * The tab „In Arbeit“ on its page (/export), fed from the share pages' one
 * listing: the rows the tab rules put here (`share-tabs.ts`, so other
 * instances' shares stay out and are only counted), and the started shares
 * of this browser. `enabled`: this person may see what was submitted;
 * without it only the started shares show. `datasets`: the datasets this
 * person may read here, to tell a started share whose dataset is gone and to
 * name where a share came from; undefined when they could not be read.
 */
export function InProgressTab({ enabled, datasets }: { enabled: boolean; datasets?: { id: string; name: string }[] }) {
    const view = useShareView(enabled)
    // Until the browser was read, an empty list would only flash „Gerade ist nichts in Arbeit.“.
    if (!view.draftsReady) return null
    return (
        <InProgress
            drafts={view.drafts}
            datasets={datasets}
            rows={view.rows === null ? null : view.tabs.inProgress}
            elsewhere={view.rows === null ? 0 : view.tabs.elsewhere['in-progress']}
            error={view.error}
            // Without the right to see submissions, the started shares are all there is: counted, but no empty groups.
            known={!enabled ? 'own' : view.rows !== null && !view.error ? 'all' : 'partial'}
            loaded={view.loaded}
            onReload={view.reload}
            onDiscard={view.discardDraft}
        />
    )
}

/** A result of an action, kept for the row it is about - or for its place, once the row moved to another tab. */
interface RowResult {
    key: string
    /** Where the row stood - its group, and its place in it - for the result to stand there when the row is gone. */
    group: InProgressGroup
    index: number
    done: DeletionDone
}

const entries = (count: number) => `${count} ${count === 1 ? 'Eintrag' : 'Einträge'}`

/** „Du bist dran · 2“ to see, „Du bist dran, 2 Einträge“ to hear, as the tab bar counts; no count while it is unknown. */
function GroupHeading({ group, count }: { group: InProgressGroup; count?: number }) {
    return (
        <h3 className="text-base font-semibold text-foreground">
            {GROUP_TITLES[group]}
            {count !== undefined && (
                <>
                    <span aria-hidden className="font-normal text-muted-foreground">{` · ${count}`}</span>
                    <span className="sr-only">{`, ${entries(count)}`}</span>
                </>
            )}
        </h3>
    )
}

/**
 * "In Arbeit": everything someone started sharing and has not finished
 * (plan of 2026-10-18, section 4). Started shares come at once, the proposals
 * when GitLab answered. The rows stand in groups: „Du bist dran“, „Wartet auf
 * andere“ and, when there is any, „Stand nicht lesbar“. Nothing is cut off.
 *
 * Every button in a row is secondary, because several rows can be the
 * person's move at once and the page's one primary is „Neues Paket teilen“.
 * The way out („Verwerfen“, „Zurückziehen“) asks first, in the dialog that
 * says what it means at the row's stage.
 *
 * While focus is inside the list its order and groups hold: a row that moves
 * to another group after the person acted on it stays where they are looking,
 * with its result in it, until they leave the list.
 */
export function InProgress({
    drafts,
    datasets,
    rows,
    elsewhere = 0,
    error,
    known = rows === null || error ? 'partial' : 'all',
    loaded,
    onReload,
    onDiscard,
}: {
    drafts: ShareDraft[]
    datasets?: { id: string; name: string }[]
    /** The shared versions „In Arbeit“ holds, by the tab rules; null while GitLab is asked. */
    rows: TabRow[] | null
    /** Versions in progress from other instances: counted, not listed. */
    elsewhere?: number
    error?: string
    /** What the groups may count (`GroupsKnown`); by default, all once GitLab answered. */
    known?: GroupsKnown
    /** How many readings of them came back so far (`useSharedListing`). */
    loaded: number
    /** Reads the shared packages again, after something here changed them. */
    onReload: () => void
    onDiscard: (datasetId: string) => void
}) {
    const { proposing, propose, outcomeFor } = useCatalogProposal(onReload)
    const [deleting, setDeleting] = useState<InProgressItem | null>(null)
    const [result, setResult] = useState<RowResult | null>(null)
    // The row just withdrawn at GitLab, until the next reading comes back (answer or failure): no stale buttons meanwhile.
    const [settling, setSettling] = useState<{ key: string; loaded: number } | null>(null)
    // „Erneut versuchen“ was pressed at this reading, for the list or one row: busy until the next one comes back.
    const [retried, setRetried] = useState<{ key?: string; loaded: number } | null>(null)
    // Where the rows stood when focus came into the list; null while it is elsewhere.
    const [frozen, setFrozen] = useState<Placed[] | null>(null)
    const listRef = useRef<HTMLDivElement>(null)
    // Which result takes the focus when it appears: once, so a result shown again does not pull it back from elsewhere.
    const focusNextRef = useRef<string | null>(null)

    const here = useMemo<DatasetsHere>(() => (datasets ? new Map(datasets.map((dataset) => [dataset.id, dataset.name])) : ANY_DATASET), [datasets])
    const items = inProgressItems(drafts, here, rows ?? [])
    const byKey = new Map(items.map((item) => [item.key, item]))
    const sorted = placesOf(items)
    // A result whose row is gone takes the row's place again, also in the order and the groups the person saw.
    const kept = frozen ? keptPlaces(frozen, sorted) : sorted
    const placed = result && !byKey.has(result.key) ? withPlace(kept, { key: result.key, group: result.group }, result.index) : kept
    const order = placed.map((place) => place.key)
    // Counts, and empty groups, show only once they are known (`shownGroups`).
    const groups = shownGroups(placed, known)
    const settlingKey = settling && settling.loaded === loaded ? settling.key : undefined

    // Focus can leave without a blur reaching the list - the element it was on went away with a change of
    // the rows: then the order is free again. Checked after each change of what the list shows.
    const shown = `${placed.map((place) => `${place.group}:${place.key}`).join('\n')}|${settlingKey ?? ''}|${proposing ?? ''}|${loaded}`
    useEffect(() => {
        if (frozen && !listRef.current?.contains(document.activeElement)) setFrozen(null)
    }, [frozen, shown])

    if (order.length === 0) {
        if (rows === null && !error) return <Pending>Stand bei GitLab wird abgefragt …</Pending>
        if (!error) {
            return (
                <div className="flex flex-col gap-4">
                    <EmptyTab tab="in-progress" />
                    {elsewhere > 0 && <p className="text-sm text-muted-foreground">{elsewhereLine(elsewhere)}</p>}
                </div>
            )
        }
    }

    const finish = (item: InProgressItem, done: DeletionDone) => {
        setDeleting(null)
        focusNextRef.current = `done:${item.key}`
        const group = placed.find((place) => place.key === item.key)?.group ?? 'yours'
        const index = placed.filter((place) => place.group === group).findIndex((place) => place.key === item.key)
        setResult({ key: item.key, group, index: Math.max(0, index), done })
        if (done.remote) {
            setSettling({ key: item.key, loaded })
            onReload()
        }
    }

    const doneNotice = (current: RowResult) => (
        <ResultSlot id={`done:${current.key}`} focusNextRef={focusNextRef}>
            <Notice tone="success" live action={current.done.mrUrl ? <ExternalAnchor href={current.done.mrUrl}>In GitLab ansehen</ExternalAnchor> : undefined}>
                {current.done.detail}
            </Notice>
        </ResultSlot>
    )

    return (
        <div className="flex flex-col gap-4">
            {order.length > 0 && (
                <div
                    ref={listRef}
                    className="flex flex-col gap-6"
                    onFocus={() => {
                        if (!frozen) setFrozen(placed)
                    }}
                    onBlur={(event) => {
                        const list = event.currentTarget
                        if (list.contains(event.relatedTarget as Node | null)) return
                        if (event.relatedTarget !== null) {
                            setFrozen(null)
                            return
                        }
                        // No new target: the focus may only have left the window - „In GitLab ansehen“ opens a tab -
                        // and comes back to the same row then, which a reading landing meanwhile must not move.
                        // Decided once the browser has settled where the focus is.
                        setTimeout(() => {
                            if (!list.contains(document.activeElement)) setFrozen(null)
                        }, 0)
                    }}
                >
                    {groups.map(({ group, keys, counted }) => {
                        // A result standing where its row was is no row of the group.
                        const count = keys.filter((key) => byKey.has(key)).length
                        const lead = GROUP_LEADS[group]
                        return (
                            <div key={group} className="flex flex-col gap-3">
                                <div className="flex flex-col gap-1">
                                    <GroupHeading group={group} count={counted ? count : undefined} />
                                    {lead && count > 0 && <p className="text-sm text-muted-foreground">{lead}</p>}
                                </div>
                                {keys.length > 0 && (
                                    <ul className="flex flex-col gap-4">
                                        {keys.map((key) => {
                                            const item = byKey.get(key)
                                            // The row moved on to another tab (withdrawn, discarded): its result stands where it was.
                                            if (!item) return result?.key === key ? <li key={key}>{doneNotice(result)}</li> : null
                                            const outcome = item.kind === 'shared' ? outcomeFor(item.row.key) : undefined
                                            return (
                                                <InProgressRow
                                                    key={key}
                                                    item={item}
                                                    here={here}
                                                    settling={key === settlingKey}
                                                    proposing={item.kind === 'shared' && proposing === item.row.key}
                                                    retrying={retried?.key === key && retried.loaded === loaded}
                                                    disabled={proposing !== null}
                                                    onPropose={() => {
                                                        if (item.kind !== 'shared') return
                                                        focusNextRef.current = `outcome:${key}`
                                                        setResult(null)
                                                        void propose(item.row)
                                                    }}
                                                    onRemove={() => {
                                                        setResult(null)
                                                        setDeleting(item)
                                                    }}
                                                    onRetry={() => {
                                                        setRetried({ key, loaded })
                                                        onReload()
                                                    }}
                                                >
                                                    {result?.key === key && doneNotice(result)}
                                                    {outcome && (
                                                        <ResultSlot id={`outcome:${key}`} focusNextRef={focusNextRef}>
                                                            <ProposalOutcome result={outcome} />
                                                        </ResultSlot>
                                                    )}
                                                </InProgressRow>
                                            )
                                        })}
                                    </ul>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
            {rows === null && !error && <Pending>Stand bei GitLab wird abgefragt …</Pending>}
            {elsewhere > 0 && <p className="text-sm text-muted-foreground">{elsewhereLine(elsewhere)}</p>}
            {/* Started shares above still show: they live in this browser, not at GitLab. */}
            {error && (
                <Notice
                    tone="error"
                    live
                    action={
                        <Button
                            pending={retried !== null && retried.key === undefined && retried.loaded === loaded}
                            onClick={() => {
                                setRetried({ loaded })
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

/**
 * Where a result appears, inside the row it is about: it takes the focus
 * once, when it is the one asked for, so the person hears it and finds it
 * where they acted - and the list keeps its order around them meanwhile.
 *
 * The same result is shown anew where its row was once the row went to
 * another tab (withdrawn, discarded). The focus was in the row and went with
 * it to the start of the page; then it comes back here, without scrolling,
 * rather than being lost. Focus the person moved elsewhere stays there.
 */
function ResultSlot({ id, focusNextRef, children }: { id: string; focusNextRef: RefObject<string | null>; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (focusNextRef.current === id) {
            focusNextRef.current = null
            ref.current?.focus()
            return
        }
        const active = document.activeElement
        if (!active || active === document.body) ref.current?.focus({ preventScroll: true })
    }, [id, focusNextRef])
    return (
        <div ref={ref} tabIndex={-1} className="outline-none">
            {children}
        </div>
    )
}

function InProgressRow({
    item,
    here,
    settling,
    proposing,
    retrying,
    disabled,
    onPropose,
    onRemove,
    onRetry,
    children,
}: {
    item: InProgressItem
    here: DatasetsHere
    /** Just withdrawn; the list is being read again. */
    settling: boolean
    proposing: boolean
    retrying: boolean
    /** A catalogue proposal is under way somewhere in the list: no second one meanwhile. */
    disabled: boolean
    onPropose: () => void
    onRemove: () => void
    onRetry: () => void
    children?: ReactNode
}) {
    const view = rowView(item, here)
    // A link from the wizard („Weiter geht es unter „In Arbeit““) lands on the row it names.
    const id = item.kind === 'shared' ? rowAnchor(item.row) : undefined
    if (settling) {
        return (
            <ShareRow id={id} title={view.title} titleAs="h4" version={view.version} origin={view.origin} status={<Pending>Wird neu abgefragt …</Pending>}>
                {children}
            </ShareRow>
        )
    }
    const action = (one: RowAction) => (
        <RowButton
            key={one.kind}
            action={one}
            pending={one.kind === 'propose-entry' ? proposing : one.kind === 'retry' ? retrying : false}
            disabled={disabled}
            onPropose={onPropose}
            onRemove={onRemove}
            onRetry={onRetry}
        />
    )
    const actions = [...view.quiet, ...(view.main ? [view.main] : [])]
    return (
        <ShareRow
            id={id}
            title={view.title}
            titleAs="h4"
            version={view.version}
            origin={view.origin}
            track={view.track}
            status={<StatusLine status={view.status} />}
            reasons={view.reasons}
            earlier={view.earlier}
            actions={actions.length > 0 ? actions.map(action) : undefined}
        >
            {children}
        </ShareRow>
    )
}

const ICONS = { discard: Trash2, withdraw: Undo2, 'new-version': PackagePlus, 'propose-entry': GitMerge } as const

/** One action of a row, in the look the stage table gives it: a secondary button, a link to GitLab, or a quiet action. */
function RowButton({
    action,
    pending,
    disabled,
    onPropose,
    onRemove,
    onRetry,
}: {
    action: RowAction
    pending: boolean
    disabled: boolean
    onPropose: () => void
    onRemove: () => void
    onRetry: () => void
}) {
    const label = ACTION_LABELS[action.kind]
    // In the buttons' size: the link stands among them.
    if (action.kind === 'gitlab') {
        return (
            <ExternalAnchor href={action.href ?? '#'} className="text-sm">
                {label}
            </ExternalAnchor>
        )
    }
    const variant = action.look === 'quiet' ? 'ghost' : 'secondary'
    if (action.kind === 'resume' || action.kind === 'new-version') {
        const Icon = action.kind === 'new-version' ? ICONS['new-version'] : undefined
        return (
            <Link href={action.href ?? '#'} className={buttonClass(variant)}>
                {Icon && <Icon aria-hidden className="size-4" />}
                {label}
            </Link>
        )
    }
    const onClick = action.kind === 'propose-entry' ? onPropose : action.kind === 'retry' ? onRetry : onRemove
    return (
        // „Erneut versuchen“ only reads again, which a proposal under way elsewhere does not stand in the way of.
        <Button
            variant={variant}
            icon={action.kind === 'retry' ? undefined : ICONS[action.kind]}
            pending={pending}
            disabled={action.kind !== 'retry' && disabled}
            onClick={onClick}
        >
            {label}
        </Button>
    )
}
