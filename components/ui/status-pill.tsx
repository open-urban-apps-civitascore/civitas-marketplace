import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * A thing's state next to its name: Aktiv, Freigegeben, Entwurf. Green only for
 * a state that is good news; everything else stays neutral, because colour in
 * this app judges and a version or a count is no judgement.
 *
 * New uses of the green tone pass an `icon`: colour never carries a judgement
 * alone (design system §4.1). Without one, the pill is exactly the installed
 * view's.
 */
export function StatusPill({ tone, icon: Icon, children }: { tone: 'success' | 'muted'; icon?: LucideIcon; children: ReactNode }) {
    const colour =
        tone === 'success'
            ? 'shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-xs text-success dark:bg-success/20'
            : 'shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
    if (!Icon) return <span className={colour}>{children}</span>
    return (
        <span className={`${colour} inline-flex items-center gap-1`}>
            <Icon aria-hidden className="size-3" />
            {children}
        </span>
    )
}
