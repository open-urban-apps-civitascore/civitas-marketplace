import { Boxes, Globe } from 'lucide-react'

import { IconTile } from '@/components/ui/icon-tile'
import { Panel } from '@/components/ui/layout'
import type { PackageApi, PackagePart } from '@/lib/catalog/package-contents'

/** What the standards are, for a reader who does not know the abbreviation. */
const STANDARD_GLOSS: Record<string, string> = {
    OWS: 'Kartendienst (WMS/WFS)',
    STA: 'SensorThings API',
    CUSTOM: 'Eigene Schnittstelle',
}

/**
 * "Schnittstellen": the APIs a package makes reachable once it runs - the
 * visible value of an install that is otherwise plumbing (clickdummy,
 * `ProvidedSurfaces`). Read from the package, so what is listed is what the
 * install creates, not a promise next to it.
 */
export function PackageInterfaces({ apis }: { apis: PackageApi[] }) {
    if (apis.length === 0) return null
    return (
        <Panel title="Schnittstellen" icon={<IconTile icon={Globe} tone="usecase" />}>
            <ul className="flex flex-col">
                {apis.map((api) => (
                    <li key={`${api.standard}:${api.name}`} className="border-b py-3 first:pt-0 last:border-b-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-medium text-foreground">{api.name}</span>
                            <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                                {api.standard}
                            </span>
                            {STANDARD_GLOSS[api.standard] && <span className="text-xs text-muted-foreground">{STANDARD_GLOSS[api.standard]}</span>}
                        </div>
                        {api.description && <p className="mt-1 text-sm text-muted-foreground">{api.description}</p>}
                    </li>
                ))}
            </ul>
        </Panel>
    )
}

/**
 * "Enthaltene Bausteine": every part of the package, one row each, a
 * fixed-width kind badge so the names line up (clickdummy,
 * `IncludedArtifactsSpec`). In the order the data passes them, named as the
 * package names them - the names a person will find in the portal afterwards.
 */
export function PackageParts({ parts }: { parts: PackagePart[] }) {
    if (parts.length === 0) return null
    const total = parts.reduce((count, part) => count + part.names.length, 0)
    return (
        <Panel
            title="Enthaltene Bausteine"
            icon={<IconTile icon={Boxes} tone="usecase" />}
            aside={<span className="text-xs tabular-nums text-muted-foreground">{total}</span>}
        >
            <ul>
                {parts.flatMap((part) =>
                    part.names.map((name, index) => (
                        <li key={`${part.type}:${name}:${index}`} className="flex items-center gap-4 border-b py-2.5 last:border-b-0">
                            <span className="w-32 shrink-0 rounded border bg-muted px-1.5 py-0.5 text-center font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                                {part.one}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{name}</span>
                        </li>
                    )),
                )}
            </ul>
        </Panel>
    )
}

