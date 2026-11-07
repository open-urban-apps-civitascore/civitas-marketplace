'use client'

import { useState, useTransition, type FormEvent } from 'react'
import Link from 'next/link'

import { inputClass, MetadataForm } from '@/components/export/metadata-form'
import { useShareListingReload } from '@/components/export/share-listing-provider'
import { Button, ExternalAnchor } from '@/components/ui/button'
import { Section } from '@/components/ui/layout'
import { Notice, type NoticeTone } from '@/components/ui/notice'
import { draftMetadata } from '@/lib/export/metadata'
import type { FilledSteckbrief } from '@/lib/export/new-version'
import { proposeTextEdit, type TextEditResult } from '@/lib/export/text-edit-actions'
import { textChanges, textDraftOf, textReading, type TextEditRef } from '@/lib/export/text-edit'

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

/** The Steckbrief without the package's facts; one page, so what will change stays beside what was typed. */
export function TextEditForm({ edit, steckbrief }: { edit: TextEditRef; steckbrief: FilledSteckbrief }) {
    const [before] = useState(() => textDraftOf(steckbrief))
    const [draft, setDraft] = useState(before)
    const [result, setResult] = useState<TextEditResult>()
    const [pending, startTransition] = useTransition()
    const reloadListing = useShareListingReload()
    const changes = textChanges(before, draft)
    const basics = (key: 'displayName' | 'description' | 'keywords', value: string) => setDraft({ ...draft, [key]: value })

    const submit = (event: FormEvent) => {
        event.preventDefault()
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

    return (
        <form className="flex flex-col gap-6" onSubmit={submit}>
            <Notice tone="neutral">
                Das Paket bleibt unverändert (Version {edit.version}), ebenso Herausgeber ({steckbrief.maintainer}) und Lizenz ({steckbrief.license}).
                Wer es installiert, bekommt dasselbe wie bisher. Das Katalog-Team prüft die neuen Texte, bevor sie im Katalog erscheinen.
            </Notice>
            <fieldset disabled={pending} className="flex flex-col gap-6 disabled:opacity-60">
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
                <MetadataForm value={draft.metadata} onChange={(metadata) => setDraft({ ...draft, metadata })} />
            </fieldset>

            {changes.length > 0 && (
                <Section title="Das ändert sich">
                    <dl className="flex flex-col gap-4 text-sm">
                        {changes.map((change) => (
                            <div key={change.key} className="flex flex-col gap-1">
                                <dt className="font-medium text-foreground">{change.label}</dt>
                                <dd className="break-words text-muted-foreground">Bisher: {change.before || NONE}</dd>
                                <dd className="break-words text-foreground">Neu: {change.after || NONE}</dd>
                            </div>
                        ))}
                    </dl>
                </Section>
            )}
            {changes.some((change) => change.key.startsWith('contact.')) && (
                <Notice tone="neutral">Der neue Kontakt erscheint im Katalog. Im Paket bleibt der bisherige öffentlich lesbar, denn das Paket ändert sich nicht.</Notice>
            )}
            {answer}
            <div className="flex flex-wrap items-center gap-3">
                <Link href="/export/shared" className="text-sm font-medium text-primary underline-offset-2 hover:underline">Abbrechen</Link>
                <Button type="submit" variant="primary" pending={pending} disabled={changes.length === 0}>Änderung vorschlagen</Button>
                {changes.length === 0 && <span className="text-xs text-muted-foreground">Noch nichts geändert.</span>}
            </div>
        </form>
    )
}
