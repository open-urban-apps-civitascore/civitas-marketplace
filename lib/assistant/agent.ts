import { anthropic } from '@ai-sdk/anthropic'
import { ToolLoopAgent, hasToolCall, isStepCount, jsonSchema, tool, type JSONSchema7 } from 'ai'

import { PROPOSAL_TOOL_SCHEMA, proposalSchema } from '@/lib/assistant/proposal'
import { READ_TOOLS } from '@/lib/assistant/read-tools'
import { assembleStoredPackage, saveStoredPackage } from '@/lib/assistant/store'
import type { RecommendationToolOutput, StructureToolOutput, UseCaseToolOutput } from '@/lib/assistant/types'
import { USE_CASE_TOOL_SCHEMA, buildUseCasePackage, useCaseProposalSchema } from '@/lib/assistant/usecase'
import { getCatalogSummaries, getCatalogSummary } from '@/lib/catalog/source'
import type { CatalogSummary } from '@/lib/catalog/types'
import { deriveDisambiguator } from '@/lib/export/urn'
import { catalogEntryHref } from '@/lib/use-case-catalog/path'

/**
 * The assistant as an AI SDK agent: read tools that look things up, and three
 * final tools that end the turn with a card the person acts on (a use case to
 * install, a structure to install, a catalogue entry to open). Nothing in here
 * writes to the platform; installs go through the marketplace's install dialog.
 * ASSISTANT_MODEL overrides the model.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hrefOf(entry: CatalogSummary): string {
    return entry.type === 'usecase' ? catalogEntryHref(entry.id) : '/datastructures'
}

function catalogLine(entry: CatalogSummary): string {
    const kind = entry.type === 'usecase' ? 'Use Case' : 'Datenstruktur'
    const keywords = entry.keywords.length ? `, Schlagworte: ${entry.keywords.join(', ')}` : ''
    return `- ${kind} „${entry.displayName}“ (Kennung ${entry.id}, Seite ${hrefOf(entry)}, v${entry.version}${keywords}): ${entry.description}`
}

async function catalogContext(): Promise<string> {
    const [useCases, structures] = await Promise.all([
        getCatalogSummaries('usecase'),
        getCatalogSummaries('datastructure'),
    ])
    return [...useCases, ...structures].map(catalogLine).join('\n')
}

function instructions(catalog: string): string {
    return `Du bist der Assistent im Open-Urban-Apps-Marketplace für die urbane Datenplattform CIVITAS/CORE v2. Du antwortest auf Deutsch, kurz und konkret, in Markdown, und duzt.

Entscheide bei jeder Beschreibung, was besser passt:
- Ein Katalog-Eintrag passt gut: Empfiehl ihn mit katalog_empfehlen (fit "passt"). Erzeuge dann nichts.
- Ein Eintrag passt teilweise: Empfiehl ihn mit katalog_empfehlen (fit "teilweise"), nenne in reason die Lücke und biete an, einen eigenen Anwendungsfall zu erzeugen.
- Nichts passt, oder die Person will ausdrücklich etwas Eigenes: Schlag mit use_case_vorschlagen einen ganzen Anwendungsfall vor. Nur wenn sie ausdrücklich nur ein Datenmodell will: datenstruktur_vorschlagen.

Nachschlagen: Du kannst Katalog-Einträge im Detail lesen (katalog_eintrag_lesen) und sehen, was diese Instanz enthält (installationen_auflisten, datenpools_auflisten, datensaetze_auflisten, datenstrukturen_der_instanz). Schlag nach, statt zu raten. Soll ein eigener Anwendungsfall einem Eintrag ähneln, lies ihn vorher und übernimm passende Feldnamen und Demodaten-Generatoren.

Regeln:
- Bietest du der Person eine Auswahl an, dann immer als nummerierte Liste (1., 2., 3.): Sie kann mit der Nummer antworten oder die Option anklicken. Andere Aufzählungen schreibst du mit Spiegelstrichen, nie nummeriert.
- Fehlt Wesentliches (was gemessen wird), frag einmal kurz nach. Sonst triff plausible Annahmen und nenne sie in reply.
- Wünscht die Person Änderungen an einem Vorschlag aus dem Verlauf, rufe das Werkzeug erneut mit dem vollständigen geänderten Vorschlag auf.
- Erwähnst du Katalog-Einträge im Text, verlinke sie mit der Seite aus der Liste unten, z. B. [Verkehrszählung](/use-cases/openurbanapps/verkehrszaehlung). Erfinde keine Adressen.
- Angelegt wird erst, wenn die Person den Plan bestätigt. Datenpool, Datenquelle (Demo-Daten oder eigener Broker) und Freigabe wählt sie danach im Installationsdialog. Frag danach nicht im Chat.

Katalog dieser Instanz:
${catalog}`
}

/** The tool schemas are plain JSON Schema objects; the SDK wants them typed as such. */
function schemaOf(value: Record<string, unknown>) {
    return jsonSchema<unknown>(value as unknown as JSONSchema7)
}

function replyOf(input: unknown): string {
    return isRecord(input) && typeof input.reply === 'string' ? input.reply : ''
}

function issuesOf(issues: { path: PropertyKey[]; message: string }[]): string {
    return issues
        .slice(0, 3)
        .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
        .join('; ')
}

async function planUseCase(input: unknown): Promise<UseCaseToolOutput> {
    const parsed = useCaseProposalSchema.safeParse(input)
    if (!parsed.success) return { ok: false, error: `Plan nicht verwendbar: ${issuesOf(parsed.error.issues)}` }
    const pkg = buildUseCasePackage(parsed.data)
    const key = deriveDisambiguator(`assistant#store#${parsed.data.title}#${Date.now()}`)
    const stored = { manifest: pkg.manifest, files: pkg.files }
    try {
        // The same checks as for a catalogue package, before anything is offered for install.
        assembleStoredPackage(stored, `assistant:${key}`)
    } catch (error) {
        return { ok: false, error: `Plan hängt nicht zusammen: ${error instanceof Error ? error.message : String(error)}` }
    }
    const entryId = await saveStoredPackage(key, stored)
    return {
        ok: true,
        reply: replyOf(input),
        plan: { entryId, title: parsed.data.title, version: '1.0.0', proposal: parsed.data, steps: pkg.steps },
    }
}

function planStructure(input: unknown): StructureToolOutput {
    const parsed = proposalSchema.safeParse(input)
    if (!parsed.success) return { ok: false, error: `Vorschlag nicht verwendbar: ${issuesOf(parsed.error.issues)}` }
    return { ok: true, reply: replyOf(input), proposal: parsed.data }
}

async function recommend(input: unknown): Promise<RecommendationToolOutput> {
    const id = isRecord(input) ? input.id : undefined
    if (typeof id !== 'string' || !id) return { ok: false, error: 'Keine Kennung angegeben.' }
    const entry = await getCatalogSummary(id)
    if (!entry) return { ok: false, error: `Kein Katalog-Eintrag mit der Kennung ${id}.` }
    const fit = isRecord(input) && input.fit === 'teilweise' ? 'teilweise' : 'passt'
    const reason = isRecord(input) && typeof input.reason === 'string' ? input.reason : ''
    return {
        ok: true,
        reply: replyOf(input),
        recommendation: {
            id,
            type: entry.type,
            title: entry.displayName,
            description: entry.description,
            href: hrefOf(entry),
            fit,
            reason,
        },
    }
}

const RECOMMEND_SCHEMA: JSONSchema7 = {
    type: 'object',
    properties: {
        reply: { type: 'string', description: 'Kurze Antwort an die Person, 1-3 Sätze.' },
        id: { type: 'string', description: 'Kennung des Eintrags aus der Katalogliste.' },
        fit: { type: 'string', enum: ['passt', 'teilweise'] },
        reason: { type: 'string', description: 'Warum der Eintrag passt; bei "teilweise" auch, was fehlt.' },
    },
    required: ['reply', 'id', 'fit', 'reason'],
}

export async function buildAssistantAgent() {
    const readTools = Object.fromEntries(
        READ_TOOLS.map((readTool) => [
            readTool.name,
            tool({
                description: readTool.description,
                inputSchema: schemaOf(readTool.input_schema),
                execute: (input: unknown) => readTool.run(input),
            }),
        ]),
    )

    return new ToolLoopAgent({
        model: anthropic(process.env.ASSISTANT_MODEL || 'claude-sonnet-5-5'),
        instructions: instructions(await catalogContext()),
        tools: {
            ...readTools,
            use_case_vorschlagen: tool({
                description:
                    'Schlägt einen ganzen Anwendungsfall vor: Datenstrukturen, MQTT-Datenquelle, Datensatz, Mapping, PostGIS-Senke, Pipeline und passende Demodaten.',
                inputSchema: schemaOf(USE_CASE_TOOL_SCHEMA),
                execute: (input: unknown) => planUseCase(input),
            }),
            datenstruktur_vorschlagen: tool({
                description: 'Schlägt NUR eine Datenstruktur (ein Datenmodell) vor, ohne Datenfluss.',
                inputSchema: schemaOf(PROPOSAL_TOOL_SCHEMA),
                execute: async (input: unknown) => planStructure(input),
            }),
            katalog_empfehlen: tool({
                description: 'Empfiehlt einen Eintrag aus dem Katalog, der ganz oder teilweise passt.',
                inputSchema: jsonSchema<unknown>(RECOMMEND_SCHEMA),
                execute: (input: unknown) => recommend(input),
            }),
        },
        // A final tool ends the turn: its card is what the person acts on next.
        stopWhen: [isStepCount(8), hasToolCall('use_case_vorschlagen', 'datenstruktur_vorschlagen', 'katalog_empfehlen')],
    })
}
