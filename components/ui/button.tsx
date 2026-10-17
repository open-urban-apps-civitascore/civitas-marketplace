import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ExternalLink, Loader2, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * One button recipe. `primary` is the one main action of a surface - never
 * two next to each other; `secondary` is every other action; `ghost` is a
 * quiet text action ("Erneut prüfen", "Anderen Datensatz wählen"); `danger`
 * confirms something that cannot be taken back, in the red outline the
 * uninstall button wears.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BASE = 'inline-flex items-center gap-1.5 rounded-md text-sm font-medium transition-opacity disabled:opacity-50'
const VARIANTS: Record<ButtonVariant, string> = {
    primary: 'bg-primary px-3 py-1.5 text-primary-foreground hover:opacity-90',
    secondary: 'border px-3 py-1.5 text-foreground hover:bg-muted',
    ghost: 'px-0 py-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline',
    danger: 'border border-error/40 px-3 py-1.5 text-error hover:bg-error/5 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:hover:bg-error/20 dark:disabled:hover:bg-transparent',
}

/** The classes, for a link that has to look like a button. */
export function buttonClass(variant: ButtonVariant): string {
    return `${BASE} ${VARIANTS[variant]}`
}

/**
 * A button that shows its own work: while `pending`, its icon turns into a
 * spinner and it cannot be clicked again. Server-safe: no hooks.
 */
export function Button({
    variant = 'secondary',
    icon: Icon,
    pending = false,
    className,
    disabled,
    type = 'button',
    children,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant
    icon?: LucideIcon
    pending?: boolean
}) {
    return (
        <button {...props} type={type} disabled={disabled || pending} aria-busy={pending || undefined} className={cn(buttonClass(variant), className)}>
            {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : Icon && <Icon aria-hidden className="size-4" />}
            {children}
        </button>
    )
}

/** A link that opens somewhere else: the portal, GitLab, the simulator. Always a new tab, always the ↗ mark. */
export function ExternalAnchor({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
    return (
        <a href={href} target="_blank" rel="noreferrer" className={cn('inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline', className)}>
            {children}
            <ExternalLink aria-hidden className="size-3 shrink-0" />
        </a>
    )
}
