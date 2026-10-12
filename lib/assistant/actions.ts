'use server'

import { revalidatePath } from 'next/cache'

import { callModel, type ChatTurn } from '@/lib/assistant/llm'
import {
    PROPOSAL_TOOL_SCHEMA,
    proposalSchema,
    proposalToEntry,
    type StructureProposal,
} from '@/lib/assistant/proposal'
import { getCatalogSummaries } from '@/lib/catalog/source'
import type { CatalogSummary } from '@/lib/catalog/types'
import type { InstallResult } from '@/lib/install-actions'
import {
    InstallPayloadError,
    buildInstallationRequest,
    describeInstallFailure,
    summarizeInstallation,
    type InstallationRequest,
    type InstallationReceipt,
} from '@/lib/install-payload'
import { getAccessToken, requireSession } from '@/lib/session'

export interface AssistantReply {
    text: string
    proposal?: StructureProposal
    error?: string
}

function catalogLine(kind: string, entry: CatalogSummary): string {
    const keywords = entry.keywords.length ? `, Schlagworte: ${entry.keywords.join(', ')}` : ''
    return `- ${kind} „${entry.displayName}“ (v${entry.version}${keywords}): ${entry.description}`
}

async function catalogContext(): Promise<string> {
    const [useCases, structures] = await Promise.all([
        getCatalogSummaries('usecase'),
        getCatalogSummaries('datastructure'),
    ])
    return [
        ...useCases.map((entry) => catalogLine('Use Case', entry)),
        ...structures.map((entry) => catalogLine('Datenstruktur', entry)),
    ].join('\n')
}

function systemPrompt(catalog: string): string {
    return `Du bist der Assistent im Open-Urban-Apps-Marketplace für die urbane Datenplattform CIVITAS/CORE v2. Du antwortest auf Deutsch, kurz und konkret.

Du hast zwei Aufgaben:
1. Fragen zum Katalog beantworten. Nutze nur die Einträge unten. Passt ein Eintrag zu dem, was die Person beschreibt, empfiehl ihn zuerst: Er ist erprobt und lässt sich im Katalog installieren.
2. Eigene Datenstrukturen vorschlagen. Beschreibt die Person Daten, die sie anlegen will, und passt kein Katalog-Eintrag, oder will sie ausdrücklich etwas Eigenes, rufe das Werkzeug datenstruktur_vorschlagen auf. Teile die Daten in sinnvolle Objekte (z. B. Messstation und Messwert), gib jedem Objekt eine Kennung, Messwerten einen Zeitpunkt (dateTime: true) und Standorten Breiten- und Längengrad. Feldnamen in camelCase ohne Umlaute, Beschreibungen auf Deutsch mit Einheit. Angelegt wird erst, wenn die Person den Plan bestätigt.

Katalog dieser Instanz:
${catalog}`
}

/** One turn of the conversation: an answer, or an answer with a proposal to confirm. */
export async function askAssistant(turns: ChatTurn[]): Promise<AssistantReply> {
    await requireSession()
    try {
        const answer = await callModel(systemPrompt(await catalogContext()), turns, PROPOSAL_TOOL_SCHEMA)
        if (answer.toolInput === undefined) return { text: answer.text || '(keine Antwort)' }

        const parsed = proposalSchema.safeParse(answer.toolInput)
        if (!parsed.success) {
            const issues = parsed.error.issues
                .slice(0, 3)
                .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                .join('; ')
            return { text: answer.text, error: `Vorschlag nicht verwendbar: ${issues}` }
        }
        const reply = (answer.toolInput as { reply?: unknown }).reply
        const text = [answer.text, typeof reply === 'string' ? reply : ''].filter(Boolean).join('\n\n')
        return { text: text || 'Hier ist mein Vorschlag.', proposal: parsed.data }
    } catch (error) {
        return { text: '', error: error instanceof Error ? error.message : String(error) }
    }
}

/**
 * Installs a confirmed proposal through the same path as a catalogue package:
 * the proposal becomes a catalogue entry, the entry an installation request,
 * and the request goes to `POST /v1/installations` with the user's token. The
 * platform checks the user's rights and journals the installation as usual.
 */
export async function installProposal(raw: unknown): Promise<InstallResult> {
    await requireSession()
    const parsed = proposalSchema.safeParse(raw)
    if (!parsed.success) return { status: 'invalid', detail: 'Vorschlag ungültig.', httpStatus: 0 }

    const entry = proposalToEntry(parsed.data)
    let request: InstallationRequest
    try {
        request = buildInstallationRequest(entry)
    } catch (error) {
        if (!(error instanceof InstallPayloadError)) throw error
        return { status: 'error', detail: `Paket nicht installierbar: ${error.message}`, httpStatus: 0 }
    }

    const response = await fetch(`${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/installations`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${await getAccessToken()}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        cache: 'no-store',
    })
    if (response.status !== 201) {
        const failure = describeInstallFailure(
            response.status,
            response.statusText,
            await response.text().catch(() => ''),
        )
        return { ...failure, httpStatus: response.status }
    }

    const receipt = (await response.json()) as InstallationReceipt
    revalidatePath('/datastructures')
    revalidatePath('/installed')
    revalidatePath('/instance')
    const installation = receipt.id ? ` · Installation ${receipt.id}` : ''
    return {
        status: 'created',
        detail: `${summarizeInstallation(receipt, entry.manifest.displayName)}${installation}`,
        httpStatus: 201,
    }
}
