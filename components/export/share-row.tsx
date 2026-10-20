import type { ReactNode } from 'react'
import { CircleX, Info, LayoutGrid, Undo2, type LucideIcon } from 'lucide-react'

import { ShareTrack } from '@/components/export/share-track'
import { ExternalAnchor } from '@/components/ui/button'
import { IconTile } from '@/components/ui/icon-tile'
import type { RowStatus, TrackStep } from '@/lib/export/in-progress-items'
import { cn } from '@/lib/utils'
import type { Tone } from '@/lib/ui/tones'

/**
 * One shared version, or one started share, as a card (E3) in the lists of
 * "Teilen" (plan of 2026-10-18, section 4): the icon tile in the colour of
 * what it becomes, the name and „Version x“, where it came from, the progress
 * line with its status sentence, earlier versions, and the actions on the
 * right. Results of an action come in as `children`, inside the card they
 * are about.
 *
 * The actions follow the sentence in the page, so a screen reader hears
 * where a share stands before what can be done about it; from tablet width
 * on they stand on the right.
 *
 * Server-safe: no hooks; the list passes its buttons in.
 */
export function ShareRow({
    title,
    version,
    origin,
    track,
    status,
    earlier,
    actions,
    kind = { icon: LayoutGrid, tone: 'usecase' },
    children,
}: {
    title: string
    version?: string
    /** „aus Datensatz „X“ · eingereicht am 12.10. von Ewa“ */
    origin?: string
    track?: TrackStep[]
    /** The status sentence, or something in its place (the row is read again). */
    status: ReactNode
    /** „Frühere Versionen: …“ */
    earlier?: string
    actions?: ReactNode
    /** What it becomes in the catalogue: a dataset becomes an Anwendungsfall (green), a data structure stays one (blue). */
    kind?: { icon: LucideIcon; tone: Tone }
    children?: ReactNode
}) {
    return (
        <li className="flex flex-col gap-3 rounded-lg border bg-card p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6">
                <div className="flex min-w-0 items-start gap-3">
                    <IconTile icon={kind.icon} tone={kind.tone} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <h3 className="hyphens-auto break-words text-sm font-semibold text-foreground">
                            {title}
                            {version && <span className="font-normal text-muted-foreground"> Version {version}</span>}
                        </h3>
                        {origin && <p className="break-words text-xs text-muted-foreground">{origin}</p>}
                    </div>
                </div>
                <div className="flex min-w-0 flex-col gap-2 sm:pl-10">
                    {track && <ShareTrack steps={track} />}
                    {status}
                    {earlier && <p className="text-xs text-muted-foreground">{earlier}</p>}
                </div>
                {actions && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-end sm:self-start">
                        {actions}
                    </div>
                )}
            </div>
            {children}
        </li>
    )
}

const STATUS_MARK: Partial<Record<RowStatus['tone'], { icon: LucideIcon; className: string }>> = {
    neutral: { icon: Info, className: 'text-muted-foreground' },
    error: { icon: CircleX, className: 'text-error' },
    removal: { icon: Undo2, className: 'text-muted-foreground' },
}

/** The one sentence that says where a share stands; on a row without a progress line, with the icon of its kind. */
export function StatusLine({ status }: { status: RowStatus }) {
    const mark = STATUS_MARK[status.tone]
    const Icon = mark?.icon
    return (
        <p className="flex gap-2 text-sm leading-relaxed text-foreground">
            {Icon && <Icon aria-hidden className={cn('mt-1 size-4 shrink-0', mark.className)} />}
            <span className="min-w-0 break-words">
                {status.text}
                {status.link && (
                    <>
                        {' '}
                        <ExternalAnchor href={status.link.href}>{status.link.label}</ExternalAnchor>
                    </>
                )}
            </span>
        </p>
    )
}
