import { Boxes, Layers } from 'lucide-react'

import type { CatalogManifest } from '@/lib/catalog/types'

const TYPE_LABEL: Record<CatalogManifest['type'], string> = {
    datastructure: 'Datenstruktur',
    usecase: 'Use Case',
}

/**
 * One catalogue entry as a card. Keeps the visual language of the prototype
 * (illustration strip, category chip, footer meta) but stays type-agnostic —
 * both use cases and data structures render through it.
 */
export function CatalogCard({
    manifest,
    action,
    badge,
}: {
    manifest: CatalogManifest
    action?: React.ReactNode
    /** Optional state marker, rendered bottom right next to the action. */
    badge?: React.ReactNode
}) {
    const Icon = manifest.type === 'usecase' ? Boxes : Layers

    return (
        <article className="flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-[box-shadow,border-color] hover:border-ring hover:shadow-md">
            <div className="relative flex h-24 items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5 dark:from-primary/20 dark:to-primary/10">
                <Icon className="size-9 text-primary/70" />
                <span className="absolute left-3 top-3 inline-flex items-center rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-primary shadow-sm">
                    {TYPE_LABEL[manifest.type]}
                </span>
            </div>

            <div className="flex flex-1 flex-col p-5">
                <h3 className="text-lg font-semibold leading-tight text-foreground">
                    {manifest.displayName}
                </h3>
                <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                    {manifest.description}
                </p>

                {manifest.keywords.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {manifest.keywords.map((keyword) => (
                            <span
                                key={keyword}
                                className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                            >
                                {keyword}
                            </span>
                        ))}
                    </div>
                )}

                <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
                    <span className="truncate text-sm text-muted-foreground">
                        {manifest.maintainer} · v{manifest.version}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                        {manifest.license}
                    </span>
                </div>

                {(action || badge) && (
                    <div className="mt-4 flex items-start gap-3">
                        {action}
                        {badge && <div className="ml-auto shrink-0">{badge}</div>}
                    </div>
                )}
            </div>
        </article>
    )
}
