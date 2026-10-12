'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Check, Loader2, Pencil, Send, Sparkles } from 'lucide-react'

import { FEEDBACK_STYLES, feedbackText } from '@/components/catalog/install-button'
import { askAssistant, installProposal } from '@/lib/assistant/actions'
import type { ChatTurn } from '@/lib/assistant/llm'
import type { StructureProposal } from '@/lib/assistant/proposal'
import type { InstallResult } from '@/lib/install-actions'

interface Message {
    role: 'user' | 'assistant'
    text: string
    proposal?: StructureProposal
    error?: string
}

const EXAMPLES = [
    'Welche Use Cases gibt es zum Thema Verkehr?',
    'Wir messen an 40 Standorten Temperatur und Feinstaub, alle zehn Minuten per MQTT. Lege dafür eine eigene Datenstruktur an.',
]

/** The conversation as the model reads it; a proposal travels along so a follow-up can change it. */
function asTurns(messages: Message[]): ChatTurn[] {
    return messages.map((message) => {
        const parts = [message.text]
        if (message.proposal) parts.push(`[Vorschlag: ${JSON.stringify(message.proposal)}]`)
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
                { role: 'assistant', text: reply.text, proposal: reply.proposal, error: reply.error },
            ])
        })
    }

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
                                {message.text && <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>}
                                {message.error && <p className="text-xs text-error">{message.error}</p>}
                            </div>
                        </div>
                        {message.proposal && (
                            <ProposalCard
                                proposal={message.proposal}
                                onAdjust={() => setInput('Ändere den Plan: ')}
                            />
                        )}
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
                    placeholder="Beschreiben, was gemessen wird, oder nach dem Katalog fragen … (Diktat: zweimal Fn)"
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

function ProposalCard({ proposal, onAdjust }: { proposal: StructureProposal; onAdjust: () => void }) {
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
                {!done && (
                    <button
                        type="button"
                        onClick={onAdjust}
                        disabled={installing}
                        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                    >
                        <Pencil className="size-4" />
                        Anpassen
                    </button>
                )}
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
