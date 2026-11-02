import { Check, Clock, GitMerge, GitPullRequest, RefreshCw, TriangleAlert } from 'lucide-react'

import { Button, ExternalAnchor } from '@/components/ui/button'
import { Disclosure } from '@/components/ui/disclosure'
import { Panel } from '@/components/ui/layout'
import { InlineNotice } from '@/components/ui/notice'
import { reasonWords, type Decline } from '@/lib/export/declines'
import { mergeRequestRef } from '@/lib/export/share-state'
import { declinedStage, removalDeclinedNotice, STAGES, WAITING_FOR_TEAM, type DeclinedStage, type ShareProgress, type Stage, type StageState } from '@/lib/export/share-stages'
import { cn } from '@/lib/utils'

// One primary button at most, at the person's move now; later stages are grey text, not disabled buttons.
// Numbered discs on a line, unlike the wizard's numbered boxes above, so the two never read as one list.

function whoLine(stage: Stage, state: StageState, progress: ShareProgress, declined: DeclinedStage | undefined): string {
    if (state === 'done') return `${stage.who} - erledigt`
    if (state === 'declined') return declined?.who ?? `${stage.who} - nicht angenommen`
    if (state === 'blocked') return progress.turn === 'you' ? 'Du bist dran' : stage.who
    if (state === 'current') return stage.turn === 'you' ? 'Du bist dran' : WAITING_FOR_TEAM
    if (state === 'waiting') return WAITING_FOR_TEAM
    return stage.who
}

/** As the progress line in „In Arbeit“ draws them; no green, which already means "verified" and "use case" here. */
function StepMark({ state, number }: { state: StageState; number: number }) {
    switch (state) {
        case 'done':
            return (
                <span data-mark="done" className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-background">
                    <Check className="size-3.5" strokeWidth={3} />
                </span>
            )
        case 'waiting':
            return (
                <span data-mark="waiting" className="grid size-6 shrink-0 place-items-center rounded-full border border-muted-foreground text-muted-foreground">
                    <Clock className="size-3.5" />
                </span>
            )
        case 'declined':
            return (
                <span data-mark="declined" className="grid size-6 shrink-0 place-items-center text-amber-600 dark:text-warn">
                    <TriangleAlert className="size-5" />
                </span>
            )
        case 'current':
        case 'blocked':
            return (
                <span data-mark="yours" className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-xs font-semibold tabular-nums text-background">
                    {number}
                </span>
            )
        default:
            return (
                <span data-mark="later" className="grid size-6 shrink-0 place-items-center rounded-full border bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                    {number}
                </span>
            )
    }
}

function proposalRef(url: string | undefined): string {
    const ref = mergeRequestRef(url)
    return ref ? ` (Vorschlag ${ref})` : ''
}

export function ShareSteps({
    progress,
    pendingIntent,
    busy,
    proposeBlocker,
    proposeWaits,
    catalogBlocker,
    canCheck,
    bundleMrUrl,
    catalogMrUrl,
    removalMrUrl,
    version,
    suggested,
    declines,
    removalDeclined,
    onPropose,
    onCheck,
    onCatalog,
}: {
    progress: ShareProgress
    pendingIntent?: 'bundle' | 'status' | 'catalog'
    busy: boolean
    proposeBlocker?: string
    /** `proposeBlocker` is another open proposal: a fact, shown neutral. */
    proposeWaits?: boolean
    catalogBlocker?: string
    canCheck: boolean
    bundleMrUrl?: string
    catalogMrUrl?: string
    removalMrUrl?: string
    version: string
    suggested?: string
    declines?: { review?: Decline; listing?: Decline }
    /** Only while it is news (`removalDeclineShown`). */
    removalDeclined?: Decline
    onPropose: () => void
    onCheck: () => void
    onCatalog: () => void
}) {
    const action = (stage: Stage, state: StageState) => {
        if (state === 'current' && stage.key === 'propose' && !proposeBlocker) {
            return (
                <>
                    <span className="text-xs text-muted-foreground">Dein Name erscheint im öffentlichen Vorschlag bei GitLab.</span>
                    <Button variant="primary" icon={GitPullRequest} pending={pendingIntent === 'bundle'} disabled={busy} onClick={onPropose}>
                        Zur Prüfung einreichen
                    </Button>
                </>
            )
        }
        if (state === 'current' && stage.key === 'catalog' && !catalogBlocker) {
            // After a "no" to the removal, reading it comes first: the entry is no longer the primary.
            return (
                <Button variant={removalDeclined ? 'secondary' : 'primary'} icon={GitMerge} pending={pendingIntent === 'catalog'} disabled={busy} onClick={onCatalog}>
                    Katalog-Eintrag vorschlagen
                </Button>
            )
        }
        if ((state === 'waiting' || (state === 'blocked' && progress.turn === 'you')) && canCheck) {
            return (
                <Button icon={RefreshCw} pending={pendingIntent === 'status'} disabled={busy} onClick={onCheck}>
                    Stand prüfen
                </Button>
            )
        }
        return undefined
    }

    const link = (stage: Stage, state: StageState) => {
        const url = stage.key === 'propose' || stage.key === 'review' ? bundleMrUrl : catalogMrUrl
        // Once per merge request: where it is waited on, else where it was opened; after a "no", not here.
        const shows =
            (stage.key === 'propose' && state === 'done' && progress.states.review !== 'waiting' && !declinedAt(STAGES[1], progress.states.review)) ||
            (stage.key === 'review' && state === 'waiting') ||
            (stage.key === 'catalog' && state === 'done' && progress.states.listing !== 'waiting' && !declinedAt(STAGES[3], progress.states.listing)) ||
            (stage.key === 'listing' && state === 'waiting')
        if (!url || !shows) return undefined
        return <ExternalAnchor href={url} className="text-xs">In GitLab ansehen</ExternalAnchor>
    }

    const blocker = (stage: Stage, state: StageState) => {
        if (state === 'blocked') return progress.blockedBy
        if (state === 'current' && stage.key === 'propose') return proposeBlocker
        if (state === 'current' && stage.key === 'catalog') return catalogBlocker
        return undefined
    }

    function declinedAt(stage: Stage, state: StageState): (DeclinedStage & { url: string }) | undefined {
        if (state !== 'declined' || (stage.key !== 'review' && stage.key !== 'listing')) return undefined
        const decline = declines?.[stage.key]
        return decline ? { ...declinedStage(stage.key, decline, version, suggested), url: decline.mrUrl } : undefined
    }

    return (
        <Panel title="So geht es weiter">
            {progress.removal ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <InlineNotice tone="neutral">
                        {progress.removal === 'pending'
                            ? `Für diese Version ist das Entfernen vorgeschlagen${proposalRef(removalMrUrl)} - jetzt entscheidet das Katalog-Team.`
                            : 'Diese Version ist entfernt - das Katalog-Team hat das Entfernen angenommen.'}{' '}
                        {removalMrUrl && <ExternalAnchor href={removalMrUrl}>In GitLab ansehen</ExternalAnchor>}
                    </InlineNotice>
                    {progress.removal === 'pending' && canCheck && (
                        <Button icon={RefreshCw} pending={pendingIntent === 'status'} disabled={busy} onClick={onCheck} className="shrink-0">
                            Stand prüfen
                        </Button>
                    )}
                </div>
            ) : (
                removalDeclined && (
                    <div className="flex flex-col gap-1.5">
                        <InlineNotice tone="neutral">{removalDeclinedNotice(removalDeclined)}</InlineNotice>
                        <p className="break-words text-sm leading-relaxed text-foreground">
                            {reasonWords(removalDeclined)} <ExternalAnchor href={removalMrUrl ?? removalDeclined.mrUrl}>Vorschlag ansehen</ExternalAnchor>
                        </p>
                    </div>
                )
            )}
            {progress.states.propose !== 'done' && <p className="text-sm text-muted-foreground">Vier Schritte bis in den Katalog - den ersten machst du hier.</p>}
            <ol className="flex flex-col">
                {STAGES.map((stage, index) => {
                    const state = progress.states[stage.key]
                    const next = STAGES[index + 1] ? progress.states[STAGES[index + 1].key] : undefined
                    const reason = blocker(stage, state)
                    const declined = declinedAt(stage, state)
                    const button = action(stage, state)
                    const mrLink = link(stage, state)
                    const quiet = state === 'later'
                    return (
                        <li
                            key={stage.key}
                            aria-current={state === 'current' || state === 'waiting' || state === 'blocked' || state === 'declined' ? 'step' : undefined}
                            className="flex gap-3"
                        >
                            <div aria-hidden className="flex flex-col items-center">
                                <StepMark state={state} number={index + 1} />
                                {/* Darker where the way is already gone. */}
                                {next && <span className={cn('my-1 w-px flex-1', state === 'done' && next !== 'later' ? 'bg-foreground/60' : 'bg-border')} />}
                            </div>
                            <div className={cn('flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between', next && 'pb-5')}>
                                <div className="min-w-0 pt-0.5">
                                    <p className={`text-sm ${quiet ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>{stage.title}</p>
                                    <p className="text-xs text-muted-foreground">{whoLine(stage, state, progress, declined)}</p>
                                    {declined && (
                                        <div className="mt-1.5 flex flex-col gap-1.5">
                                            <p className="break-words text-sm leading-relaxed text-foreground">
                                                {declined.reason} <ExternalAnchor href={declined.url}>Vorschlag ansehen</ExternalAnchor>
                                            </p>
                                            <InlineNotice tone="neutral">{declined.next}</InlineNotice>
                                        </div>
                                    )}
                                    {reason && (
                                        <div className="mt-1.5">
                                            <InlineNotice tone={progress.finished || (stage.key === 'propose' && proposeWaits) ? 'neutral' : 'warn'}>{reason}</InlineNotice>
                                        </div>
                                    )}
                                </div>
                                {(button || mrLink) && (
                                    <div className="flex shrink-0 flex-wrap items-center gap-3">
                                        {mrLink}
                                        {button}
                                    </div>
                                )}
                            </div>
                        </li>
                    )
                })}
            </ol>

            <Disclosure summary="Was ist ein Merge Request?">
                <p className="text-xs leading-relaxed text-muted-foreground">
                    So heißt bei GitLab ein Änderungsvorschlag - hier kurz „Vorschlag“. Das Katalog-Team sieht sich das Paket
                    dort an und nimmt es an („Merge“) oder nicht. Hat es vorher eine Frage, steht sie im Vorschlag bei GitLab -
                    schau dort nach, wenn es länger dauert.
                </p>
            </Disclosure>

            {progress.states.propose === 'done' && !progress.finished && !progress.removal && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                    Du kannst diese Seite jetzt verlassen. Du findest das Paket jederzeit unter „Teilen“ › „In Arbeit“
                    {progress.turn === 'reviewers' ? ' - dort geht es nach der Prüfung weiter.' : '.'}
                </p>
            )}
        </Panel>
    )
}
