import type { ReactNode } from 'react'
import { CircleX, Info, LayoutGrid, Undo2, type LucideIcon } from 'lucide-react'

import { ShareTrack } from '@/components/export/share-track'
import { ExternalAnchor } from '@/components/ui/button'
import { IconTile } from '@/components/ui/icon-tile'
import type { ReasonLine, RowStatus, TrackStep } from '@/lib/export/in-progress-items'
import { cn } from '@/lib/utils'
import type { Tone } from '@/lib/ui/tones'

/** Server-safe, no hooks. Actions follow the status in the DOM, so screen readers hear the state first. */
export function ShareRow({
    id,
    title,
    version,
    origin,
    track,
    status,
    reasons,
    earlier,
    actions,
    kind = { icon: LayoutGrid, tone: 'usecase' },
    titleAs: Title = 'h3',
    children,
}: {
    id?: string
    title: string
    version?: string
    origin?: string
    track?: TrackStep[]
    status?: ReactNode
    reasons?: ReasonLine[]
    earlier?: string
    actions?: ReactNode
    kind?: { icon: LucideIcon; tone: Tone }
    titleAs?: 'h3' | 'h4'
    children?: ReactNode
}) {
    // Left out when empty: an empty cell adds a gap at phone width.
    const middle = Boolean(track || status || reasons?.length || earlier)
    return (
        // Focusable, so a link to the row moves the focus there, not to the top of the page.
        <li
            id={id}
            tabIndex={id ? -1 : undefined}
            className="flex flex-col gap-3 rounded-lg border bg-card p-5 scroll-mt-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
            {/* Actions take at most half the card, so the name keeps room. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_fit-content(50%)] sm:gap-x-6">
                <div className="flex min-w-0 items-start gap-3">
                    <IconTile icon={kind.icon} tone={kind.tone} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <Title className="hyphens-auto break-words text-sm font-semibold text-foreground">
                            {title}
                            {version && <span className="font-normal text-muted-foreground"> Version {version}</span>}
                        </Title>
                        {origin && <p className="break-words text-xs text-muted-foreground">{origin}</p>}
                    </div>
                </div>
                {middle && (
                    <div className="flex min-w-0 flex-col gap-2 sm:pl-10">
                        {track && <ShareTrack steps={track} />}
                        {status}
                        {reasons?.map((reason) => <ReasonText key={reason.text} reason={reason} />)}
                        {earlier && <p className="text-xs text-muted-foreground">{earlier}</p>}
                    </div>
                )}
                {actions && (
                    <div
                        className={cn(
                            'flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-start-2 sm:row-start-1 sm:justify-end sm:self-start',
                            middle && 'sm:row-span-2',
                        )}
                    >
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

function ReasonText({ reason }: { reason: ReasonLine }) {
    return (
        <p className="break-words text-sm leading-relaxed text-foreground">
            {reason.text}
            {reason.link && (
                <>
                    {' '}
                    <ExternalAnchor href={reason.link.href}>
                        {reason.link.label}
                        {reason.link.heard && <span className="sr-only">{reason.link.heard}</span>}
                    </ExternalAnchor>
                </>
            )}
        </p>
    )
}

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
