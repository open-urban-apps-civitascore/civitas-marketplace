import { Fragment } from 'react'
import Link from 'next/link'

import { InlineNotice, Notice, Pending } from '@/components/ui/notice'
import { IN_PROGRESS_PATH } from '@/lib/export/in-progress-items'
import type { StageNotice } from '@/lib/export/new-version'
import type { busyOptions, ListingState } from '@/lib/export/source-options'

const linkClass = 'font-medium text-primary underline-offset-2 hover:underline'

export function ListingLine({ listing }: { listing?: ListingState }) {
    if (listing?.state === 'loading') return <Pending>Stand wird abgefragt …</Pending>
    if (listing?.state === 'failed') {
        return <InlineNotice tone="neutral">Ob schon etwas in Arbeit ist, ließ sich gerade nicht abfragen - beim Einreichen wird es noch einmal geprüft.</InlineNotice>
    }
    return null
}

/** Says why options are greyed out, as a disabled option shows no tooltip. */
export function BusySentence({ options }: { options: ReturnType<typeof busyOptions> }) {
    if (!options.length) return null
    return (
        <p className="text-sm text-muted-foreground">
            Nicht wählbar, weil gerade in Arbeit:{' '}
            {options.map((option, index) => (
                <Fragment key={option.value}>
                    {index > 0 && ', '}
                    <Link href={option.busy.href} className={linkClass}>
                        {option.label}
                    </Link>{' '}
                    ({option.busy.versions})
                </Fragment>
            ))}
            . Weiter geht es unter{' '}
            <Link href={IN_PROGRESS_PATH} className={linkClass}>
                „In Arbeit“
            </Link>
            .
        </p>
    )
}

export function InProgressLink() {
    return (
        <Link href={IN_PROGRESS_PATH} className={linkClass}>
            Zu „In Arbeit“
        </Link>
    )
}

export function StageNoticeView({ notice }: { notice: StageNotice }) {
    return (
        <Notice
            tone="neutral"
            action={
                notice.link ? (
                    <Link href={notice.link.href} className={linkClass}>
                        {notice.link.label}
                    </Link>
                ) : undefined
            }
        >
            {notice.text}
        </Notice>
    )
}
