import { CloudOff, FlaskConical, RefreshCw } from 'lucide-react'

import type { CatalogMeta } from '@/lib/catalog/types'
import { pauseText } from '@/lib/gitlab-gate'

const TIME_FORMAT = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
})

/**
 * One line of honesty about where the catalogue is coming from and how fresh
 * it is — so an empty or outdated list is never mistaken for the real state.
 */
export function CatalogFreshness({ meta }: { meta: CatalogMeta }) {
    if (meta.origin === 'mock') {
        return (
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <FlaskConical className="size-3.5 shrink-0" />
                Demo-Katalog aus lokalen Fixtures — keine Katalog-Quelle konfiguriert
                (REPO_LIST_URL).
            </p>
        )
    }

    const paused = meta.pausedUntil ? pauseText(meta.pausedUntil.getTime()) : undefined

    if (meta.origin === 'unconfigured' || meta.origin === 'unreachable') {
        return (
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive">
                <CloudOff className="size-3.5 shrink-0" />
                {paused ? `${paused} Bis dahin ist der Katalog leer.` : 'Katalog-Quelle nicht erreichbar — der Katalog ist derzeit leer.'}
            </p>
        )
    }

    return (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {meta.stale ? (
                <>
                    <CloudOff className="size-3.5 shrink-0" />
                    <span className="font-medium">
                        {paused ? `${paused} Letzter bekannter Stand:` : 'Katalog-Quelle nicht erreichbar — letzter bekannter Stand:'}
                    </span>
                </>
            ) : (
                <RefreshCw className="size-3.5 shrink-0" />
            )}
            Katalog v{meta.version} · geladen {TIME_FORMAT.format(meta.fetchedAt)}
        </p>
    )
}
