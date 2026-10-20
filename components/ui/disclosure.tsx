'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** Honours the system's "reduce motion" setting; a media query is an external store. */
function usePrefersReducedMotion(): boolean {
    return useSyncExternalStore(
        (onStoreChange) => {
            const query = window.matchMedia(REDUCED_MOTION)
            query.addEventListener('change', onStoreChange)
            return () => query.removeEventListener('change', onStoreChange)
        },
        () => window.matchMedia(REDUCED_MOTION).matches,
        // Server snapshot: render the motion-enabled markup, the client corrects it.
        () => false,
    )
}

/**
 * A quiet "show more": expert details (file lists, technical ids), or a word
 * explained where it is used. Ported from the clickdummy.
 *
 * Not native `<details>`: that draws the browser's own triangle and snaps
 * open. The height is measured and animated in pixels, and a ResizeObserver
 * keeps it right when the content reflows. Closed content stays in the DOM to
 * animate, and is `inert`, so it is neither focusable nor announced.
 */
export function Disclosure({
    summary,
    children,
    className,
    defaultOpen = false,
    open: openProp,
    onOpenChange,
    summaryClassName,
}: {
    summary: ReactNode
    children: ReactNode
    className?: string
    /** For a summary that stands in for a heading („So läuft Teilen ab“) rather than a quiet "show more". */
    summaryClassName?: string
    defaultOpen?: boolean
    /** Kept by the caller instead, to open it when something inside needs attention (a field that is wrong). */
    open?: boolean
    onOpenChange?: (open: boolean) => void
}) {
    const [ownOpen, setOwnOpen] = useState(defaultOpen)
    const open = openProp ?? ownOpen
    // null until measured: an open disclosure then shows its natural height, so `defaultOpen`
    // content is visible in the server HTML instead of clipped to 0 until scripts run.
    const [contentHeight, setContentHeight] = useState<number | null>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const contentId = useId()
    const reducedMotion = usePrefersReducedMotion()

    useEffect(() => {
        const element = contentRef.current
        if (!element) return
        const measure = () => setContentHeight(element.offsetHeight)
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    return (
        <div className={className}>
            <button
                type="button"
                aria-expanded={open}
                aria-controls={contentId}
                onClick={() => {
                    if (openProp === undefined) setOwnOpen(!open)
                    onOpenChange?.(!open)
                }}
                className={cn(
                    'flex items-center gap-1 text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline',
                    summaryClassName,
                )}
            >
                <ChevronDown
                    aria-hidden
                    className={cn('size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')}
                />
                {summary}
            </button>
            <div
                id={contentId}
                inert={!open}
                style={{
                    height: open ? (contentHeight ?? 'auto') : 0,
                    overflow: 'hidden',
                    // No animation before the first measurement, or it would grow from 0 on every load.
                    transition: reducedMotion || contentHeight === null ? 'none' : 'height 200ms ease-out',
                }}
            >
                <div ref={contentRef} className="pt-2">
                    {children}
                </div>
            </div>
        </div>
    )
}
