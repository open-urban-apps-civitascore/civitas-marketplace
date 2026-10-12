import { z } from 'zod'

import { compactName, deriveDisambiguator, slugify, urnSegment } from '@/lib/export/urn'

/**
 * A whole use case from a short description. The model names the message, its
 * fields with a hint how to simulate each, and the places that send it.
 * Everything else is built here after the pattern of the Verkehrszählung
 * package: a raw and a target structure, the MQTT source, a one-to-one mapping
 * with type conversion, the PostGIS sink, the pipeline and the simulation. The
 * package hangs together by construction and then passes the same assembly
 * checks as every catalogue package.
 */

const FIELD_TYPES = ['string', 'number', 'integer', 'boolean'] as const
const GENERATOR_KINDS = [
    'station',
    'stationLat',
    'stationLon',
    'now',
    'randomWalk',
    'dailyProfile',
    'enum',
    'constant',
    'sequence',
] as const

const scalar = z.union([z.string(), z.number(), z.boolean()])

export const useCaseProposalSchema = z.object({
    title: z.string().min(3).max(60),
    description: z.string().min(10).max(400),
    domain: z.string().min(2).max(40),
    messageName: z.string().min(1).max(60),
    fields: z
        .array(
            z.object({
                name: z.string().min(1).max(60),
                type: z.enum(FIELD_TYPES),
                dateTime: z.boolean().optional(),
                description: z.string().max(300),
                required: z.boolean().optional(),
                generator: z.object({
                    kind: z.enum(GENERATOR_KINDS),
                    min: z.number().optional(),
                    max: z.number().optional(),
                    step: z.number().optional(),
                    peakHours: z.array(z.number().int().min(0).max(23)).optional(),
                    values: z.array(scalar).optional(),
                    value: scalar.optional(),
                }),
            }),
        )
        .min(1)
        .max(30),
    stations: z
        .array(
            z.object({
                name: z.string().min(1).max(60),
                id: z.string().min(1).max(40),
                lat: z.number().optional(),
                lon: z.number().optional(),
            }),
        )
        .min(1)
        .max(6),
    intervalSeconds: z.number().int().min(2).max(3600).optional(),
})

export type UseCaseProposal = z.infer<typeof useCaseProposalSchema>

/** The use-case tool's input schema, as the model sees it. `reply` is the model's explanation. */
export const USE_CASE_TOOL_SCHEMA: Record<string, unknown> = {
    type: 'object',
    properties: {
        reply: { type: 'string', description: 'Kurze Erklärung des Plans auf Deutsch, 1-3 Sätze.' },
        title: { type: 'string', description: 'Name des Anwendungsfalls, deutsch, kurz, z. B. "Umwelt-Messnetz".' },
        description: { type: 'string', description: 'Ein bis zwei Sätze: was gemessen wird und wozu.' },
        domain: {
            type: 'string',
            description: 'Fachbereich als ein englisches Wort, klein: environment, mobility, energy, water, buildings, health oder general.',
        },
        messageName: { type: 'string', description: 'Name einer Nachricht in PascalCase, deutsch, ohne Umlaute, z. B. "Messung".' },
        fields: {
            type: 'array',
            description:
                'Die Felder einer Nachricht. Immer dabei: die Kennung der Station (generator.kind "station") und der Zeitpunkt (dateTime true, generator.kind "now"). Für Standorte Breiten- und Längengrad mit "stationLat" und "stationLon".',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'camelCase, ohne Umlaute, z. B. "pm10".' },
                    type: { type: 'string', enum: [...FIELD_TYPES] },
                    dateTime: { type: 'boolean', description: 'true für Zeitpunkte (type ist dann string).' },
                    description: { type: 'string', description: 'Deutsch, mit Einheit.' },
                    required: { type: 'boolean' },
                    generator: {
                        type: 'object',
                        description:
                            'Wie die Demodaten das Feld erzeugen. randomWalk: Messwert, der langsam schwankt (min, max, step). dailyProfile: Werte mit Tagesspitzen, z. B. Zählungen (min, max, peakHours). enum: einer aus values. constant: immer value. sequence: fortlaufende Nummer.',
                        properties: {
                            kind: { type: 'string', enum: [...GENERATOR_KINDS] },
                            min: { type: 'number' },
                            max: { type: 'number' },
                            step: { type: 'number' },
                            peakHours: { type: 'array', items: { type: 'integer' } },
                            values: { type: 'array', items: {} },
                            value: {},
                        },
                        required: ['kind'],
                    },
                },
                required: ['name', 'type', 'description', 'generator'],
            },
        },
        stations: {
            type: 'array',
            description:
                'Standorte, die Daten senden. Für die Demo höchstens 6, auch wenn es real mehr sind. Mit plausiblen Koordinaten in einer deutschen Stadt.',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'z. B. "Marktplatz".' },
                    id: { type: 'string', description: 'z. B. "S-001".' },
                    lat: { type: 'number' },
                    lon: { type: 'number' },
                },
                required: ['name', 'id'],
            },
        },
        intervalSeconds: {
            type: 'integer',
            description: 'Sendetakt der Demodaten in Sekunden. Für die Demo kurz halten (5 bis 15), auch wenn real seltener gemessen wird.',
        },
    },
    required: ['reply', 'title', 'description', 'domain', 'messageName', 'fields', 'stations'],
}

/** One step of the plan, as the chat shows it. */
export interface PlanStep {
    kind: string
    title: string
    detail: string
}

export interface UseCasePackage {
    manifest: Record<string, unknown>
    files: Record<string, Record<string, unknown>>
    steps: PlanStep[]
}

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }

/** A JSON property or $defs key: ASCII letters, digits and underscore, starting with a letter. */
function identifier(value: string, fallback: string): string {
    const ascii = value.replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c] ?? c).replace(/[^A-Za-z0-9_]/g, '')
    return /^[A-Za-z]/.test(ascii) ? ascii : fallback
}

type Field = UseCaseProposal['fields'][number]
type Station = UseCaseProposal['stations'][number]

/** The field as the device sends it: every number arrives as a JSON number. */
function rawProperty(field: Field): Record<string, unknown> {
    if (field.dateTime) return { type: 'string', format: 'date-time', description: field.description }
    const type = field.type === 'integer' ? 'number' : field.type
    return { type, description: field.description }
}

/** The field as it is stored: integers stay integers. */
function targetProperty(field: Field): Record<string, unknown> {
    if (field.dateTime) return { type: 'string', format: 'date-time', description: field.description }
    return { type: field.type, description: field.description }
}

/** One stream's generator for a field, in the simulator's own vocabulary. */
function generatorFor(field: Field, station: Station, index: number): Record<string, unknown> {
    const g = field.generator
    if (field.dateTime) return { kind: 'now' }
    switch (g.kind) {
        case 'station':
            return { kind: 'constant', value: station.id }
        case 'stationLat':
            return { kind: 'constant', value: station.lat ?? 51.96 + index * 0.004 }
        case 'stationLon':
            return { kind: 'constant', value: station.lon ?? 7.63 + index * 0.006 }
        case 'now':
            return { kind: 'now' }
        case 'constant':
            return { kind: 'constant', value: g.value ?? '' }
        case 'enum':
            return { kind: 'enum', values: g.values?.length ? g.values : field.type === 'boolean' ? [true, false] : ['a'] }
        case 'sequence':
            return { kind: 'sequence' }
        case 'dailyProfile': {
            const min = g.min ?? 0
            const max = g.max ?? Math.max(min + 10, 50)
            return {
                kind: 'dailyProfile',
                min,
                max,
                peakHours: g.peakHours?.length ? g.peakHours : [8, 17],
                ...(field.type === 'integer' ? { integer: true } : {}),
            }
        }
        default: {
            const min = g.min ?? 0
            const max = g.max ?? Math.max(min + 10, 100)
            return { kind: 'randomWalk', min, max, step: g.step ?? Math.max((max - min) / 10, 0.1) }
        }
    }
}

/** A PostgreSQL table name: lowercase letters, digits and underscores, starting with a letter. */
function tableNameOf(title: string): string {
    const name = slugify(title).replace(/-/g, '_').slice(0, 40)
    return /^[a-z]/.test(name) ? name : `t_${name}`
}

function describeGenerator(field: Field): string {
    const g = field.generator
    if (field.dateTime || g.kind === 'now') return 'Zeitpunkt des Sendens'
    switch (g.kind) {
        case 'station':
            return 'Kennung der Station'
        case 'stationLat':
        case 'stationLon':
            return 'Koordinate der Station'
        case 'enum':
            return `einer aus ${(g.values ?? []).join(', ')}`
        case 'constant':
            return `immer ${String(g.value)}`
        case 'sequence':
            return 'fortlaufend'
        case 'dailyProfile':
            return `${g.min ?? 0}-${g.max ?? '?'} mit Tagesspitzen`
        default:
            return `${g.min ?? 0}-${g.max ?? '?'}, schwankend`
    }
}

/**
 * The package for a proposal: a manifest in the catalogue format and its member
 * files, plus the plan steps the chat shows. Identities are fresh per proposal,
 * so a changed plan installs as a new use case instead of meeting "already
 * installed".
 */
export function buildUseCasePackage(proposal: UseCaseProposal, now = Date.now()): UseCasePackage {
    const domain = urnSegment(proposal.domain, 'general')
    const urn = (type: string, name: string) =>
        `urn:core:standard:openurbanapps:${type}:${domain}:${compactName(name)}:${deriveDisambiguator(`assistant#${type}#${name}#${now}`)}`

    const title = proposal.title.trim()
    const rawTitle = `${title} (Rohformat)`
    const sourceTitle = `${title}-Feed`
    const mappingName = `${title}: Rohformat → Zielformat`
    const sinkTitle = `${title}-Tabelle`
    const pipelineName = `${title}-Import`
    const tableName = tableNameOf(title)
    const topicBase = `assistent/${slugify(title)}`
    const messageDef = identifier(proposal.messageName, 'Messung')
    const intervalSeconds = proposal.intervalSeconds ?? 10

    // Field names as keys, deduplicated after sanitising.
    const fields: (Field & { key: string })[] = []
    for (const field of proposal.fields) {
        const key = identifier(field.name, `feld${fields.length + 1}`)
        if (!fields.some((candidate) => candidate.key === key)) fields.push({ ...field, key })
    }
    const required = fields.filter((field) => field.required || field.generator.kind === 'station' || field.dateTime).map((field) => field.key)

    const structure = (structureTitle: string, description: string, property: (field: Field) => Record<string, unknown>, id: string) => ({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: id,
        title: structureTitle,
        description,
        $defs: {
            [messageDef]: {
                type: 'object',
                properties: Object.fromEntries(fields.map((field) => [field.key, property(field)])),
                ...(required.length ? { required } : {}),
            },
        },
    })

    const rawUrn = urn('datastructure', rawTitle)
    const targetUrn = urn('datastructure', title)
    const mappingUrn = urn('mapping', mappingName)

    const files: Record<string, Record<string, unknown>> = {
        'rohformat.datastructure.json': structure(rawTitle, `Nachricht, wie die Geräte sie senden: ${proposal.description}`, rawProperty, rawUrn),
        'zielformat.datastructure.json': structure(title, proposal.description, targetProperty, targetUrn),
        'feed.datasource.json': {
            $schema: 'https://civitasconnect.digital/core/datasource/v1',
            id: urn('datasource', sourceTitle),
            title: sourceTitle,
            description: `Empfängt die Nachrichten der Stationen über MQTT (Topic ${topicBase}).`,
            connectionType: 'mqtt',
            element: rawUrn,
            urls: ['tcp://civitas-mosquitto:1883'],
            topics: [topicBase],
            qos: 1,
        },
        'mapping.mapping.json': {
            mappingUrn,
            name: mappingName,
            description: 'Übernimmt jedes Feld eins zu eins und gibt Zahlen ihren Typ.',
            document: {
                title: mappingName,
                source: rawUrn,
                target: targetUrn,
                fields: Object.fromEntries(
                    fields.map((field) => {
                        const input = `$.${field.key}`
                        if (!field.dateTime && field.type === 'integer') return [`$.${field.key}`, { op: 'toInt', input }]
                        if (!field.dateTime && field.type === 'number') return [`$.${field.key}`, { op: 'toFloat', input }]
                        return [`$.${field.key}`, input]
                    }),
                ),
            },
        },
        'tabelle.datasink.json': {
            $schema: 'https://civitasconnect.digital/core/datasink/v1',
            id: urn('datasink', sinkTitle),
            title: sinkTitle,
            description: `Schreibt die Nachrichten in die PostGIS-Tabelle ${tableName}.`,
            connectionType: 'postgis',
            tableName,
            element: targetUrn,
        },
        'import.pipeline.json': {
            name: pipelineName,
            description: 'Liest den Feed, bringt ihn ins Zielformat und schreibt ihn in die Tabelle.',
            model: {
                nodes: [
                    { id: 'n-start', kind: 'start', label: 'Start', 'x-ui-position': { x: -260, y: 120 } },
                    { id: 'n-source', kind: 'source', label: sourceTitle, sourceRef: sourceTitle, 'x-ui-position': { x: 0, y: 120 } },
                    { id: 'n-mapping', kind: 'mapping', label: mappingName, mappingRef: mappingUrn, 'x-ui-position': { x: 260, y: 120 } },
                    { id: 'n-sink', kind: 'sink', label: sinkTitle, sinkRef: sinkTitle, 'x-ui-position': { x: 520, y: 120 } },
                    { id: 'n-end', kind: 'end', label: 'Ende', 'x-ui-position': { x: 780, y: 120 } },
                ],
                edges: [
                    { id: 'e-start-source', source: 'n-start', target: 'n-source' },
                    { id: 'e-source-mapping', source: 'n-source', target: 'n-mapping' },
                    { id: 'e-mapping-sink', source: 'n-mapping', target: 'n-sink' },
                    { id: 'e-sink-end', source: 'n-sink', target: 'n-end' },
                ],
            },
        },
        'demo.simulation.json': {
            sourceRef: sourceTitle,
            messageClass: `#/$defs/${messageDef}`,
            topicBase,
            intervalSeconds,
            streams: proposal.stations.map((station, index) => ({
                name: `station-${slugify(station.name)}`.slice(0, 60),
                label: station.name.slice(0, 80),
                fields: Object.fromEntries(fields.map((field) => [field.key, generatorFor(field, station, index)])),
            })),
        },
    }

    const manifest = {
        id: `urn:openurbanapps:usecase:assistent-${slugify(title)}-${deriveDisambiguator(`assistant#usecase#${title}#${now}`)}`,
        type: 'usecase',
        displayName: title,
        description: proposal.description,
        version: '1.0.0',
        maintainer: 'Assistent (Open Urban Apps)',
        license: 'EUPL-1.2',
        keywords: ['assistent', domain],
        members: {
            dataStructures: [{ file: 'rohformat.datastructure.json' }, { file: 'zielformat.datastructure.json' }],
            dataSources: [
                {
                    file: 'feed.datasource.json',
                    parameters: [
                        { field: 'urls', label: 'MQTT-Broker-URLs', description: 'Broker-Adresse(n) der Ziel-Instanz; Standard ist der Plattform-Broker.' },
                    ],
                },
            ],
            mappings: [{ file: 'mapping.mapping.json' }],
            dataSinks: [
                {
                    file: 'tabelle.datasink.json',
                    parameters: [
                        { field: 'tableName', label: 'PostGIS-Tabellenname', description: 'Name der Zieltabelle in der PostGIS-Datenbank der Instanz.' },
                    ],
                },
            ],
            pipelines: [{ file: 'import.pipeline.json' }],
            simulations: [{ file: 'demo.simulation.json' }],
        },
        dependencies: [],
    }

    const fieldList = fields.map((field) => field.key).join(', ')
    const steps: PlanStep[] = [
        { kind: 'Datenstruktur', title: rawTitle, detail: `Nachricht „${messageDef}“, wie die Geräte sie senden: ${fieldList}` },
        { kind: 'Datenstruktur', title, detail: `dasselbe Objekt im Zielformat, Pflicht: ${required.join(', ') || 'keine'}` },
        { kind: 'Datenquelle', title: sourceTitle, detail: `MQTT, Topic ${topicBase}` },
        { kind: 'Datensatz', title, detail: 'im Datenpool, den du im nächsten Schritt wählst' },
        { kind: 'Mapping', title: mappingName, detail: 'eins zu eins, Zahlen bekommen ihren Typ' },
        { kind: 'Datensenke', title: sinkTitle, detail: `PostGIS-Tabelle ${tableName}` },
        { kind: 'Pipeline', title: pipelineName, detail: 'Quelle → Mapping → Senke' },
        {
            kind: 'Demodaten',
            title: `${proposal.stations.length} Station(en)`,
            detail: `${proposal.stations.map((station) => station.name).join(', ')}, alle ${intervalSeconds} s; ${fields
                .map((field) => `${field.key}: ${describeGenerator(field)}`)
                .join('; ')}`,
        },
    ]

    return { manifest, files, steps }
}
