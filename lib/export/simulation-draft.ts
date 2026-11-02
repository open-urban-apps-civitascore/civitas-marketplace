import { LABEL_MAX, simulationProblem } from '@/lib/catalog/assemble'
import type { BundledMqttSimulation, BundledSimulation, BundledSqlSimulation, GeneratorSpec } from '@/lib/catalog/types'
import { compactName, slugify } from '@/lib/export/urn'

/**
 * Demo data drafted from a source's structure, for a share whose source the simulator has nothing for.
 * Names steer the generators (a `timestamp` gets the time, a `vehicleCount` a daily curve); the result
 * passes the catalogue's own checks, or the draft is a note saying why there is none.
 */

export interface DraftInput {
    /** The source's title: the package's simulation names it as `sourceRef`. */
    title: string
    transport: 'mqtt' | 'sql'
    /** MQTT: the source's first subscription. */
    subscription?: string
    /** SQL: the table the source reads. */
    table?: string
    model: Record<string, unknown>
}

export type Draft = { simulation: BundledSimulation } | { note: string }

/** Enough stations for a map or dashboard to show several. */
const STREAMS = 3
const MQTT_INTERVAL_SECONDS = 10
const SQL_INTERVAL_SECONDS = 30
const SQL_SEED_ROWS = 50
const SQL_MAX_ROWS = 500
/** Master data (no time) is written once, to this size. */
const SQL_MASTER_ROWS = 200
const MAX_DEPTH = 3
/** The simulator's own default place; the publisher moves it. */
const CENTRE = { lat: 49.7913, lon: 9.9534 }
const PEAK_HOURS = [[8, 17], [7, 8, 17, 18], [12, 19]]

// Run against `compactName`: lower case, umlauts transliterated, no separators.
const TIME = /(timestamp|zeitstempel|zeitpunkt|messzeit|datetime|observedat|time|zeit|datum|date)$/
const ID = /(^id|id|kennung|nummer|nr|code|key|uuid)$/
const NAMED = /(name|bezeichnung|titel|title|label)$/
const UNIT = /(unit|einheit)$/
const GENERIC_VALUE = /^(value|wert|messwert)$/
const LAT = /^(lat|latitude|breite|breitengrad)$/
const LON = /^(lon|lng|long|longitude|laenge|laengengrad)$/
const COUNT = /(count|anzahl|menge|occupied|belegt|frei|free|available|verfuegbar|plaetze|spaces|fahrzeuge|vehicles|besucher|visitors|personen|passanten)/
const PERCENT = /(percent|prozent|anteil|ratio|fuellstand|fuellgrad|auslastung|occupancy|humidity|feuchte|moisture|batterie|battery)/
const CO2 = /co2/
const AIR = /(pm10|pm25|pm2|pm1|no2|o3|so2|feinstaub|ozon|stickstoff)/
// Not a bare /temp/, which would read `tempo` as a temperature.
const TEMPERATURE = /(temperatur|temp$|tempc$|tempf$)/
const SPEED = /(speed|geschwindigkeit|kmh|tempo)/
// `stand` only at the end: `standort` is a place.
const LEVEL = /(pegel|wasserstand|level|hoehe|depth|tiefe|stand$)/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const round = (value: number, digits: number): number => Number(value.toFixed(digits))

/** The simulator allows longer names than a package label. */
export const clipLabel = (label: string): string => (label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1).trimEnd()}…` : label)

const nameKey = (name: string): string => (name.trim() ? compactName(name) : '')

/** Follows a reference inside the structure only, as far as the catalogue's checks do. */
function deref(node: unknown, root: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!isRecord(node)) return undefined
    const ref = node.$ref
    if (typeof ref !== 'string') return node
    if (!ref.startsWith('#/')) return undefined
    let target: unknown = root
    for (const segment of ref.slice(2).split('/')) {
        if (!isRecord(target) || !(segment in target)) return undefined
        target = target[segment]
    }
    return isRecord(target) ? target : undefined
}

function typeOf(schema: Record<string, unknown>): string | undefined {
    const type = schema.type
    if (typeof type === 'string') return type
    if (Array.isArray(type)) return type.find((t): t is string => typeof t === 'string' && t !== 'null')
    if (isRecord(schema.properties)) return 'object'
    // A union by its first alternative: enough for a demo value.
    for (const key of ['oneOf', 'anyOf']) {
        const options = schema[key]
        if (Array.isArray(options) && isRecord(options[0])) return typeOf(options[0])
    }
    return undefined
}

const hasProperties = (node: Record<string, unknown> | undefined): boolean => !!node && isRecord(node.properties) && Object.keys(node.properties).length > 0

/** The message class as the catalogue points at it; of several in `$defs`, the one with a time. */
function messageClassOf(structure: Record<string, unknown>): { pointer: string; node: Record<string, unknown> } | undefined {
    if (typeof structure.$ref === 'string') {
        const node = deref(structure, structure)
        if (node && hasProperties(node)) return { pointer: structure.$ref, node }
    }
    if (hasProperties(structure)) return { pointer: '#', node: structure }
    const defs = isRecord(structure.$defs)
        ? Object.entries(structure.$defs).filter((entry): entry is [string, Record<string, unknown>] => hasProperties(entry[1] as Record<string, unknown>))
        : []
    if (defs.length === 0) return undefined
    const timed = defs.find(([, def]) =>
        Object.entries(def.properties as Record<string, unknown>).some(
            ([name, property]) => isRecord(property) && (property.format === 'date-time' || TIME.test(nameKey(name))),
        ),
    )
    const [name, node] = timed ?? defs[0]
    return { pointer: `#/$defs/${name}`, node }
}

interface Leaf {
    /** Dotted path from the message class. */
    path: string
    name: string
    key: string
    /** `feuchte` for `feuchte.value`: the parent names the quantity. */
    parentKey: string
    schema: Record<string, unknown>
    type: string | undefined
}

/** The fields to fill; an optional one that cannot be followed is left out, a required one stops the draft. */
function leavesOf(
    node: Record<string, unknown>,
    root: Record<string, unknown>,
    prefix: string,
    depth: number,
    flat: boolean,
): { leaves: Leaf[] } | { problem: string } {
    const properties = isRecord(node.properties) ? node.properties : {}
    const required = new Set(Array.isArray(node.required) ? node.required.map(String) : [])
    for (const name of required) {
        if (!(name in properties)) return { problem: `das Pflichtfeld „${prefix}${name}“ fehlt in der Datenstruktur` }
    }
    const parentName = prefix.split('.').filter(Boolean).pop() ?? ''
    const leaves: Leaf[] = []
    for (const [name, raw] of Object.entries(properties)) {
        const path = `${prefix}${name}`
        const isRequired = required.has(name)
        const schema = deref(raw, root)
        if (!schema) {
            if (isRequired) return { problem: `das Pflichtfeld „${path}“ kommt aus einer anderen Datenstruktur` }
            continue
        }
        const type = typeOf(schema)
        const leaf: Leaf = { path, name, key: nameKey(name), parentKey: nameKey(parentName), schema, type }
        if (type === 'object' || type === 'array') {
            if (flat) {
                if (isRequired) return { problem: `das Pflichtfeld „${path}“ ist ${type === 'object' ? 'ein Objekt' : 'eine Liste'}, eine Tabellenzeile hat nur einfache Werte` }
                continue
            }
            if (type === 'object' && hasProperties(schema) && depth < MAX_DEPTH) {
                const nested = leavesOf(schema, root, `${path}.`, depth + 1, flat)
                if ('problem' in nested) {
                    if (isRequired) return nested
                    continue
                }
                if (nested.leaves.length > 0) leaves.push(...nested.leaves)
                else if (isRequired) leaves.push(leaf)
                continue
            }
            if (isRequired) leaves.push(leaf)
            continue
        }
        leaves.push(leaf)
    }
    return { leaves }
}

/** The initials of the title, the prefix of invented ids: "Zählstellen-Feed" → "ZF". */
function tagOf(title: string): string {
    const initials = title
        .split(/[^A-Za-z0-9ÄÖÜäöüß]+/)
        .filter(Boolean)
        .map((word) => compactName(word)[0])
        .join('')
        .toUpperCase()
    return (initials || 'ST').slice(0, 4)
}

function unitFor(quantity: string): string {
    if (CO2.test(quantity)) return 'ppm'
    if (AIR.test(quantity)) return 'ug/m3'
    if (PERCENT.test(quantity)) return '%'
    if (TEMPERATURE.test(quantity)) return 'Cel'
    if (SPEED.test(quantity)) return 'km/h'
    if (LEVEL.test(quantity)) return 'cm'
    return '1'
}

const numberOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** Declared bounds win; an open upper end grows per station, so three streams do not draw one curve. */
function range(schema: Record<string, unknown>, fallback: [number, number], index: number): [number, number] {
    const lower = numberOf(schema.minimum) ?? numberOf(schema.exclusiveMinimum)
    const upper = numberOf(schema.maximum) ?? numberOf(schema.exclusiveMaximum)
    const width = fallback[1] - fallback[0]
    let min = lower ?? fallback[0]
    let max = upper ?? Math.max(fallback[1], min + width) * (1 + 0.25 * index)
    if (max <= min) {
        // Only an upper bound below the fallback: keep it, and stay at zero or above where the fallback does.
        if (upper !== undefined && lower === undefined) {
            min = fallback[0] >= 0 && upper > 0 ? Math.max(0, upper - width) : upper - width
        } else {
            max = min + Math.max(1, width)
        }
    }
    return [round(min, 2), round(max, 2)]
}

interface Context {
    /** The station; 0 for a table. */
    index: number
    tag: string
    title: string
    /** A table draws many rows from one generator; a station keeps its identity. */
    table: boolean
}

function numberFor(leaf: Leaf, { index, table }: Context): GeneratorSpec {
    const { schema, key } = leaf
    const integer = leaf.type === 'integer'
    if (LAT.test(key) || LON.test(key)) {
        const centre = LAT.test(key) ? CENTRE.lat : CENTRE.lon
        if (table) return { kind: 'jitter', center: centre, spread: 0.03, precision: 6 }
        // A station does not move: one point per stream, a little apart.
        return { kind: 'constant', value: round(centre + (index - 1) * 0.012, 6) }
    }
    const quantity = GENERIC_VALUE.test(key) ? leaf.parentKey : key
    if (COUNT.test(quantity)) {
        const [min, max] = range(schema, [0, 40], index)
        return { kind: 'dailyProfile', min, max, peakHours: PEAK_HOURS[index % PEAK_HOURS.length], noise: 0.15, ...(integer ? { integer: true } : {}) }
    }
    const fallback: [number, number] = PERCENT.test(quantity)
        ? [10, 90]
        : CO2.test(quantity)
          ? [400, 1200]
          : AIR.test(quantity)
            ? [5, 60]
            : TEMPERATURE.test(quantity)
              ? [5, 25]
              : SPEED.test(quantity)
                ? [15, 50]
                : LEVEL.test(quantity)
                  ? [80, 220]
                  : [0, 100]
    // A share of a whole does not grow from station to station.
    const [min, max] = range(schema, fallback, PERCENT.test(quantity) ? 0 : index)
    const step = integer ? Math.max(1, Math.round((max - min) / 20)) : Math.max(0.01, round((max - min) / 20, 2))
    return { kind: 'randomWalk', min, max, step, ...(integer ? { integer: true } : {}) }
}

function textFor(leaf: Leaf, { index, tag, title, table }: Context): GeneratorSpec {
    const { schema, key } = leaf
    const format = schema.format
    if (format === 'date-time' || format === 'date' || format === 'time' || TIME.test(key)) return { kind: 'now' }
    if (UNIT.test(key)) return { kind: 'constant', value: unitFor(leaf.parentKey) }
    const examples = Array.isArray(schema.examples) ? schema.examples.filter((e): e is string => typeof e === 'string') : []
    if (examples.length > 0) return table ? { kind: 'enum', values: examples } : { kind: 'constant', value: examples[index % examples.length] }
    if (typeof schema.default === 'string') return { kind: 'constant', value: schema.default }
    if (ID.test(key)) {
        const id = (n: number) => `${tag}-${String(n).padStart(3, '0')}`
        return table ? { kind: 'enum', values: [1, 2, 3, 4, 5].map(id) } : { kind: 'constant', value: id(index + 1) }
    }
    const base = NAMED.test(key) ? title : leaf.name
    return table ? { kind: 'enum', values: [1, 2, 3].map((n) => `${base} ${n}`) } : { kind: 'constant', value: `${base} ${index + 1}` }
}

function generatorFor(leaf: Leaf, context: Context): GeneratorSpec {
    const { schema, type } = leaf
    if ('const' in schema) return { kind: 'constant', value: schema.const }
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return { kind: 'enum', values: schema.enum }
    if (type === 'boolean') return { kind: 'enum', values: [true, false] }
    if (type === 'array') return { kind: 'constant', value: [] }
    if (type === 'object') return { kind: 'constant', value: {} }
    if (type === 'integer' || type === 'number') return numberFor(leaf, context)
    if (type === 'null') return { kind: 'constant', value: null }
    return textFor(leaf, context)
}

/** The simulator's column types; coordinates stay plain numbers. */
function columnType(leaf: Leaf): 'text' | 'integer' | 'double' | 'boolean' | 'timestamptz' {
    if (leaf.type === 'integer') return 'integer'
    if (leaf.type === 'number') return 'double'
    if (leaf.type === 'boolean') return 'boolean'
    const format = leaf.schema.format
    if (format === 'date-time' || format === 'date' || TIME.test(leaf.key)) return 'timestamptz'
    return 'text'
}

/** The row key: as the structure marks it, else the first id-like text or integer column. */
function primaryKeyOf(leaves: Leaf[]): Leaf | undefined {
    return (
        leaves.find((leaf) => leaf.schema['x-core-primaryKey'] === true) ??
        leaves.find((leaf) => ID.test(leaf.key) && (leaf.type === 'string' || leaf.type === 'integer'))
    )
}

function mqttDraft({ title, subscription }: DraftInput, pointer: string, leaves: Leaf[]): BundledMqttSimulation | string {
    if (!subscription) return 'die Datenquelle abonniert kein Topic'
    const topicBase = subscription.replace(/\/[+#]$/, '')
    if (!topicBase || /[+#]/.test(topicBase)) return `aus dem Topic „${subscription}“ lässt sich keines zum Senden ableiten`
    const tag = tagOf(title)
    const slug = slugify(title).slice(0, 40).replace(/-+$/, '')
    return {
        sourceRef: title,
        messageClass: pointer,
        topicBase,
        intervalSeconds: MQTT_INTERVAL_SECONDS,
        streams: Array.from({ length: STREAMS }, (_, index) => ({
            name: `${slug}-${index + 1}`,
            label: clipLabel(`${title} ${index + 1}`),
            fields: Object.fromEntries(leaves.map((leaf) => [leaf.path, generatorFor(leaf, { index, tag, title, table: false })])),
        })),
    }
}

function sqlDraft({ title, table }: DraftInput, pointer: string, leaves: Leaf[]): BundledSqlSimulation | string {
    if (!table) return 'die Datenquelle nennt keine Tabelle'
    const key = primaryKeyOf(leaves)
    if (!key) return 'keine Spalte erkennbar, die jede Zeile eindeutig kennzeichnet (zum Beispiel baum_id)'
    const tag = tagOf(title)
    const context: Context = { index: 0, tag, title, table: true }
    const columns: Record<string, string> = {}
    const fields: Record<string, GeneratorSpec> = {}
    for (const leaf of leaves) {
        columns[leaf.path] = columnType(leaf)
        fields[leaf.path] =
            leaf === key
                ? { kind: 'sequence', prefix: key.type === 'string' ? `${tag}-` : '', padTo: key.type === 'string' ? 3 : 0 }
                : generatorFor(leaf, context)
    }
    // Rows with a time are measurements and keep coming; rows without are master data, written once.
    const growing = Object.values(fields).some((generator) => generator.kind === 'now')
    return {
        transport: 'sql',
        sourceRef: title,
        label: clipLabel(title),
        messageClass: pointer,
        table: { columns, primaryKey: key.path },
        fields,
        ...(growing
            ? { cadence: 'interval' as const, intervalSeconds: SQL_INTERVAL_SECONDS, seedRows: SQL_SEED_ROWS, insertsPerTick: 1, maxRows: SQL_MAX_ROWS }
            : { cadence: 'fillToLimit' as const, maxRows: SQL_MASTER_ROWS }),
    }
}

export function draftSimulation(input: DraftInput): Draft {
    const messageClass = messageClassOf(input.model)
    if (!messageClass) return { note: 'die Datenstruktur beschreibt keine Nachricht mit Feldern' }
    const walked = leavesOf(messageClass.node, input.model, '', 1, input.transport === 'sql')
    if ('problem' in walked) return { note: walked.problem }
    if (walked.leaves.length === 0) return { note: 'die Datenstruktur hat keine Felder, die sich erzeugen lassen' }
    const drafted = input.transport === 'sql' ? sqlDraft(input, messageClass.pointer, walked.leaves) : mqttDraft(input, messageClass.pointer, walked.leaves)
    if (typeof drafted === 'string') return { note: drafted }
    // The rules above should meet the catalogue's checks; if not, nothing half-right goes into a package.
    return simulationProblem(drafted, input.model) ? { note: 'die erzeugten Werte passen nicht zur Datenstruktur' } : { simulation: drafted }
}
