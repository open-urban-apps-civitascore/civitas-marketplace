'use client'

import { useId, useState, useTransition } from 'react'
import Link from 'next/link'
import { PackagePlus, PenLine } from 'lucide-react'

import { useShareListingReload, useShareView } from '@/components/export/share-listing-provider'
import { ShareRow } from '@/components/export/share-row'
import { EmptyTab } from '@/components/export/share-tab-states'
import { Button, buttonClass, ExternalAnchor } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Notice, Pending } from '@/components/ui/notice'
import { inProgressLinkText } from '@/lib/export/in-progress-items'
import { publishedLine, type PublishedLine } from '@/lib/export/published-lines'
import type { TabRow } from '@/lib/export/share-tabs'
import { withdrawTextEdit } from '@/lib/export/text-edit-actions'
import type { TextEditRef } from '@/lib/export/text-edit'

/** A link inside the marketplace, in the look of `ExternalAnchor` without its ↗. */
const PAGE_LINK = 'font-medium text-primary underline-offset-2 hover:underline'

export function PublishedShares() {
    const view = useShareView(true)
    const reload = useShareListingReload()
    if (view.rows === null) return <Pending>Stand bei GitLab wird abgefragt …</Pending>
    // The dates are told against the reading, so they do not change between two renders.
    const now = view.readAt ? Date.parse(view.readAt) : undefined
    return <Published rows={view.tabs.published} error={view.error} now={now} instance={view.instance} person={view.person} onTextChanged={reload} />
}

export function Published({
    rows,
    error,
    now,
    instance,
    person,
    onTextChanged,
}: {
    rows: TabRow[]
    error?: string
    now?: number
    instance?: string
    person?: string
    onTextChanged?: () => void
}) {
    return (
        <div className="flex flex-col gap-4">
            {error && (
                <Notice tone="error" live>
                    Was im Katalog steht, ließ sich gerade nicht abfragen ({error}).
                </Notice>
            )}
            {rows.length === 0 ? (
                !error && <EmptyTab tab="published" />
            ) : (
                <ul className="flex flex-col gap-4">
                    {rows.map((tabbed) => (
                        <PublishedRow key={tabbed.row.key} line={publishedLine(tabbed, { now, instance, person })} onTextChanged={onTextChanged} />
                    ))}
                </ul>
            )}
        </div>
    )
}

function WithdrawTextChange({ edit, iid, byOther, onDone }: { edit: TextEditRef; iid: number; byOther?: string; onDone?: () => void }) {
    const [asking, setAsking] = useState(false)
    const [problem, setProblem] = useState<string>()
    const [pending, startTransition] = useTransition()
    const titleId = useId()
    const close = () => {
        if (!pending) setAsking(false)
    }
    const withdraw = () =>
        startTransition(async () => {
            const data = new FormData()
            for (const [key, value] of Object.entries(edit)) data.set(key, value)
            try {
                const answer = await withdrawTextEdit(data)
                if (answer.status !== 'ok' && answer.status !== 'unchanged') {
                    setProblem(answer.detail)
                    return
                }
                setAsking(false)
                onDone?.()
            } catch {
                setProblem('Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.')
            }
        })
    return (
        <>
            <Button onClick={() => { setProblem(undefined); setAsking(true) }}>Textänderung zurückziehen</Button>
            <Modal open={asking} onClose={close} labelledBy={titleId} className="max-w-lg">
                <div className="flex flex-col gap-4 p-5">
                    <h2 id={titleId} className="text-lg font-semibold text-foreground">Textänderung zurückziehen?</h2>
                    <p className="text-sm text-muted-foreground">
                        Vorschlag !{iid} wird geschlossen, und der Katalog zeigt weiter den bisherigen Text. Für einen neuen Vorschlag müssen die Texte noch einmal eingetragen werden.
                    </p>
                    {byOther && <Notice tone="neutral">Diesen Vorschlag hat {byOther} eingereicht.</Notice>}
                    {problem && <Notice tone="error" live>{problem}</Notice>}
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button onClick={close} disabled={pending}>Abbrechen</Button>
                        <Button variant="primary" pending={pending} onClick={withdraw}>Textänderung zurückziehen</Button>
                    </div>
                </div>
            </Modal>
        </>
    )
}

export function PublishedRow({ line, onTextChanged }: { line: PublishedLine; onTextChanged?: () => void }) {
    const next = line.next
    return (
        <ShareRow
            title={line.title}
            version={line.version}
            origin={line.facts}
            reasons={line.reasons}
            earlier={line.earlier}
            actions={
                <>
                    <Link href={line.catalogHref} className={`${PAGE_LINK} text-sm`}>
                        Im Katalog ansehen
                    </Link>
                    {line.gitlabHref && (
                        <ExternalAnchor href={line.gitlabHref} className="text-sm">
                            In GitLab ansehen
                        </ExternalAnchor>
                    )}
                    {line.textEdit?.kind === 'offer' && (
                        <Link href={line.textEdit.href} className={buttonClass('secondary')}>
                            <PenLine aria-hidden className="size-4" />
                            Texte ändern
                        </Link>
                    )}
                    {line.textEdit?.kind === 'open' && <WithdrawTextChange edit={line.textEdit.ref} iid={line.textEdit.iid} byOther={line.textEdit.byOther} onDone={onTextChanged} />}
                    {next?.kind === 'new-version' && (
                        <Link href={next.href} className={buttonClass('secondary')}>
                            <PackagePlus aria-hidden className="size-4" />
                            Neue Version teilen
                        </Link>
                    )}
                    {next?.kind === 'newer' && (
                        <Link href={next.href} className={`${PAGE_LINK} text-sm`}>
                            {inProgressLinkText(next.version, next.declined)}
                        </Link>
                    )}
                </>
            }
        />
    )
}
