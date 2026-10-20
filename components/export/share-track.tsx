import { Check, Clock, TriangleAlert } from 'lucide-react'

import type { TrackMark, TrackStep } from '@/lib/export/in-progress-items'
import { cn } from '@/lib/utils'

/**
 * The progress line of a row in „In Arbeit“: the four steps of sharing by
 * the names „So geht es weiter“ uses (plan of 2026-10-18, section 4).
 *
 * Hidden from screen readers as a whole: the status sentence under it says
 * the same in words („Paket-Prüfung (2 von 4) - wartet auf das Katalog-Team“),
 * and a list of four marks per row would only repeat it. The person's own
 * step is a thick ring in the text colour, never primary blue, which is both
 * the action colour and the Datenstruktur colour; the warn triangle is the
 * only colour on the line. Every mark keeps 3:1 against the card. The labels
 * are left out at phone width, where four of them do not fit.
 *
 * Server-safe: no hooks, for the list and its tests.
 */
export function ShareTrack({ steps }: { steps: TrackStep[] }) {
    return (
        <div aria-hidden className="grid max-w-md grid-cols-4">
            {steps.map((step, index) => {
                const next = steps[index + 1]
                return (
                    <div key={step.label} className="flex min-w-0 flex-col gap-1.5">
                        <div className="flex items-center">
                            <Mark mark={step.mark} />
                            {next && (
                                // Drawn darker where the line has got past it: the way already gone reads at a glance.
                                <span className={cn('mx-1.5 h-px flex-1', step.mark === 'done' && next.mark !== 'later' ? 'bg-foreground/60' : 'bg-border')} />
                            )}
                        </div>
                        <span
                            className={cn(
                                'hidden pr-2 text-xs leading-snug sm:block',
                                step.mark === 'yours' ? 'font-semibold text-foreground' : 'text-muted-foreground',
                            )}
                        >
                            {step.label}
                        </span>
                    </div>
                )
            })}
        </div>
    )
}

function Mark({ mark }: { mark: TrackMark }) {
    switch (mark) {
        case 'done':
            return (
                <span data-mark="done" className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground text-background">
                    <Check className="size-3" strokeWidth={3} />
                </span>
            )
        case 'yours':
            return <span data-mark="yours" className="size-5 shrink-0 rounded-full border-[3px] border-foreground" />
        case 'waiting':
            return (
                <span data-mark="waiting" className="grid size-5 shrink-0 place-items-center rounded-full border border-muted-foreground text-muted-foreground">
                    <Clock className="size-3" />
                </span>
            )
        case 'problem':
            // The darker amber, as the warn notice uses it: the warn token alone is too light on a card.
            return (
                <span data-mark="problem" className="grid size-5 shrink-0 place-items-center text-amber-600 dark:text-warn">
                    <TriangleAlert className="size-5" />
                </span>
            )
        default:
            return <span data-mark="later" className="size-5 shrink-0 rounded-full border border-muted-foreground" />
    }
}
