'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isToolUIPart, type UIMessage } from 'ai'
import { Check, ChevronDown, ExternalLink, Loader2, Pencil, Search, Send, Sparkles, Wand2 } from 'lucide-react'

import { ChatMarkdown } from '@/components/assistant/chat-markdown'
import { FEEDBACK_STYLES, feedbackText } from '@/components/catalog/install-button'
import { InstallDialog } from '@/components/catalog/install-dialog'
import { SamplePreview } from '@/components/catalog/sample-preview'
import { installProposal, loadInstallOptions, type InstallOptions } from '@/lib/assistant/actions'
import { describeGenerator } from '@/lib/assistant/describe'
import type { StructureProposal } from '@/lib/assistant/proposal'
import {
    READ_TOOL_LABELS,
    type Recommendation,
    type RecommendationToolOutput,
    type StructureToolOutput,
    type UseCasePlan,
    type UseCaseToolOutput,
} from '@/lib/assistant/types'
import type { InstallResult } from '@/lib/install-actions'

const transport = new DefaultChatTransport({ api: '/api/assistant' })

const EXAMPLES = [
    'Welche Use Cases gibt es zum Thema Verkehr?',
    'Was ist in unserer Instanz schon installiert, und in welchen Datenpools?',
    'Wir messen an 40 Standorten Temperatur und Feinstaub, alle zehn Minuten per MQTT.',
    'Bau etwas wie die Verkehrszählung, aber für Lärmmessung an Schulen.',
]

/** The installed page, opened at one installation (see the installed page's modal). */
const installationHref = (installationId: string) => `/installed?installation=${encodeURIComponent(installationId)}`

type Part = UIMessage['parts'][number]

function toolNameOf(part: { type: string; toolName?: string }): string {
    return part.type === 'dynamic-tool' ? (part.toolName ?? '') : part.type.replace(/^tool-/, '')
}

/**
 * The assistant's answer once an install went through: a link to the
 * installation's overview, and what did not work, which in the install's
 * summary is easy to miss between the green lines (a dashboard while Superset
 * was down, demo data while the simulator was). Written here, not by the model:
 * it has to arrive at once and carry the exact id, and it still lands in the
 * history, so the model knows about the install in the next turn.
 */
function installReport(title: string, result: InstallResult): string {
    const lines = [
        `**Installiert:** „${title}“. [Übersicht der Installation öffnen ↗](${installationHref(result.installationId ?? '')}): Datensatz, Demo-Ströme und Dashboard auf einen Blick.`,
    ]
    const problems = result.detail
        .split(' · ')
        .map((segment) => segment.trim())
        .filter((segment) => segment.includes('NICHT'))
    if (problems.length > 0) {
        lines.push('', 'Dabei hat nicht alles geklappt:', ...problems.map((problem) => `- ${problem}`))
        if (problems.some((problem) => problem.startsWith('Dashboard'))) {
            lines.push('', 'Ein fehlendes Dashboard lässt sich in der Übersicht erneut einspielen.')
        }
    }
    return lines.join('\n')
}

export function AssistantChat() {
    const { messages, sendMessage, setMessages, status, error } = useChat({ transport })
    const [input, setInput] = useState('')
    const endRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const busy = status === 'submitted' || status === 'streaming'
    // Only the latest answer offers its numbered options as choices; older ones are history.
    const lastAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, [messages, status])

    function send(text: string) {
        const trimmed = text.trim()
        if (!trimmed || busy) return
        void sendMessage({ text: trimmed })
        setInput('')
    }

    function adjust() {
        setInput('Ändere den Plan: ')
        inputRef.current?.focus()
    }

    function reportInstall(title: string, result: InstallResult) {
        if (!result.installationId) return
        const id = `installed-${result.installationId}`
        setMessages((current) =>
            current.some((message) => message.id === id)
                ? current
                : [...current, { id, role: 'assistant', parts: [{ type: 'text', text: installReport(title, result) }] }],
        )
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

            {messages.map((message) =>
                message.role === 'user' ? (
                    <div key={message.id} className="self-end rounded-lg bg-muted px-4 py-3 text-sm whitespace-pre-wrap">
                        {message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')}
                    </div>
                ) : (
                    <div key={message.id} className="flex items-start gap-2">
                        <Sparkles className="mt-1 size-4 shrink-0 text-primary" />
                        <div className="flex min-w-0 flex-1 flex-col gap-3">
                            {message.parts.map((part, index) => (
                                <AssistantPart
                                    key={index}
                                    part={part}
                                    onSend={send}
                                    onAdjust={adjust}
                                    onInstalled={reportInstall}
                                    onChoose={message.id === lastAssistantId && !busy ? send : undefined}
                                />
                            ))}
                        </div>
                    </div>
                ),
            )}

            {status === 'submitted' && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Denkt nach …
                </div>
            )}
            {error && <p className="text-xs text-error">{error.message}</p>}
            <div ref={endRef} />

            <form
                onSubmit={(event) => {
                    event.preventDefault()
                    send(input)
                }}
                className="sticky bottom-0 z-10 flex items-end gap-2 border-t bg-background pb-4 pt-3"
            >
                <textarea
                    ref={inputRef}
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
                    disabled={busy || !input.trim()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    Senden
                </button>
            </form>
        </div>
    )
}

/** One part of an assistant message: text, a lookup, or the card a final tool produced. */
function AssistantPart({
    part,
    onSend,
    onAdjust,
    onInstalled,
    onChoose,
}: {
    part: Part
    onSend: (text: string) => void
    onAdjust: () => void
    /** A plan was installed: the chat answers with a link to the installation. */
    onInstalled: (title: string, result: InstallResult) => void
    /** Set on the latest answer: its numbered options become clickable. */
    onChoose?: (choice: string) => void
}) {
    if (part.type === 'text') return part.text.trim() ? <ChatMarkdown text={part.text} onChoose={onChoose} /> : null
    if (!isToolUIPart(part)) return null

    const name = toolNameOf(part)
    const label = READ_TOOL_LABELS[name]
    if (label) {
        const done = part.state === 'output-available' || part.state === 'output-error'
        return (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {done ? <Search className="size-3" /> : <Loader2 className="size-3 animate-spin" />}
                {done ? `Nachgeschlagen: ${label}` : `Schlage nach: ${label} …`}
            </p>
        )
    }

    if (part.state === 'output-error') return <p className="text-xs text-error">{part.errorText}</p>
    if (part.state !== 'output-available') {
        return (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                {name === 'katalog_empfehlen' ? 'Prüfe den Katalog …' : 'Baue den Plan …'}
            </p>
        )
    }

    const output = part.output as UseCaseToolOutput | StructureToolOutput | RecommendationToolOutput
    if (!output.ok) return <p className="text-xs text-error">{output.error}</p>

    return (
        <div className="flex flex-col gap-3">
            {output.reply && <ChatMarkdown text={output.reply} onChoose={onChoose} />}
            {'plan' in output && <UseCaseCard plan={output.plan} onAdjust={onAdjust} onInstalled={onInstalled} />}
            {'proposal' in output && (
                <StructureCard proposal={output.proposal} onAdjust={onAdjust} onInstalled={onInstalled} />
            )}
            {'recommendation' in output && <RecommendationCard recommendation={output.recommendation} onSend={onSend} />}
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

/** A catalogue entry that fits, wholly or partly: open it beside the chat, or generate after all. */
function RecommendationCard({
    recommendation,
    onSend,
}: {
    recommendation: Recommendation
    onSend: (text: string) => void
}) {
    const fits = recommendation.fit === 'passt'
    return (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
            <div>
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                        Empfehlung aus dem Katalog
                    </p>
                    <span
                        className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                            fits ? 'bg-success/10 text-success' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                        }`}
                    >
                        {fits ? 'Passt gut' : 'Passt teilweise'}
                    </span>
                </div>
                <h3 className="mt-1 text-base font-semibold">{recommendation.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{recommendation.description}</p>
                {recommendation.reason && <p className="mt-2 text-sm">{recommendation.reason}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <a
                    href={recommendation.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                    <ExternalLink className="size-4" />
                    Im Marketplace öffnen
                </a>
                <button
                    type="button"
                    onClick={() => onSend(`Erzeuge trotzdem einen eigenen Anwendungsfall statt „${recommendation.title}“.`)}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
                >
                    <Wand2 className="size-4" />
                    Trotzdem eigenen erzeugen
                </button>
            </div>
        </div>
    )
}

/** A whole use case: the steps the install will take, then the marketplace's own install dialog. */
function UseCaseCard({
    plan,
    onAdjust,
    onInstalled,
}: {
    plan: UseCasePlan
    onAdjust: () => void
    onInstalled: (title: string, result: InstallResult) => void
}) {
    const [options, setOptions] = useState<InstallOptions | null>(null)
    const [optionsError, setOptionsError] = useState<string | null>(null)
    const [showFields, setShowFields] = useState(false)

    useEffect(() => {
        loadInstallOptions()
            .then(setOptions)
            .catch((failure: unknown) => setOptionsError(failure instanceof Error ? failure.message : String(failure)))
    }, [])

    const { proposal, steps } = plan

    return (
        <div className="flex flex-col gap-4 rounded-lg border p-4">
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
                        <thead>
                            <tr className="text-left text-muted-foreground">
                                <th className="py-1 pr-3 font-medium">Feld</th>
                                <th className="py-1 pr-3 font-medium">Typ</th>
                                <th className="py-1 pr-3 font-medium">Bedeutung</th>
                                <th className="py-1 font-medium">Demodaten</th>
                            </tr>
                        </thead>
                        <tbody>
                            {proposal.fields.map((field) => (
                                <tr key={field.name} className="border-t">
                                    <td className="py-1 pr-3 font-mono">{field.name}</td>
                                    <td className="py-1 pr-3 text-muted-foreground">
                                        {field.dateTime ? 'Zeitpunkt' : field.type}
                                        {field.required ? ' · Pflicht' : ''}
                                    </td>
                                    <td className="py-1 pr-3">{field.description}</td>
                                    <td className="py-1 text-muted-foreground">{describeGenerator(field)}</td>
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
                        installationHref={installationHref}
                        onInstalled={(result) => onInstalled(plan.title, result)}
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
function StructureCard({
    proposal,
    onAdjust,
    onInstalled,
}: {
    proposal: StructureProposal
    onAdjust: () => void
    onInstalled: (title: string, result: InstallResult) => void
}) {
    const [result, setResult] = useState<InstallResult | null>(null)
    const [installing, startInstall] = useTransition()
    const done = result?.status === 'created'

    return (
        <div className="flex flex-col gap-4 rounded-lg border p-4">
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
                    onClick={() =>
                        startInstall(async () => {
                            const outcome = await installProposal(proposal)
                            setResult(outcome)
                            if (outcome.status === 'created') onInstalled(proposal.title, outcome)
                        })
                    }
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
                    {done && result.installationId && (
                        <>
                            {' '}
                            <a
                                href={installationHref(result.installationId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium underline"
                            >
                                Installation ansehen ↗
                            </a>
                        </>
                    )}
                </p>
            )}
        </div>
    )
}
