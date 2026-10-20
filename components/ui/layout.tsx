import type { ReactNode, Ref } from 'react'

import { cn } from '@/lib/utils'

/**
 * The levels of the communication design system as components, ported from
 * the clickdummy (its docs/communication-design-system.md and
 * components/ui/layout.tsx), so a page's parts share one heading, surface,
 * padding and radius instead of every component picking its own:
 *
 *   E1 Seite      PageHeader   the global h1, no surface
 *   E2 Abschnitt  Section      text-xl semibold, rounded-xl, p-6 (lg:p-8)
 *   E3 Karte      Panel        text-sm semibold, rounded-lg, p-5
 *   E4 Feld       Field        label text-xs muted, value text-sm
 *
 * Radius shrinks with nesting depth (xl, lg, md) and padding with it, so a
 * reader sees how deep they are without reading a word.
 *
 * Server-safe on purpose: no hooks and no 'use client'.
 */

// ── E1 · Seite ──────────────────────────────────────────────────────────────

export function PageHeader({
    title,
    lead,
    actions,
    className,
}: {
    title: string
    /** One sentence under the title. */
    lead?: ReactNode
    /** A link or button at the right: usually a quiet one; the page's one primary where the page is about it ("Teilen"). */
    actions?: ReactNode
    className?: string
}) {
    return (
        <header className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
            <div className="max-w-3xl">
                <h1>{title}</h1>
                {lead && <p className="mt-1 text-sm text-muted-foreground">{lead}</p>}
            </div>
            {actions && <div className="shrink-0">{actions}</div>}
        </header>
    )
}

// ── E2 · Abschnitt ──────────────────────────────────────────────────────────

/**
 * A major band of a page. `headingRef` makes the heading focusable, so a
 * multi-step flow can move focus and scroll to the step it just opened.
 */
export function Section({
    title,
    lead,
    aside,
    tone = 'card',
    headingRef,
    id,
    className,
    children,
}: {
    title?: string
    lead?: ReactNode
    /** At the right of the heading row: a count or a quiet link, not the main action. */
    aside?: ReactNode
    /** `muted` marks a zone for another audience (the technical details), not a lesser importance. */
    tone?: 'card' | 'muted'
    headingRef?: Ref<HTMLHeadingElement>
    id?: string
    className?: string
    children: ReactNode
}) {
    // Only point at the heading when there is one.
    const headingId = id && title ? `${id}-title` : undefined
    return (
        <section
            id={id}
            aria-labelledby={headingId}
            className={cn('flex flex-col gap-4 rounded-xl border p-6 lg:p-8', tone === 'muted' ? 'bg-muted/30' : 'bg-card', className)}
        >
            {title && (
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="max-w-3xl">
                        {/* scroll-mt and the missing outline only matter when the heading is focused, so they can always be set. */}
                        <h2
                            id={headingId}
                            ref={headingRef}
                            tabIndex={headingRef ? -1 : undefined}
                            className="scroll-mt-20 text-xl font-semibold text-foreground focus:outline-none"
                        >
                            {title}
                        </h2>
                        {lead && <p className="mt-1 text-sm text-muted-foreground">{lead}</p>}
                    </div>
                    {aside && <div className="shrink-0">{aside}</div>}
                </div>
            )}
            {children}
        </section>
    )
}

// ── E3 · Karte ──────────────────────────────────────────────────────────────

/**
 * One coherent object inside a section: a box of facts, a group of fields.
 * An identity colour goes on the icon tile only (`IconTile` with a kind's
 * tone), never on the text or the card (design system §4.2).
 */
export function Panel({
    title,
    icon,
    aside,
    footer,
    className,
    children,
}: {
    title?: string
    /** A Lucide icon element, or an `IconTile`. */
    icon?: ReactNode
    aside?: ReactNode
    /** A quiet note under a rule at the foot of the card. */
    footer?: ReactNode
    className?: string
    children?: ReactNode
}) {
    return (
        <section className={cn('flex flex-col gap-3 rounded-lg border bg-card p-5', className)}>
            {title && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        {icon}
                        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                    </div>
                    {aside && <div className="shrink-0">{aside}</div>}
                </div>
            )}
            {children}
            {footer && <div className="mt-auto border-t pt-3 text-xs text-muted-foreground">{footer}</div>}
        </section>
    )
}

/**
 * A quiet label for a region inside a Panel. Not a heading level of its own:
 * it labels a group without competing with the Panel's title.
 */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
    return <p className={cn('text-[11px] font-semibold uppercase tracking-wide text-muted-foreground', className)}>{children}</p>
}

// ── E4 · Feld ───────────────────────────────────────────────────────────────

/**
 * Label/value pairs. `stacked` for a narrow column (a sidebar), `columns` for a
 * wide one, where a two-column grid keeps every value on one axis instead of
 * pushing it to the far edge.
 */
export function FieldList({
    layout = 'stacked',
    className,
    children,
}: {
    layout?: 'stacked' | 'columns'
    className?: string
    children: ReactNode
}) {
    return (
        <dl
            className={cn(
                layout === 'stacked' ? 'flex flex-col gap-3' : 'grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]',
                className,
            )}
        >
            {children}
        </dl>
    )
}

/**
 * One fact. No rule under each row: spacing separates rows, rules mark the
 * boundaries of groups only (design system §2). In `columns`, `dt` and `dd`
 * are direct children of the list, so both columns stay aligned.
 */
export function Field({
    label,
    hint,
    layout = 'stacked',
    children,
}: {
    label: string
    /** A muted line under the value: an explanation, not a second value. */
    hint?: ReactNode
    layout?: 'stacked' | 'columns'
    children: ReactNode
}) {
    if (layout === 'columns') {
        return (
            <>
                <dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt>
                <dd className="min-w-0 break-words text-sm text-foreground">
                    {children}
                    {hint && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>}
                </dd>
            </>
        )
    }
    return (
        <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-sm font-medium text-foreground">
                {children}
                {hint && <span className="mt-0.5 block text-xs font-normal leading-relaxed text-muted-foreground">{hint}</span>}
            </dd>
        </div>
    )
}

/**
 * A fact without a judgement: a band, a count, a version. Colourless on
 * purpose, because colour here judges, and a green "unter 1.000 €" would claim
 * that cheap is good (design system §4).
 */
export function NeutralBadge({ short, children }: { short?: string; children: ReactNode }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            {short && (
                <span aria-hidden className="inline-flex size-5 items-center justify-center rounded bg-muted text-[11px] font-semibold text-muted-foreground">
                    {short}
                </span>
            )}
            <span className="text-sm font-normal text-foreground">{children}</span>
        </span>
    )
}

/** Nothing to show yet: an honest sentence, and the way to change that. */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            <p>{children}</p>
            {action}
        </div>
    )
}
