'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { PackagePlus } from 'lucide-react'

import { useShareView } from '@/components/export/share-listing-provider'
import { ShareRow } from '@/components/export/share-row'
import { elsewhereLine, EmptyTab } from '@/components/export/share-tab-states'
import { Button, buttonClass, ExternalAnchor } from '@/components/ui/button'
import { Notice, Pending } from '@/components/ui/notice'
import { ENDED_PAGE, endedLine, endedRowId, endedWhat, type EndedAction, type EndedLine } from '@/lib/export/ended-lines'
import { inProgressLinkText } from '@/lib/export/in-progress-items'

/** „Beendet“ from the share pages' one listing; a row's action depends on the package's other versions and on „In Arbeit“. */
export function EndedShares() {
    const view = useShareView(true)
    if (view.rows === null) return <Pending>Stand bei GitLab wird abgefragt …</Pending>
    const context = { rows: view.rows, inProgress: view.tabs.inProgress, instance: view.instance }
    const lines = view.tabs.ended.map((entry) => ({ key: entry.key, line: endedLine(entry, context) }))
    return <Ended lines={lines} elsewhere={view.tabs.elsewhere.ended} error={view.error} older={view.older} />
}

/**
 * „Beendet“: one card per ended proposal or version taken out, newest first,
 * {@link ENDED_PAGE} at a time. „Ältere in GitLab ansehen“ only where the listing
 * stopped before the account's oldest proposal (`older`); else nothing older exists.
 */
export function Ended({
    lines,
    elsewhere = 0,
    error,
    older: olderUrl,
}: {
    lines: { key: string; line: EndedLine }[]
    elsewhere?: number
    error?: string
    older?: string
}) {
    const [pages, setPages] = useState(1)
    // The first row „Ältere anzeigen“ added takes the focus, so the keyboard goes on where the list does.
    const focusNext = useRef<string | null>(null)
    useEffect(() => {
        if (!focusNext.current) return
        document.getElementById(focusNext.current)?.focus()
        focusNext.current = null
    }, [pages])

    const shown = lines.slice(0, pages * ENDED_PAGE)
    const more = shown.length < lines.length
    const older = !more ? olderUrl : undefined
    return (
        <div className="flex flex-col gap-4">
            {error && (
                <Notice tone="error" live>
                    Was beendet ist, ließ sich gerade nicht abfragen ({error}).
                </Notice>
            )}
            {lines.length === 0 ? (
                !error && <EmptyTab tab="ended" />
            ) : (
                <ul className="flex flex-col gap-4">
                    {shown.map(({ key, line }, index) => (
                        <EndedRow key={key} id={endedRowId(index)} line={line} />
                    ))}
                </ul>
            )}
            {(more || older) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {more && (
                        <Button
                            onClick={() => {
                                focusNext.current = endedRowId(shown.length)
                                setPages(pages + 1)
                            }}
                        >
                            Ältere anzeigen
                        </Button>
                    )}
                    {older && (
                        <ExternalAnchor href={older} className="text-sm">
                            Ältere in GitLab ansehen
                        </ExternalAnchor>
                    )}
                </div>
            )}
            {elsewhere > 0 && <p className="text-sm text-muted-foreground">{elsewhereLine(elsewhere)}</p>}
        </div>
    )
}

/** One ended proposal as a card; `id` takes the focus after „Ältere anzeigen“. */
export function EndedRow({ id, line }: { id?: string; line: EndedLine }) {
    return (
        <ShareRow
            id={id}
            title={line.title}
            version={line.version}
            origin={line.unknownInstance ? 'Instanz unbekannt' : undefined}
            status={
                <div className="flex flex-col gap-0.5">
                    <p className="text-sm text-foreground">{endedWhat(line)}</p>
                    <p className="text-xs text-muted-foreground">{line.who ? `${line.when} · ${line.who}` : line.when}</p>
                </div>
            }
            reasons={line.reason ? [{ text: line.reason }] : undefined}
            actions={
                <>
                    <ExternalAnchor href={line.url} className="text-sm">
                        In GitLab ansehen
                    </ExternalAnchor>
                    {line.action && <EndedActionLink action={line.action} />}
                </>
            }
        />
    )
}

const ACTION_LABELS: Record<Exclude<EndedAction['kind'], 'in-progress'>, string> = {
    resubmit: 'Erneut einreichen',
    'new-version': 'Neue Version teilen',
}

/** The row's one action: a button into the wizard, or the link to the version's row in „In Arbeit“. */
function EndedActionLink({ action }: { action: EndedAction }) {
    if (action.kind === 'in-progress') {
        return (
            <Link href={action.href} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                {inProgressLinkText(action.version, action.declined)}
            </Link>
        )
    }
    return (
        <Link href={action.href} className={buttonClass('secondary')}>
            <PackagePlus aria-hidden className="size-4" />
            {ACTION_LABELS[action.kind]}
        </Link>
    )
}
