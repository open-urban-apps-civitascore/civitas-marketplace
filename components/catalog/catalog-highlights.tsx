import Link from 'next/link'
import { ArrowRight, Blocks, Database, LayoutGrid, type LucideIcon } from 'lucide-react'

import { IconTile } from '@/components/ui/icon-tile'
import { Panel } from '@/components/ui/layout'
import type { CatalogKind, CatalogKindPreview } from '@/lib/catalog/highlights'
import type { Tone } from '@/lib/ui/tones'

/** The kinds' identity colours (design system §4.2), on the icon tile only. */
const KIND: Record<CatalogKind, { icon: LucideIcon; tone: Tone }> = {
    'use-case': { icon: LayoutGrid, tone: 'usecase' },
    addon: { icon: Blocks, tone: 'addon' },
    'data-structure': { icon: Database, tone: 'datastructure' },
}

/**
 * One panel per catalogue section, the clickdummy's `RecentlyAdded`: per
 * section rather than one mixed list, so each section shows for itself
 * whether anything is in it. A row carries enough to decide whether to click:
 * title, what it is in one line, who stands behind it.
 */
export function CatalogHighlights({ sections, heading }: { sections: (CatalogKindPreview & { hint: string })[]; heading: string }) {
    if (sections.every((section) => section.total === 0)) return null

    return (
        <section aria-labelledby="im-katalog-heading" className="mt-6">
            <h2 id="im-katalog-heading" className="text-xl font-semibold text-foreground">
                {heading}
            </h2>

            <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
                {sections.map((section) => (
                    <Panel
                        key={section.kind}
                        title={section.label}
                        icon={<IconTile icon={KIND[section.kind].icon} tone={KIND[section.kind].tone} />}
                        aside={<span className="text-xs tabular-nums text-muted-foreground">{section.total}</span>}
                        footer={
                            <Link href={section.href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                                Alle {section.label}
                                <ArrowRight aria-hidden className="size-3.5" />
                            </Link>
                        }
                    >
                        <p className="text-sm leading-relaxed text-muted-foreground">{section.hint}</p>
                        {section.entries.length > 0 ? (
                            <ul className="divide-y border-t">
                                {section.entries.map((entry) => (
                                    <li key={entry.id}>
                                        <Link href={entry.href} className="group flex flex-col gap-1 py-3">
                                            <span className="text-sm font-semibold leading-snug text-foreground group-hover:text-primary">
                                                {entry.title}
                                            </span>
                                            <span className="line-clamp-1 text-xs leading-relaxed text-muted-foreground">{entry.summary}</span>
                                            <span className="text-xs text-muted-foreground">{entry.meta}</span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            // An empty section says something true rather than vanishing.
                            <p className="border-t py-3 text-sm text-muted-foreground">Noch nichts eingetragen.</p>
                        )}
                    </Panel>
                ))}
            </div>
        </section>
    )
}
