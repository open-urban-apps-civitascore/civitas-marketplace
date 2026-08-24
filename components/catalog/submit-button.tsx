'use client'

import { Loader2, type LucideIcon } from 'lucide-react'

export function SubmitButton({
    pending,
    icon: Icon,
    label,
    pendingLabel,
    disabled = false,
}: {
    pending: boolean
    icon: LucideIcon
    label: string
    pendingLabel: string
    /** Closes the action for reasons of its own — e.g. already installed. */
    disabled?: boolean
}) {
    return (
        <button
            type="submit"
            disabled={pending || disabled}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
            {pending ? pendingLabel : label}
        </button>
    )
}
