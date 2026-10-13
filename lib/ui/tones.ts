/**
 * Icon tile colours, one per system. Identity only: a tint says which system a
 * card stands for, never how good something is.
 *
 * `neutral` is for surfaces that carry no identity colour yet. The share page
 * uses it until the flow cards' colours are aligned with the design system
 * (Ewa, 2026-10-13): amber already means caution there and emerald the
 * Anwendungsfall, so copying today's tiles onto a new page would spread the
 * clash.
 */
export const TONES = {
    simulator: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    platform: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    dashboards: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
    map: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
    neutral: 'bg-muted text-muted-foreground',
} as const

export type Tone = keyof typeof TONES
