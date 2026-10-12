'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, Loader2, Pencil, Send, Sparkles } from 'lucide-react'

import { FEEDBACK_STYLES, feedbackText } from '@/components/catalog/install-button'
import { InstallDialog } from '@/components/catalog/install-dialog'
import { SamplePreview } from '@/components/catalog/sample-preview'
import {
    askAssistant,
    installProposal,
    loadInstallOptions,
    type InstallOptions,
    type UseCasePlan,
} from '@/lib/assistant/actions'
import type { ChatTurn } from '@/lib/assistant/llm'
import type { StructureProposal } from '@/lib/assistant/proposal'
import type { InstallResult } from '@/lib/install-actions'

interface Message {
    role: 'user' | 'assistant'
    text: string
    structure?: StructureProposal
    useCase?: UseCasePlan
    /** What the assistant looked up before answering. */
    lookups?: string[]
    error?: string
}

const EXAMPLES = [
    'Welche Use Cases gibt es zum Thema Verkehr?',
    'Was ist in unserer Instanz schon installiert, und in welchen Datenpools?',
    'Bau etwas wie die Verkehrszählung, aber für Lärmmessung an Schulen.',
    'Wir messen an 40 Standorten Temperatur und Feinstaub, alle zehn Minuten per MQTT. Setz das als eigenen Anwendungsfall um.',
    'Wir wollen die Füllstände unserer Altglascontainer erfassen, die Sensoren melden stündlich per MQTT.',
]

/** The conversation as the model reads it; a plan travels along so a follow-up can change it. */
function asTurns(messages: Message[]): ChatTurn[] {
    return messages.map((message) => {
        const parts = [message.text]
        if (message.structure) parts.push(`[Vorschlag Datenstruktur: ${JSON.stringify(message.structure)}]`)
        if (message.useCase) parts.push(`[Vorschlag Anwendungsfall: ${JSON.stringify(message.useCase.proposal)}]`)
        if (message.error) parts.push(`[Fehler: ${message.error}]`)
        const content = parts.filter(Boolean).join('\n\n')
        return { role: message.role, content: content || '(leer)' }
    })
}

export function AssistantChat() {
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [pending, startTransition] = useTransition()

    function send(text: string) {
        const trimmed = text.trim()
        if (!trimmed || pending) return
        const next: Message[] = [...messages, { role: 'user', text: trimmed }]
        setMessages(next)
        setInput('')
        startTransition(async () => {
            const reply = await askAssistant(asTurns(next))
            setMessages((current) => [
                ...current,
                {
                    role: 'assistant',
                    text: reply.text,
                    structure: reply.structure,
                    useCase: reply.useCase,
                    lookups: reply.lookups,
                    error: reply.error,
                },
            ])
        })
    }

    const adjust = () => setInput('Ändere den Plan: ')

    return (
        <div className="flex max-w-3xl flex-col gap-4">
            {messages.length === 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Beispiele</p>
                    {EXAMPLES.map((example) => (
                        <button
                            key={example}
                            type="button"
                            onClick={() => send(example)}
                            className="rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                        >
                            {example}
                        </button>
                    ))}
                </div>
            )}

            {messages.map((message, index) =>
                message.role === 'user' ? (
                    <div key={index} className="self-end rounded-lg bg-muted px-4 py-3 text-sm whitespace-pre-wrap">
                        {message.text}
                    </div>
                ) : (
                    <div key={index} className="flex flex-col gap-3">
                        <div className="flex items-start gap-2 text-sm">
                            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                            <div className="flex flex-col gap-1">
                                {message.lookups && message.lookups.length > 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        Nachgeschlagen: {message.lookups.join(', ')}
                                    </p>
                                )}
                                {message.text && <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>}
                                {message.error && <p className="text-xs text-error">{message.error}</p>}
                            </div>
                        </div>
                        {message.structure && <StructureCard proposal={message.structure} onAdjust={adjust} />}
                        {message.useCase && <UseCaseCard plan={message.useCase} onAdjust={adjust} />}
                    </div>
                ),
            )}

            {pending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Denkt nach …
                </div>
            )}

            <form
                onSubmit={(event) => {
                    event.preventDefault()
                    send(input)
                }}
                className="flex items-end gap-2"
            >
                <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault()
                            send(input)
                        }
                    }}
                    rows={3}
                    placeholder="Beschreiben, was gemessen wird, oder nach dem Katalog fragen …"
                    className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm"
                />
                <button
                    type="submit"
                    disabled={pending || !input.trim()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                    <Send className="size-4" />
                    Senden
                </button>
            </form>
        </div>
    )
}

function AdjustButton({ onAdjust }: { onAdjust: () => void }) {
    return (
        <button
            type="button"
            onClick={onAdjust}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
            <Pencil className="size-4" />
            Anpassen
        </button>
    )
}

/** A whole use case: the steps the install will take, then the marketplace's own install dialog. */
function UseCaseCard({ plan, onAdjust }: { plan: UseCasePlan; onAdjust: () => void }) {
    const [options, setOptions] = useState<InstallOptions | null>(null)
    const [optionsError, setOptionsError] = useState<string | null>(null)
    const [showFields, setShowFields] = useState(false)

    useEffect(() => {
        loadInstallOptions()
            .then(setOptions)
            .catch((error: unknown) => setOptionsError(error instanceof Error ? error.message : String(error)))
    }, [])

    const { proposal, steps } = plan

    return (
        <div className="ml-6 flex flex-col gap-4 rounded-lg border p-4">
            <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                    Vorschlag · {steps.length} Schritte
                </p>
                <h3 className="mt-1 text-base font-semibold">{proposal.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{proposal.description}</p>
            </div>

            <ol className="flex flex-col gap-2">
                {steps.map((step, index) => (
                    <li key={index} className="flex items-start gap-3 text-sm">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                            {index + 1}
                        </span>
                        <span>
                            <span className="font-medium">{step.kind}</span> „{step.title}“
                            <span className="block text-xs text-muted-foreground">{step.detail}</span>
                        </span>
                    </li>
                ))}
            </ol>

            <div>
                <button
                    type="button"
                    onClick={() => setShowFields((open) => !open)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                    <ChevronDown className={`size-3.5 transition-transform ${showFields ? 'rotate-180' : ''}`} />
                    Felder der Nachricht „{proposal.messageName}“
                </button>
                {showFields && (
                    <table className="mt-2 w-full text-xs">
                        <tbody>
                            {proposal.fields.map((field) => (
                                <tr key={field.name} className="border-t">
                                    <td className="py-1 pr-3 font-mono">{field.name}</td>
                                    <td className="py-1 pr-3 text-muted-foreground">
                                        {field.dateTime ? 'Zeitpunkt' : field.type}
                                        {field.required ? ' · Pflicht' : ''}
                                    </td>
                                    <td className="py-1 pr-3">{field.description}</td>
                                    <td className="py-1 text-muted-foreground">{field.generator.kind}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <div className="flex flex-wrap items-start gap-2">
                {options ? (
                    <InstallDialog
                        entryId={plan.entryId}
                        displayName={plan.title}
                        version={plan.version}
                        demoAvailable={options.demoAvailable}
                        datapools={options.datapools}
                        datapoolProblem={options.datapoolProblem}
                        canCreateDatapool={options.canCreateDatapool}
                        triggerLabel="Plan bestätigen …"
                        datapoolNamePrefix="[AI-Assistant] "
                    />
                ) : (
                    <span className="inline-flex items-center gap-1.5 px-1 py-1.5 text-xs text-muted-foreground">
                        {optionsError ? (
                            <span className="text-error">{optionsError}</span>
                        ) : (
                            <>
                                <Loader2 className="size-3.5 animate-spin" /> Lade Datenpools …
                            </>
                        )}
                    </span>
                )}
                {options?.demoAvailable && <SamplePreview entryId={plan.entryId} displayName={plan.title} />}
                <AdjustButton onAdjust={onAdjust} />
            </div>
        </div>
    )
}

/** A data structure on its own: installed directly, it needs no datapool. */
function StructureCard({ proposal, onAdjust }: { proposal: StructureProposal; onAdjust: () => void }) {
    const [result, setResult] = useState<InstallResult | null>(null)
    const [installing, startInstall] = useTransition()
    const done = result?.status === 'created'

    return (
        <div className="ml-6 flex flex-col gap-4 rounded-lg border p-4">
            <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                    Vorschlag · Datenstruktur mit {proposal.objects.length} Objekt
                    {proposal.objects.length === 1 ? '' : 'en'}
                </p>
                <h3 className="mt-1 text-base font-semibold">{proposal.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{proposal.description}</p>
            </div>

            {proposal.objects.map((object) => (
                <div key={object.name} className="flex flex-col gap-1">
                    <p className="text-sm font-medium">
                        {object.name}
                        {object.description && (
                            <span className="font-normal text-muted-foreground"> · {object.description}</span>
                        )}
                    </p>
                    <table className="w-full text-xs">
                        <tbody>
                            {object.fields.map((field) => (
                                <tr key={field.name} className="border-t">
                                    <td className="py-1 pr-3 font-mono">{field.name}</td>
                                    <td className="py-1 pr-3 text-muted-foreground">
                                        {field.dateTime ? 'Zeitpunkt' : field.type}
                                        {field.required ? ' · Pflicht' : ''}
                                    </td>
                                    <td className="py-1">{field.description}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}

            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    disabled={installing || done}
                    onClick={() => startInstall(async () => setResult(await installProposal(proposal)))}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                    {installing ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    {installing ? 'Lege an …' : done ? 'Angelegt' : 'Plan bestätigen'}
                </button>
                {!done && <AdjustButton onAdjust={onAdjust} />}
            </div>

            {result && (
                <p className={`text-xs leading-relaxed ${FEEDBACK_STYLES[result.status]}`}>
                    {feedbackText(result)}
                    {done && (
                        <>
                            {' '}
                            <Link href="/installed" className="underline">
                                Zu den Installationen
                            </Link>
                        </>
                    )}
                </p>
            )}
        </div>
    )
}
