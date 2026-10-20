import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** Columns per number of steps, written out so Tailwind finds them. */
const COLUMNS: Record<number, string> = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
}

/**
 * A short sequence as editorial type, not boxes: a number and a rule per
 * column, then the title and an optional line. Boxes forced equal heights
 * onto unequal text and left tiles half empty; a numbered sequence cannot
 * look half empty, because nothing in it is a container. First drawn for the
 * front page's „So funktioniert’s“, shared with „So läuft Teilen ab“ so both
 * read alike (plan of 2026-10-18). Server-safe: no hooks.
 */
export function NumberedSteps({
    steps,
    titleAs: Title = 'h3',
    className,
}: {
    steps: { title: string; body?: ReactNode }[]
    /** `p` where the steps sit below no h2 of their own, so the heading levels do not skip one. */
    titleAs?: 'h3' | 'p'
    className?: string
}) {
    return (
        <ol className={cn('grid grid-cols-1 gap-x-10 gap-y-10', COLUMNS[steps.length] ?? COLUMNS[3], className)}>
            {steps.map((step, position) => (
                <li key={step.title} className="border-t-2 border-primary/70 pt-5">
                    <p aria-hidden className="text-sm font-semibold tabular-nums text-primary">
                        {String(position + 1).padStart(2, '0')}
                    </p>
                    <Title className="mt-3 text-lg font-semibold leading-snug text-foreground">{step.title}</Title>
                    {step.body && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>}
                </li>
            ))}
        </ol>
    )
}
