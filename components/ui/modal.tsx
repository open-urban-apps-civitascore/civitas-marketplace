'use client'

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A dialog over the page, ported from the clickdummy: `role="dialog"` with
 * `aria-modal`, focus moves into it on open and back to where it was on close,
 * Tab stays inside, Escape and a click on the backdrop close it, and the page
 * behind does not scroll.
 *
 * No portal: the app frame has no transformed ancestor, so `fixed` is reliable.
 */
export function Modal({
    open,
    onClose,
    labelledBy,
    className,
    children,
}: {
    open: boolean
    onClose: () => void
    /** Id of the element that names the dialog (aria-labelledby). */
    labelledBy: string
    className?: string
    children: ReactNode
}) {
    const dialogRef = useRef<HTMLDivElement>(null)
    const restoreFocusRef = useRef<HTMLElement | null>(null)

    useEffect(() => {
        if (!open) return
        restoreFocusRef.current = document.activeElement as HTMLElement | null
        dialogRef.current?.focus()
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = previousOverflow
            restoreFocusRef.current?.focus()
        }
    }, [open])

    if (!open) return null

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
            return
        }
        if (event.key !== 'Tab' || !dialogRef.current) return
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
            event.preventDefault()
            last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div aria-hidden className="absolute inset-0 bg-foreground/40" onClick={onClose} />
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                tabIndex={-1}
                onKeyDown={handleKeyDown}
                className={`relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-card shadow-xl outline-none ${className ?? ''}`}
            >
                {children}
            </div>
        </div>
    )
}
