import type { ReactNode } from 'react'

/**
 * A thing's state next to its name: Aktiv, Freigegeben, Entwurf. Green only for
 * a state that is good news; everything else stays neutral, because colour in
 * this app judges and a version or a count is no judgement.
 */
export function StatusPill({ tone, children }: { tone: 'success' | 'muted'; children: ReactNode }) {
    return (
        <span
            className={
                tone === 'success'
                    ? 'shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-xs text-success dark:bg-success/20'
                    : 'shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
            }
        >
            {children}
        </span>
    )
}
