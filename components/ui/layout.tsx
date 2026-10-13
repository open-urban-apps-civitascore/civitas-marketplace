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
    /** A quiet link or button at the right, not the page's main action. */
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
    headingRef,
    id,
    className,
    children,
}: {
    title?: string
    lead?: ReactNode
    /** At the right of the heading row: a count or a quiet link, not the main action. */
    aside?: ReactNode
    headingRef?: Ref<HTMLHeadingElement>
    id?: string
    className?: string
    children: ReactNode
}) {
    // Only point at the heading when there is one.
    const headingId = id && title ? `${id}-title` : undefined
    return (
        <section id={id} aria-labelledby={headingId} className={cn('flex flex-col gap-4 rounded-xl border bg-card p-6 lg:p-8', className)}>
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

/** One coherent object inside a section: a box of facts, a group of fields. */
export function Panel({
    title,
    icon,
    aside,
    className,
    children,
}: {
    title?: string
    /** A Lucide icon element, or an `IconTile`. */
    icon?: ReactNode
    aside?: ReactNode
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

/** Nothing to show yet: an honest sentence, and the way to change that. */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            <p>{children}</p>
            {action}
        </div>
    )
}
