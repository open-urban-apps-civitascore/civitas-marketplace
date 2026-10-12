'use server'

import { revalidatePath } from 'next/cache'

import { runConversation, type ChatTurn, type ToolSpec } from '@/lib/assistant/llm'
import { READ_TOOLS, READ_TOOL_LABELS } from '@/lib/assistant/read-tools'
import {
    PROPOSAL_TOOL_SCHEMA,
    proposalSchema,
    proposalToEntry,
    type StructureProposal,
} from '@/lib/assistant/proposal'
import { assembleStoredPackage, saveStoredPackage } from '@/lib/assistant/store'
import {
    USE_CASE_TOOL_SCHEMA,
    buildUseCasePackage,
    useCaseProposalSchema,
    type PlanStep,
    type UseCaseProposal,
} from '@/lib/assistant/usecase'
import { getCatalogSummaries } from '@/lib/catalog/source'
import type { CatalogSummary } from '@/lib/catalog/types'
import { fetchCanCreateDatapool, fetchDatapools, type DatapoolOption } from '@/lib/datapools'
import { deriveDisambiguator } from '@/lib/export/urn'
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
import { isSimulatorConfigured } from '@/lib/simulator/client'

/** A generated use case, stored and ready for the marketplace's install dialog. */
export interface UseCasePlan {
    /** `assistant:<key>`: the id the install dialog sends, answered by the assistant's store. */
    entryId: string
    title: string
    version: string
    proposal: UseCaseProposal
    steps: PlanStep[]
}

export interface AssistantReply {
    text: string
    structure?: StructureProposal
    useCase?: UseCasePlan
    /** Read tools the model used on the way. */
    lookups?: string[]
    error?: string
}

/** What the install dialog needs besides the entry, read with the user's token. */
export interface InstallOptions {
    datapools: DatapoolOption[]
    datapoolProblem?: string
    canCreateDatapool: boolean
    demoAvailable: boolean
}

const USE_CASE_TOOL: ToolSpec = {
    name: 'use_case_vorschlagen',
    description:
        'Schlägt einen ganzen Anwendungsfall vor: Datenstrukturen, MQTT-Datenquelle, Datensatz, Mapping, PostGIS-Senke, Pipeline und passende Demodaten. Der Normalfall, wenn die Person beschreibt, was sie misst oder erfasst, und nichts im Katalog passt oder sie ausdrücklich etwas Eigenes will.',
    input_schema: USE_CASE_TOOL_SCHEMA,
}

const STRUCTURE_TOOL: ToolSpec = {
    name: 'datenstruktur_vorschlagen',
    description:
        'Schlägt NUR eine Datenstruktur (ein Datenmodell) vor, ohne Datenfluss. Nur wenn die Person ausdrücklich nur ein Modell will.',
    input_schema: PROPOSAL_TOOL_SCHEMA,
}

function catalogLine(kind: string, entry: CatalogSummary): string {
    const keywords = entry.keywords.length ? `, Schlagworte: ${entry.keywords.join(', ')}` : ''
    return `- ${kind} „${entry.displayName}“ (Kennung ${entry.id}, v${entry.version}${keywords}): ${entry.description}`
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
    return `Du bist der Assistent im Open-Urban-Apps-Marketplace für die urbane Datenplattform CIVITAS/CORE v2. Du antwortest auf Deutsch, kurz und konkret, und duzt.

Deine Aufgaben:
1. Fragen zum Katalog beantworten. Passt ein Eintrag zu dem, was die Person beschreibt, empfiehl ihn zuerst: Er ist erprobt und lässt sich direkt installieren.
2. Anwendungsfälle vorschlagen (Werkzeug use_case_vorschlagen), wenn die Person beschreibt, was sie misst oder erfasst, und nichts im Katalog passt oder sie ausdrücklich etwas Eigenes will. Das ist der Normalfall.
3. Nur eine Datenstruktur vorschlagen (Werkzeug datenstruktur_vorschlagen), wenn die Person ausdrücklich nur ein Datenmodell will.

Nachschlagen: Du kannst Katalog-Einträge im Detail lesen (katalog_eintrag_lesen) und sehen, was diese Instanz enthält (installationen_auflisten, datenpools_auflisten, datensaetze_auflisten, datenstrukturen_der_instanz). Schlag nach, statt zu raten, wenn nach Details, nach dem Bestand der Instanz oder nach einem Vorbild gefragt wird. Soll ein eigener Anwendungsfall einem Katalog-Eintrag ähneln, lies den Eintrag vorher und übernimm passende Feldnamen und Demodaten-Generatoren.

Regeln für Vorschläge:
- Fehlt Wesentliches (was gemessen wird), frag einmal kurz nach. Sonst triff plausible Annahmen und nenne sie in reply.
- Wünscht die Person Änderungen an einem Vorschlag aus dem Verlauf, rufe das Werkzeug erneut mit dem vollständigen geänderten Vorschlag auf.
- Angelegt wird erst, wenn die Person den Plan bestätigt. Datenpool, Datenquelle (Demo-Daten oder eigener Broker) und Freigabe wählt sie danach im Installationsdialog. Frag danach nicht im Chat.

Katalog dieser Instanz:
${catalog}`
}

/** One turn of the conversation: an answer, or an answer with a plan to confirm. */
export async function askAssistant(turns: ChatTurn[]): Promise<AssistantReply> {
    await requireSession()
    try {
        const result = await runConversation(systemPrompt(await catalogContext()), turns, READ_TOOLS, [
            USE_CASE_TOOL,
            STRUCTURE_TOOL,
        ])
        const lookups = [...new Set(result.lookups.map((name) => READ_TOOL_LABELS[name] ?? name))]
        if (!result.final) return { text: result.text || '(keine Antwort)', lookups }

        const reply = (result.final.input as { reply?: unknown }).reply
        const text = [result.text, typeof reply === 'string' ? reply : ''].filter(Boolean).join('\n\n')

        if (result.final.name === USE_CASE_TOOL.name) {
            const parsed = useCaseProposalSchema.safeParse(result.final.input)
            if (!parsed.success) return { text, lookups, error: `Plan nicht verwendbar: ${issuesOf(parsed.error.issues)}` }
            const pkg = buildUseCasePackage(parsed.data)
            const key = deriveDisambiguator(`assistant#store#${parsed.data.title}#${Date.now()}`)
            const stored = { manifest: pkg.manifest, files: pkg.files }
            try {
                // The same checks as for a catalogue package, before anything is offered for install.
                assembleStoredPackage(stored, `assistant:${key}`)
            } catch (error) {
                return { text, lookups, error: `Plan hängt nicht zusammen: ${error instanceof Error ? error.message : String(error)}` }
            }
            const entryId = await saveStoredPackage(key, stored)
            return {
                text: text || 'Hier ist mein Plan.',
                lookups,
                useCase: { entryId, title: parsed.data.title, version: '1.0.0', proposal: parsed.data, steps: pkg.steps },
            }
        }

        const parsed = proposalSchema.safeParse(result.final.input)
        if (!parsed.success) return { text, lookups, error: `Vorschlag nicht verwendbar: ${issuesOf(parsed.error.issues)}` }
        return { text: text || 'Hier ist mein Vorschlag.', lookups, structure: parsed.data }
    } catch (error) {
        return { text: '', error: error instanceof Error ? error.message : String(error) }
    }
}

function issuesOf(issues: { path: PropertyKey[]; message: string }[]): string {
    return issues
        .slice(0, 3)
        .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
        .join('; ')
}

/** Datapools, the right to create one, and whether demo data can run: the install dialog's inputs. */
export async function loadInstallOptions(): Promise<InstallOptions> {
    await requireSession()
    const [listing, canCreateDatapool] = await Promise.all([fetchDatapools(), fetchCanCreateDatapool()])
    return {
        datapools: listing.pools,
        datapoolProblem: listing.problem,
        canCreateDatapool,
        demoAvailable: isSimulatorConfigured(),
    }
}

/**
 * Installs a confirmed structure proposal through the same path as a catalogue
 * package: the proposal becomes a catalogue entry, the entry an installation
 * request, and the request goes to `POST /v1/installations` with the user's
 * token. The platform checks the user's rights and journals it as usual.
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
