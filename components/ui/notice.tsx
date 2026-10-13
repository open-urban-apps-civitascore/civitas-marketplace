import type { ReactNode } from 'react'
import { CircleCheck, CircleX, Info, Loader2, TriangleAlert, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Four tones, one rule each (Ewa, 2026-10-13):
 *
 * - `neutral`: a fact or a limit, or a task for someone else - nothing to fix
 *   here. No right to share, sharing not set up (the operator does that), a
 *   merge request that is already open.
 * - `success`: an action finished or a check passed.
 * - `warn`: something is missing that the person on this page can add, here
 *   or in the portal - a data structure, a Topic, content the export doubts.
 * - `error`: an action failed or was refused.
 *
 * Only the icon, the border and the tint carry the tone; text stays black or
 * grey. The status tokens are bright, and yellow or pink body text on a pale
 * tint was hard to read. There is no blue info tone: blue already means the
 * Community tier.
 */
export type NoticeTone = 'neutral' | 'success' | 'warn' | 'error'

const TONES: Record<NoticeTone, { icon: LucideIcon; box: string; mark: string }> = {
    neutral: { icon: Info, box: 'border-border bg-muted/40', mark: 'text-muted-foreground' },
    success: { icon: CircleCheck, box: 'border-success/40 bg-success/5 dark:bg-success/10', mark: 'text-success' },
    // The warn token is a light yellow: as an icon on its own tint it needs the darker amber.
    warn: { icon: TriangleAlert, box: 'border-warn/60 bg-warn/10 dark:bg-warn/15', mark: 'text-amber-600 dark:text-warn' },
    error: { icon: CircleX, box: 'border-error/40 bg-error/5 dark:bg-error/10', mark: 'text-error' },
}

/**
 * The one container for a message. Server-safe: no hooks, no 'use client'.
 *
 * `live` is for results of an action the person just took: an error is then
 * announced at once, everything else politely. A message that is simply part
 * of the page stays silent.
 */
export function Notice({
    tone,
    title,
    action,
    live = false,
    className,
    children,
}: {
    tone: NoticeTone
    title?: string
    /** One button or link that resolves the message. */
    action?: ReactNode
    live?: boolean
    className?: string
    children?: ReactNode
}) {
    const { icon: Icon, box, mark } = TONES[tone]
    return (
        <div
            role={live ? (tone === 'error' ? 'alert' : 'status') : undefined}
            className={cn('flex gap-3 rounded-lg border px-4 py-3 text-sm', box, className)}
        >
            <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', mark)} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                {title && <p className="font-medium text-foreground">{title}</p>}
                {children && <div className={cn('break-words leading-relaxed', title ? 'text-muted-foreground' : 'text-foreground')}>{children}</div>}
                {action && <div className="pt-1">{action}</div>}
            </div>
        </div>
    )
}

/** The same message without a box, for a row, a footer or a step. */
export function InlineNotice({ tone, id, children }: { tone: NoticeTone; id?: string; children: ReactNode }) {
    const { icon: Icon, mark } = TONES[tone]
    return (
        <p id={id} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <Icon aria-hidden className={cn('mt-0.5 size-3.5 shrink-0', mark)} />
            <span className="min-w-0 break-words">{children}</span>
        </p>
    )
}

/** Several points inside a Notice. Breaks long words by hyphenation, not mid-letter. */
export function NoticeList({ items }: { items: string[] }) {
    return (
        <ul className="list-disc pl-5">
            {items.map((item) => (
                <li key={item} className="hyphens-auto break-words">
                    {item}
                </li>
            ))}
        </ul>
    )
}

/** Something is being worked on. */
export function Pending({ children }: { children: ReactNode }) {
    return (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            {children}
        </p>
    )
}
