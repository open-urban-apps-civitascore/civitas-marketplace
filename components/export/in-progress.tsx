'use client'

import Link from 'next/link'
import { ArrowRight, BookCheck, FilePen, GitMerge, GitPullRequest, TriangleAlert, type LucideIcon } from 'lucide-react'

import { ProposalOutcome, useCatalogProposal } from '@/components/export/catalog-proposal'
import { Button, ExternalAnchor } from '@/components/ui/button'
import { Panel } from '@/components/ui/layout'
import { InlineNotice, Pending } from '@/components/ui/notice'
import type { SharedPackageRow } from '@/lib/export-actions'
import { draftTime, type ShareDraft } from '@/lib/export/share-drafts'
import { shareProgress, turnLabel, type ShareProgress } from '@/lib/export/share-stages'
import type { ExportSource } from '@/lib/export/sources'

type Item =
    | { kind: 'draft'; key: string; draft: ShareDraft; available: boolean }
    | { kind: 'shared'; key: string; row: SharedPackageRow; progress: ShareProgress }

const STAGE_ICON: Record<string, LucideIcon> = {
    review: GitPullRequest,
    catalog: GitMerge,
    listing: BookCheck,
}

/**
 * "In Arbeit": everything someone started sharing and has not finished, at
 * the top of "Neu teilen" - the start-or-resume screen the patterns for long
 * flows recommend (GOV.UK One Login, 2026-10-16). Drafts from this browser
 * come first and at once; the merge requests follow when GitLab answered.
 * The panel around the form reads them (`useSharedListing`), so going into
 * a use case and back does not ask GitLab again.
 *
 * Only what is open: a draft, a package waiting for review, a merged package
 * waiting for its catalogue entry, an entry waiting for review. What is in
 * the catalogue, replaced or closed stays in "Geteilte Pakete". Every row has
 * one action. None is a primary button, because several rows can offer one
 * at the same time.
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

    const available = new Set(sources.map((source) => source.id))
    const shared: Item[] = (rows ?? []).flatMap((row): Item[] => {
        const progress = shareProgress({ version: row.version, bundleMrState: row.bundleMr.state, bundle: row.bundle, catalog: row.catalog })
        return row.problem || (!progress.finished && progress.active) ? [{ kind: 'shared', key: row.key, row, progress }] : []
    })
    // The person's own moves first, then what waits on others.
    const mine = (item: Item) => item.kind === 'draft' || item.row.problem !== undefined || item.progress.turn === 'you'
    const items: Item[] = [
        ...drafts.map((draft): Item => ({ kind: 'draft', key: `draft:${draft.datasetId}`, draft, available: available.has(draft.datasetId) })),
        ...shared,
    ].sort((a, b) => Number(mine(b)) - Number(mine(a)))

    // Nothing to show yet, or nothing open: no block. A list that pops in empty would only say "nothing".
    if (items.length === 0 && !error) return null

    return (
        <Panel
            title="In Arbeit"
            aside={
                <Link href="/export/shared" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
                    Alle geteilten Pakete
                    <ArrowRight aria-hidden className="size-3.5" />
                </Link>
            }
        >
            {items.length > 0 && (
                <ul className="flex flex-col">
                    {items.map((item) => (
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
