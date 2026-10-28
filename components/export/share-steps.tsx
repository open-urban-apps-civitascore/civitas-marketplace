import { Circle, CircleCheck, Clock, GitMerge, GitPullRequest, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react'

import { Button, ExternalAnchor } from '@/components/ui/button'
import { Disclosure } from '@/components/ui/disclosure'
import { Panel } from '@/components/ui/layout'
import { InlineNotice } from '@/components/ui/notice'
import { reasonWords, type Decline } from '@/lib/export/declines'
import { mergeRequestRef } from '@/lib/export/share-state'
import { declinedStage, removalDeclinedNotice, STAGES, WAITING_FOR_TEAM, type DeclinedStage, type ShareProgress, type Stage, type StageState } from '@/lib/export/share-stages'

// One primary button at most, at the person's move now; later stages are grey text, not disabled buttons.
// No numbers on purpose: the stepper above numbers the form, and two numbered lists read as one.

function whoLine(stage: Stage, state: StageState, progress: ShareProgress, declined: DeclinedStage | undefined): string {
    if (state === 'done') return `${stage.who} - erledigt`
    if (state === 'declined') return declined?.who ?? `${stage.who} - nicht angenommen`
    if (state === 'blocked') return progress.turn === 'you' ? 'Du bist dran' : stage.who
    if (state === 'current') return stage.turn === 'you' ? 'Du bist dran' : WAITING_FOR_TEAM
    if (state === 'waiting') return WAITING_FOR_TEAM
    return stage.who
}

const MARK: Record<StageState, LucideIcon> = {
    done: CircleCheck,
    current: Circle,
    waiting: Clock,
    blocked: Circle,
    declined: TriangleAlert,
    later: Circle,
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
            <ol className="flex flex-col">
                {STAGES.map((stage) => {
                    const state = progress.states[stage.key]
                    const Mark = MARK[state]
                    const reason = blocker(stage, state)
                    const declined = declinedAt(stage, state)
                    const button = action(stage, state)
                    const mrLink = link(stage, state)
                    const quiet = state === 'later'
                    return (
                        <li
                            key={stage.key}
                            aria-current={state === 'current' || state === 'waiting' || state === 'blocked' || state === 'declined' ? 'step' : undefined}
                            className="flex flex-col gap-2 border-t py-3 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <div className="flex min-w-0 items-start gap-3">
                                {/* No green: it already means "verified" and "use case" here. */}
                                <Mark
                                    aria-hidden
                                    className={`mt-0.5 size-4 shrink-0 ${
                                        state === 'declined' ? 'text-amber-600 dark:text-warn' : state === 'current' || state === 'blocked' ? 'text-primary' : 'text-muted-foreground'
                                    }`}
                                />
                                <div className="min-w-0">
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
                            </div>
                            {(button || mrLink) && (
                                <div className="flex shrink-0 flex-wrap items-center gap-3 pl-7 sm:pl-0">
                                    {mrLink}
                                    {button}
                                </div>
                            )}
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
