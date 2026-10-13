import { Children, Fragment, isValidElement, type ReactNode } from 'react'
import { ArrowDown, ArrowUpRight, type LucideIcon } from 'lucide-react'

import { IconTile } from '@/components/ui/icon-tile'
import type { Tone } from '@/lib/ui/tones'
import { cn } from '@/lib/utils'

/**
 * The standard view for what a use case consists of: one card per system,
 * joined by arrows in the order the data flows (generated, processed, shown).
 * It began as the installed use case's "In dieser Instanz"; the share page
 * shows what goes into a package the same way, so both read alike.
 *
 * Server-safe on purpose: no hooks and no 'use client' in this file. The
 * installation view is a server component that passes Lucide icons, which are
 * functions, and a client boundary would refuse them.
 *
 * `Flow` puts an arrow between every two groups and leaves out empty ones.
 * Its padding comes from the caller.
 */
export function Flow({ className, children }: { className?: string; children: ReactNode }) {
    const groups = Children.toArray(children)
    return (
        <div className={cn('flex flex-col', className)}>
            {groups.map((group, index) => (
                <Fragment key={isValidElement(group) && group.key !== null ? group.key : index}>
                    {index > 0 && <FlowArrow />}
                    {group}
                </Fragment>
            ))}
        </div>
    )
}

/**
 * One system the things live in. Its things hang off the icon tile on a guide
 * line: `ml-[1.875rem]` is the tile's centre (`px-4` plus half of `size-7`),
 * so the line starts right below it.
 */
export function FlowGroup({
    icon,
    tone,
    title,
    subtitle,
    meta,
    footer,
    children,
}: {
    icon: LucideIcon
    tone: Tone
    title: string
    subtitle?: string
    meta?: string
    footer?: ReactNode
    children: ReactNode
}) {
    return (
        <div className="rounded-lg border bg-card">
            <div className="flex items-center gap-3 px-4 pb-2 pt-3">
                <IconTile icon={icon} tone={tone} />
                <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                    {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
                </div>
                {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
            </div>
            <div className="mb-3 ml-[1.875rem] mr-3 border-l border-border">
                <ul>{children}</ul>
                {footer && <div className="pl-4 pt-2">{footer}</div>}
            </div>
        </div>
    )
}

/**
 * One thing in a system: what it is, its name, and where a click opens it.
 * Without `href` the row only reports, for a system the page cannot link into.
 * `target` names that place ("Portal", "Simulator"); it stays a label inside
 * the row link, never a link of its own.
 */
export function FlowItem({
    icon,
    kind,
    name,
    href,
    target,
    badge,
    note,
}: {
    icon: ReactNode
    kind?: string
    name: string
    href?: string
    target?: string
    badge?: ReactNode
    note?: string
}) {
    const body = (
        <>
            <span className="flex items-center gap-3">
                <span aria-hidden className="flex w-5 shrink-0 justify-center text-muted-foreground">
                    {icon}
                </span>
                <span className="min-w-0 flex-1 break-words">
                    {kind ? (
                        <>
                            <span className="text-muted-foreground">{kind}</span>{' '}
                            <span className="font-medium text-foreground">„{name}“</span>
                        </>
                    ) : (
                        <span className="font-medium text-foreground">{name}</span>
                    )}
                </span>
                {badge}
                {href && target && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                        {target}
                        <ArrowUpRight aria-hidden className="size-3.5" />
                    </span>
                )}
            </span>
            {/* Indented by the icon column, so it reads as part of the name. */}
            {note && <span className="mt-0.5 block pl-8 text-xs leading-relaxed text-muted-foreground">{note}</span>}
        </>
    )
    const row = 'block rounded-r-md py-2 pl-4 pr-3 text-sm'

    return (
        <li className="relative before:absolute before:left-0 before:top-[1.125rem] before:h-px before:w-2.5 before:bg-border">
            {href ? (
                <a href={href} target="_blank" rel="noreferrer" className={`group ${row} transition-colors hover:bg-muted/60`}>
                    {body}
                </a>
            ) : (
                <div className={row}>{body}</div>
            )}
        </li>
    )
}

/** A remark inside a group, on the guide line, at the size of a row's note. */
export function FlowNote({ children }: { children: ReactNode }) {
    return <li className="py-2 pl-4 pr-3 text-xs leading-relaxed text-muted-foreground">{children}</li>
}

/** The data moves on to the next system. Centred under the icon tiles. */
export function FlowArrow() {
    return (
        <div aria-hidden className="flex h-7 items-center pl-[23px] text-muted-foreground/60">
            <ArrowDown className="size-4" />
        </div>
    )
}
