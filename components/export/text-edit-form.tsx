'use client'

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode, type Ref } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { inputClass, MetadataForm } from '@/components/export/metadata-form'
import type { Organisation } from '@/lib/catalog/types'
import { useShareListingReload } from '@/components/export/share-listing-provider'
import { Button, ExternalAnchor } from '@/components/ui/button'
import { Section } from '@/components/ui/layout'
import { Notice, type NoticeTone } from '@/components/ui/notice'
import { draftMetadata, parseExportMetadata } from '@/lib/export/metadata'
import type { FilledSteckbrief } from '@/lib/export/new-version'
import { proposeTextEdit, type TextEditResult } from '@/lib/export/text-edit-actions'
import { textChanges, textDraftOf, textReading, type TextChange, type TextEditRef } from '@/lib/export/text-edit'

const TONES: Record<TextEditResult['status'], NoticeTone> = {
    ok: 'success',
    unchanged: 'success',
    'already-open': 'neutral',
    unconfigured: 'neutral',
    forbidden: 'neutral',
    invalid: 'error',
    error: 'error',
}

const NONE = 'Keine Angabe'
const PREVIEW = 'vorschau'

function ChangedText({ label, text, quiet }: { label: string; text: string; quiet?: boolean }) {
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className={`whitespace-pre-line break-words ${quiet ? 'text-muted-foreground' : 'text-foreground'}`}>{text || NONE}</span>
        </div>
    )
}

export function TextEditPreview({
    changes,
    pending,
    answer,
    headingRef,
    onBack,
    onSend,
}: {
    changes: TextChange[]
    pending: boolean
    answer?: ReactNode
    headingRef?: Ref<HTMLHeadingElement>
    onBack: () => void
    onSend: () => void
}) {
    return (
        <div className="flex flex-col gap-6">
            <Section title="Das ändert sich" headingRef={headingRef} lead="Das Katalog-Team prüft den Vorschlag, bevor die neuen Texte im Katalog erscheinen. Dein Name erscheint im öffentlichen Vorschlag bei GitLab.">
                <dl className="flex flex-col gap-5 text-sm">
                    {changes.map((change) => (
                        <div key={change.key} className="flex flex-col gap-1.5">
                            <dt className="font-medium text-foreground">{change.label}</dt>
                            <dd className="grid gap-x-6 gap-y-2 md:grid-cols-2">
                                <ChangedText label="Bisher" text={change.before} quiet />
                                <ChangedText label="Neu" text={change.after} />
                            </dd>
                        </div>
                    ))}
                </dl>
            </Section>
            {changes.some((change) => change.key.startsWith('contact.')) && (
                <Notice tone="neutral">Der neue Kontakt erscheint im Katalog. Im Paket bleibt der bisherige öffentlich lesbar, denn das Paket ändert sich nicht.</Notice>
            )}
            {answer}
            <div className="flex flex-wrap items-center gap-3">
                <Button disabled={pending} onClick={onBack}>Zurück zum Bearbeiten</Button>
                <Button variant="primary" pending={pending} onClick={onSend}>Änderung vorschlagen</Button>
            </div>
        </div>
    )
}

/** The Steckbrief without the package's facts, then what will change before anything is sent. */
export function TextEditForm({ edit, steckbrief, organisations }: { edit: TextEditRef; steckbrief: FilledSteckbrief; organisations: Organisation[] }) {
    const [before] = useState(() => textDraftOf(steckbrief))
    const [draft, setDraft] = useState(before)
    const [result, setResult] = useState<TextEditResult>()
    const [pending, startTransition] = useTransition()
    const reloadListing = useShareListingReload()
    const changes = textChanges(before, draft)
    // In the address, so browser back returns to the fields, not out of the page with what was typed.
    const previewing = useSearchParams().get('step') === PREVIEW && changes.length > 0
    const previewHeading = useRef<HTMLHeadingElement>(null)
    useEffect(() => {
        if (previewing) previewHeading.current?.focus()
    }, [previewing])
    const basics = (key: 'displayName' | 'description' | 'keywords', value: string) => setDraft({ ...draft, [key]: value })

    const showPreview = (event: FormEvent) => {
        event.preventDefault()
        const metadata = parseExportMetadata(JSON.stringify(draftMetadata(draft.metadata)))
        setResult(metadata.error === undefined ? undefined : { status: 'invalid', detail: metadata.error })
        if (metadata.error !== undefined) return
        const query = new URLSearchParams(window.location.search)
        query.set('step', PREVIEW)
        window.history.pushState(null, '', `?${query}`)
    }

    const send = () => {
        startTransition(async () => {
            const data = new FormData()
            for (const [key, value] of Object.entries(edit)) data.set(key, value)
            data.set('displayName', draft.displayName)
            data.set('description', draft.description)
            data.set('keywords', draft.keywords)
            data.set('catalogMetadata', JSON.stringify(draftMetadata(draft.metadata)))
            data.set('basedOn', textReading(before))
            try {
                const answer = await proposeTextEdit(data)
                setResult(answer)
                if (answer.status === 'ok' || answer.status === 'already-open') reloadListing()
            } catch {
                setResult({ status: 'error', detail: 'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.' })
            }
        })
    }

    const answer = result && (
        <Notice tone={TONES[result.status]} live action={result.mrUrl ? <ExternalAnchor href={result.mrUrl}>Vorschlag ansehen</ExternalAnchor> : undefined}>
            {result.detail}
        </Notice>
    )
    if (result?.status === 'ok') {
        return (
            <div className="flex flex-col gap-4">
                {answer}
                <Link href="/export/shared" className="self-start text-sm font-medium text-primary underline-offset-2 hover:underline">Zurück zu „Veröffentlicht“</Link>
            </div>
        )
    }

    if (previewing) {
        return <TextEditPreview changes={changes} pending={pending} answer={answer} headingRef={previewHeading} onBack={() => window.history.back()} onSend={send} />
    }

    return (
        <form className="flex flex-col gap-6" onSubmit={showPreview}>
            <Notice tone="neutral">
                Das Paket bleibt unverändert (Version {edit.version}), ebenso Herausgeber ({steckbrief.maintainer}) und Lizenz ({steckbrief.license}).
                Wer es installiert, bekommt dasselbe wie bisher. Das Katalog-Team prüft die neuen Texte, bevor sie im Katalog erscheinen.
            </Notice>
            <div className="flex flex-col gap-6">
                <section className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2">
                    <h2 className="font-semibold md:col-span-2">Grundangaben</h2>
                    <label className="flex flex-col gap-1 text-sm">
                        <span>Name im Katalog *</span>
                        <input className={inputClass} value={draft.displayName} required onChange={(event) => basics('displayName', event.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                        <span>Schlagworte</span>
                        <input className={inputClass} value={draft.keywords} onChange={(event) => basics('keywords', event.target.value)} />
                        <span className="text-xs text-muted-foreground">Mit Komma trennen.</span>
                    </label>
                    <label className="flex flex-col gap-1 text-sm md:col-span-2">
                        <span>Kurzbeschreibung *</span>
                        <textarea rows={4} className={inputClass} value={draft.description} required onChange={(event) => basics('description', event.target.value)} />
                    </label>
                </section>
                {/* Only listed organisations: a new one comes with a share, whose entry adds it. */}
                <MetadataForm value={draft.metadata} onChange={(metadata) => setDraft({ ...draft, metadata })}
                    organisations={{ listed: organisations, proposals: [], allowNew: false, onPropose: () => {}, publisher: { name: steckbrief.maintainer, code: steckbrief.maintainerOrg ?? '' }, follows: false }} />
            </div>
            {answer}
            <div className="flex flex-wrap items-center gap-3">
                <Link href="/export/shared" className="text-sm font-medium text-primary underline-offset-2 hover:underline">Abbrechen</Link>
                <Button type="submit" variant="primary" disabled={changes.length === 0}>Änderungen ansehen</Button>
                {changes.length === 0 && <span className="text-xs text-muted-foreground">Noch nichts geändert.</span>}
            </div>
        </form>
    )
}
