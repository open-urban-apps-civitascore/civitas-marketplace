'use client'

import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import type { MediaItem } from '@/lib/catalog/types'

/**
 * The screenshot band under the hero, the clickdummy's `UseCaseGallery`: the
 * image alone, paged when there are several. Nothing without screenshots: the
 * hero then carries the illustration instead.
 *
 * Unlike the clickdummy, a screenshot can fail to load here: the catalogue
 * takes any https address, and its first entries point at hosts that do not
 * exist (`musterhausen.example`). Such an image leaves the band instead of
 * showing a broken frame, and when none is left the band shows `fallback`
 * instead (the page passes the illustration, so the page keeps its face).
 *
 * A plain `img`: screenshots come from arbitrary hosts, which the image
 * optimiser would each have to allow.
 */
export function UseCaseGallery({ media, fallback }: { media: MediaItem[]; fallback?: ReactNode }) {
    const [index, setIndex] = useState(0)
    const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
    const images = media.filter((item) => !failed.has(item.src))
    if (images.length === 0) return media.length > 0 ? (fallback ?? null) : null

    const position = Math.min(index, images.length - 1)
    const current = images[position]
    const page = (step: number) => setIndex((position + step + images.length) % images.length)
    const markFailed = (src: string) => setFailed((previous) => (previous.has(src) ? previous : new Set(previous).add(src)))

    return (
        <section aria-label="Screenshots" className="flex flex-col gap-2">
            <figure className="relative overflow-hidden rounded-lg border bg-background">
                {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary hosts, see above */}
                <img
                    key={current.src}
                    src={current.src}
                    alt={current.alt}
                    loading={position === 0 ? 'eager' : 'lazy'}
                    onError={() => markFailed(current.src)}
                    // An image that failed before the page became interactive fired its error unheard.
                    ref={(node) => {
                        if (node?.complete && node.naturalWidth === 0) markFailed(current.src)
                    }}
                    className="aspect-video w-full object-cover object-top"
                />
                {images.length > 1 && (
                    <>
                        <button
                            type="button"
                            aria-label="Vorheriges Bild"
                            onClick={() => page(-1)}
                            className="absolute left-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full border bg-background/85 text-foreground shadow-sm transition-colors hover:bg-background"
                        >
                            <ChevronLeft className="size-5" />
                        </button>
                        <button
                            type="button"
                            aria-label="Nächstes Bild"
                            onClick={() => page(1)}
                            className="absolute right-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full border bg-background/85 text-foreground shadow-sm transition-colors hover:bg-background"
                        >
                            <ChevronRight className="size-5" />
                        </button>
                        <div aria-hidden className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/85 px-2.5 py-1.5 shadow-sm">
                            {images.map((image, dot) => (
                                <span key={image.src} className={`size-2 rounded-full ${dot === position ? 'bg-primary' : 'bg-muted-foreground/35'}`} />
                            ))}
                        </div>
                    </>
                )}
                {current.caption && <figcaption className="sr-only">{current.caption}</figcaption>}
            </figure>
            {images.length > 1 && (
                <p aria-live="polite" className="sr-only">
                    Bild {position + 1} von {images.length}
                    {current.caption ? `: ${current.caption}` : ''}
                </p>
            )}
        </section>
    )
}
