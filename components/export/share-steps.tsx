import { Circle, CircleCheck, Clock, GitMerge, GitPullRequest, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react'

import { Button, ExternalAnchor } from '@/components/ui/button'
import { Disclosure } from '@/components/ui/disclosure'
import { Panel } from '@/components/ui/layout'
import { InlineNotice } from '@/components/ui/notice'
import { mergeRequestRef } from '@/lib/export/share-state'
import { STAGES, WAITING_FOR_TEAM, type ShareProgress, type Stage, type StageState } from '@/lib/export/share-stages'

/**
 * "So geht es weiter": the last step of "Teilen" as the task it is (Ewa's
 * point 8 of 2026-10-13). Four stages, two of them the person's own, two the
 * catalogue team's. Exactly one primary button, at the stage that is the
 * person's move now; a stage that waits for others offers "Stand prüfen";
 * later stages are a grey line, not a disabled button. What stops a stage
 * says why, at the stage.
 *
 * No numbers on purpose: the stepper above already numbers the steps of the
 * form, and two numbered lists on one page read as one.
 *
 * "Merge Request" is said only in the fold-out that explains it; everywhere
 * else a proposal is a "Vorschlag" and GitLab is where it can be seen.
 */

/** Who the stage belongs to, and whether it is theirs now. A stage nobody can move on is nobody's turn. */
function whoLine(stage: Stage, state: StageState, progress: ShareProgress): string {
    if (state === 'done') return `${stage.who} - erledigt`
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
    // Never the mark of the person's next step: the catalogue team turned this stage down.
    declined: TriangleAlert,
    later: Circle,
}

/** " (Vorschlag !12)", or nothing when the address names no number. */
function proposalRef(url: string | undefined): string {
    const ref = mergeRequestRef(url)
    return ref ? ` (Vorschlag ${ref})` : ''
}

export function ShareSteps({
    progress,
    pendingIntent,
    busy,
    proposeBlocker,
    catalogBlocker,
    canCheck,
    bundleMrUrl,
    catalogMrUrl,
    removalMrUrl,
    onPropose,
    onCheck,
    onCatalog,
}: {
    progress: ShareProgress
    /** The action running right now, so only its button spins. */
    pendingIntent?: 'bundle' | 'status' | 'catalog'
    /** Any request is running: no second one meanwhile. */
    busy: boolean
    /** Why the package cannot be proposed from here, if it cannot. */
    proposeBlocker?: string
    /** Why the catalogue step cannot be taken from here, if it cannot. */
    catalogBlocker?: string
    /** GitLab can be asked at all (sharing set up, and the person may). */
    canCheck: boolean
    bundleMrUrl?: string
    catalogMrUrl?: string
    /** The merge request that proposes taking the version out again, when there is one. */
    removalMrUrl?: string
    onPropose: () => void
    onCheck: () => void
    onCatalog: () => void
}) {
    const action = (stage: Stage, state: StageState) => {
        if (state === 'current' && stage.key === 'propose' && !proposeBlocker) {
            return (
                <>
                    {/* Said before the click: the proposal is public, and it names the person. */}
                    <span className="text-xs text-muted-foreground">Dein Name erscheint im öffentlichen Vorschlag bei GitLab.</span>
                    <Button variant="primary" icon={GitPullRequest} pending={pendingIntent === 'bundle'} disabled={busy} onClick={onPropose}>
                        Zur Prüfung einreichen
                    </Button>
                </>
            )
        }
        if (state === 'current' && stage.key === 'catalog' && !catalogBlocker) {
            return (
                <Button variant="primary" icon={GitMerge} pending={pendingIntent === 'catalog'} disabled={busy} onClick={onCatalog}>
                    Katalog-Eintrag vorschlagen
                </Button>
            )
        }
        // Waiting on others, or stopped by something that can be fixed elsewhere: ask GitLab again.
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
        // Once per merge request: at the stage that waits on it, afterwards at the stage that opened it.
        const shows =
            (stage.key === 'propose' && state === 'done' && progress.states.review !== 'waiting') ||
            (stage.key === 'review' && state === 'waiting') ||
            (stage.key === 'catalog' && state === 'done' && progress.states.listing !== 'waiting') ||
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

    return (
        <Panel title="So geht es weiter">
            {/* Outside the four stages: it undoes them. Said first, because it decides what the stages below still mean. */}
            {progress.removal && (
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
            )}
            <ol className="flex flex-col">
                {STAGES.map((stage) => {
                    const state = progress.states[stage.key]
                    const Mark = MARK[state]
                    const reason = blocker(stage, state)
                    const button = action(stage, state)
                    const mrLink = link(stage, state)
                    const quiet = state === 'later'
                    return (
                        <li
                            key={stage.key}
                            aria-current={state === 'current' || state === 'waiting' || state === 'blocked' ? 'step' : undefined}
                            className="flex flex-col gap-2 border-t py-3 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <div className="flex min-w-0 items-start gap-3">
                                {/* Neutral marks: green already means "verified" and "use case" here. */}
                                <Mark aria-hidden className={`mt-0.5 size-4 shrink-0 ${state === 'current' || state === 'blocked' ? 'text-primary' : 'text-muted-foreground'}`} />
                                <div className="min-w-0">
                                    <p className={`text-sm ${quiet ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>{stage.title}</p>
                                    <p className="text-xs text-muted-foreground">{whoLine(stage, state, progress)}</p>
                                    {reason && (
                                        <div className="mt-1.5">
                                            {/* Neutral once nothing is left to do: nobody on this page can change it. */}
                                            <InlineNotice tone={progress.finished ? 'neutral' : 'warn'}>{reason}</InlineNotice>
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
                    dort an und nimmt es an („Merge“) - oder fragt im Vorschlag nach. Erst wenn es angenommen ist, bist du
                    wieder dran.
                </p>
            </Disclosure>

            {/* Said at the moment someone might leave: the way back has to be known before it is needed. */}
            {progress.states.propose === 'done' && !progress.finished && !progress.removal && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                    Du kannst diese Seite jetzt verlassen. Du findest das Paket jederzeit unter „Teilen“ › „In Arbeit“ - dort
                    geht es nach der Prüfung weiter.
                </p>
            )}
        </Panel>
    )
}
