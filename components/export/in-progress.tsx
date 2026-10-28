'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import Link from 'next/link'
import { GitMerge, PackagePlus, Trash2, Undo2 } from 'lucide-react'

import { ProposalOutcome, useCatalogProposal } from '@/components/export/catalog-proposal'
import { DeleteShareDialog, type DeletionDone } from '@/components/export/delete-share-dialog'
import { useShareView } from '@/components/export/share-listing-provider'
import { ShareRow, StatusLine } from '@/components/export/share-row'
import { elsewhereLine, EmptyTab } from '@/components/export/share-tab-states'
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

function itemTitle(item: InProgressItem): string {
    return item.kind === 'draft' ? item.draft.basics.displayName?.trim() || item.draft.datasetName : `${item.row.displayName} ${item.row.version}`
}

/** Unreadable datasets count as there: a portal that did not answer is no reason to stop anyone. */
const ANY_DATASET: DatasetsHere = { has: () => true }

export function InProgressTab({ enabled, datasets }: { enabled: boolean; datasets?: { id: string; name: string }[] }) {
    const view = useShareView(enabled)
    // Until the browser was read, an empty list would only flash.
    if (!view.draftsReady) return null
    return (
        <InProgress
            drafts={view.drafts}
            datasets={datasets}
            rows={view.rows === null ? null : view.tabs.inProgress}
            elsewhere={view.rows === null ? 0 : view.tabs.elsewhere['in-progress']}
            error={view.error}
            known={!enabled ? 'own' : view.rows !== null && !view.error ? 'all' : 'partial'}
            loaded={view.loaded}
            onReload={view.reload}
            onDiscard={view.discardDraft}
        />
    )
}

interface RowResult {
    key: string
    group: InProgressGroup
    index: number
    done: DeletionDone
}

const entries = (count: number) => `${count} ${count === 1 ? 'Eintrag' : 'Einträge'}`

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

/** While focus is inside the list its order holds: a row acted on stays put until focus leaves. */
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
    /** Null while GitLab is asked. */
    rows: TabRow[] | null
    elsewhere?: number
    error?: string
    known?: GroupsKnown
    /** How many readings came back so far. */
    loaded: number
    onReload: () => void
    onDiscard: (datasetId: string) => void
}) {
    const { proposing, propose, outcomeFor } = useCatalogProposal(onReload)
    const [deleting, setDeleting] = useState<InProgressItem | null>(null)
    const [result, setResult] = useState<RowResult | null>(null)
    // Just withdrawn at GitLab, until the next reading: no stale buttons meanwhile.
    const [settling, setSettling] = useState<{ key: string; loaded: number } | null>(null)
    const [retried, setRetried] = useState<{ key?: string; loaded: number } | null>(null)
    const [frozen, setFrozen] = useState<Placed[] | null>(null)
    const listRef = useRef<HTMLDivElement>(null)
    // Once only: a result shown again must not pull the focus back.
    const focusNextRef = useRef<string | null>(null)

    const here = useMemo<DatasetsHere>(() => (datasets ? new Map(datasets.map((dataset) => [dataset.id, dataset.name])) : ANY_DATASET), [datasets])
    const items = inProgressItems(drafts, here, rows ?? [])
    const byKey = new Map(items.map((item) => [item.key, item]))
    const sorted = placesOf(items)
    const kept = frozen ? keptPlaces(frozen, sorted) : sorted
    const placed = result && !byKey.has(result.key) ? withPlace(kept, { key: result.key, group: result.group }, result.index) : kept
    const order = placed.map((place) => place.key)
    const groups = shownGroups(placed, known)
    const settlingKey = settling && settling.loaded === loaded ? settling.key : undefined

    // Focus can vanish with a removed row, without a blur: rechecked after each change of what is shown.
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
                        // No new target: maybe only the window lost focus (a new tab); decided once the browser settled.
                        setTimeout(() => {
                            if (!list.contains(document.activeElement)) setFrozen(null)
                        }, 0)
                    }}
                >
                    {groups.map(({ group, keys, counted }) => {
                        // A result in a gone row's place is not counted.
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

/** Takes the focus once when asked for, or without scrolling when it fell to the body with its row. */
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
    settling: boolean
    proposing: boolean
    retrying: boolean
    disabled: boolean
    onPropose: () => void
    onRemove: () => void
    onRetry: () => void
    children?: ReactNode
}) {
    const view = rowView(item, here)
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
        // A retry only reads, so a proposal under way does not block it.
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
