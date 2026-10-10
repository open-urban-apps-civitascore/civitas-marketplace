import { compactName, slugify } from '@/lib/export/urn'

/**
 * Drafts the demo-data scenario an exported datasource ships with, so a
 * package that left one instance can be tried on another without sensors.
 * The install's "Demo" mode registers it with the simulator and points the
 * datasource at the demo broker or database; every other mode ignores it, so
 * a draft never reaches a real broker.
 *
 * A draft, not a model of the real devices: it reads only the SOURCE
 * structure (property names, types, formats, enums, bounds) and the
 * datasource's subscription or table. Names steer the generators (a
 * `timestamp` gets the publish time, a `vehicleCount` a daily profile, a
 * `lat` a point near the default centre), and the publisher refines the
 * result in the package repository like any other member.
 *
 * Every draft meets the catalogue's own checks (lib/catalog/assemble.ts and
 * ci/validate-bundle.py): each field path exists in the message class, each
 * required property is produced, topicBase agrees with the subscription. A
 * source those checks would reject gets a note instead of a document.
 */

/** The simulator's generator vocabulary, including the two kinds the catalogue types do not spell out yet. */
export type DraftGenerator =
    | { kind: 'constant'; value: unknown }
    | { kind: 'now' }
    | { kind: 'enum'; values: unknown[] }
    | { kind: 'randomWalk'; min: number; max: number; step: number; integer?: boolean }
    | { kind: 'dailyProfile'; min: number; max: number; peakHours: number[]; noise: number; integer?: boolean }
    | { kind: 'sequence'; prefix: string; padTo: number }
    | { kind: 'jitter'; center: number; spread: number; precision: number }

export interface SimulationDraftInput {
    /** The datasource's title: the bundle-local handle a scenario names as `sourceRef`. */
    sourceTitle: string
    /** The exported datasource document: `connectionType` plus its configuration (`topics`, `table`, …). */
    source: Record<string, unknown>
    /** The SOURCE structure as exported. */
    structure: Record<string, unknown>
}

export type SimulationDraft = { document: Record<string, unknown> } | { note: string }

/** Streams per MQTT scenario: enough that a map or dashboard shows several stations. */
const STREAMS = 3
const MQTT_INTERVAL_SECONDS = 10
const SQL_INTERVAL_SECONDS = 30
const SQL_SEED_ROWS = 50
/** Measurements grow; the window keeps the re-read of every pipeline run small. */
const SQL_MAX_ROWS = 500
/** Master data (no timestamp) is written once, to this size. */
const SQL_MASTER_ROWS = 200
/** How deep the draft follows nested objects. */
const MAX_DEPTH = 3
/** The simulator names a stream after its label; the catalogue caps labels at 80 characters. */
const LABEL_MAX = 80
/** A neutral default for coordinates; the publisher moves it to the real place. */
const CENTRE = { lat: 52.52, lon: 13.405 }
const PEAK_HOURS = [[8, 17], [7, 8, 17, 18], [12, 19]]

// Name patterns run against `compactName`: lower case, umlauts transliterated, no separators.
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
// Not a bare /temp/: that would read `tempo` (speed) as a temperature.
const TEMPERATURE = /(temperatur|temp$|tempc$|tempf$)/
const SPEED = /(speed|geschwindigkeit|kmh|tempo)/
// `stand` only at the end: `standort` is a place, not a level.
const LEVEL = /(pegel|wasserstand|level|hoehe|depth|tiefe|stand$)/

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const round = (value: number, digits: number): number => Number(value.toFixed(digits))

const clipLabel = (label: string): string => (label.length <= LABEL_MAX ? label : label.slice(0, LABEL_MAX).trimEnd())

/** Matching names: `''` stays empty rather than becoming `compactName`'s 'unnamed'. */
const nameKey = (name: string): string => (name.trim() ? compactName(name) : '')

/**
 * Follows one bundle-internal `$ref`, exactly as far as the catalogue's checks
 * do. An external reference is opaque there (the walk would fail), so it
 * yields nothing here.
 */
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
    // A union decides by its first alternative: good enough for a demo value.
    for (const key of ['oneOf', 'anyOf']) {
        const options = schema[key]
        if (Array.isArray(options) && isRecord(options[0])) return typeOf(options[0])
    }
    return undefined
}

// A plain boolean, not a type guard: as a guard, its false branch would narrow a Record to `never`.
const hasProperties = (node: Record<string, unknown> | undefined): boolean =>
    !!node && isRecord(node.properties) && Object.keys(node.properties).length > 0

/**
 * The class a message instantiates, as the JSON pointer the catalogue
 * expects: the root's `$ref` if it has one (`#/$defs/Messung`), the root
 * itself if it carries properties (`#`), else the one class in `$defs`.
 * Among several, the one with a time wins, since that is the measurement and
 * the rest master data.
 */
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
    /** Dotted path from the message class, the field key of the scenario. */
    path: string
    name: string
    key: string
    /** The enclosing object's key: `pm25.value` is a fine-dust value, `feuchte.unit` a percentage's unit. */
    parentKey: string
    schema: Record<string, unknown>
    type: string | undefined
}

/**
 * Walks the message class into dotted leaf paths. Optional properties the
 * checks could not follow (external refs, arrays, objects too deep or, for a
 * table, objects at all) are left out; a REQUIRED one of those makes the
 * whole draft impossible, and the reason says which.
 */
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
        if (!(name in properties)) return { problem: `Pflichtfeld '${prefix}${name}' ist keine Eigenschaft der Struktur` }
    }
    const parentName = prefix.split('.').filter(Boolean).pop() ?? ''
    const leaves: Leaf[] = []
    for (const [name, raw] of Object.entries(properties)) {
        const path = `${prefix}${name}`
        const isRequired = required.has(name)
        const schema = deref(raw, root)
        if (!schema) {
            if (isRequired) return { problem: `Pflichtfeld '${path}' verweist auf eine fremde Struktur` }
            continue
        }
        const type = typeOf(schema)
        const leaf: Leaf = { path, name, key: nameKey(name), parentKey: nameKey(parentName), schema, type }
        if (type === 'object' || type === 'array') {
            if (flat) {
                if (isRequired) return { problem: `Pflichtfeld '${path}' ist ${type === 'object' ? 'ein Objekt' : 'eine Liste'}, eine Tabellenzeile ist flach` }
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
            // An empty object or a list is produced only where the structure demands it.
            if (isRequired) leaves.push(leaf)
            continue
        }
        leaves.push(leaf)
    }
    return { leaves }
}

/** Initials of the source title, the prefix of the ids a draft invents: "Zählstellen-Feed" → "ZF". */
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

/**
 * The declared bounds win; the fallback fills what the structure leaves open.
 * An open upper end grows from station to station, so three streams do not
 * draw the same curve.
 */
function range(schema: Record<string, unknown>, fallback: [number, number], index: number): [number, number] {
    const lower = numberOf(schema.minimum) ?? numberOf(schema.exclusiveMinimum)
    const upper = numberOf(schema.maximum) ?? numberOf(schema.exclusiveMaximum)
    const width = fallback[1] - fallback[0]
    let min = lower ?? fallback[0]
    let max = upper ?? Math.max(fallback[1], min + width) * (1 + 0.25 * index)
    if (max <= min) {
        // Only an upper bound below the fallback gets here: keep it and open the lower end,
        // not below zero for a quantity that is never negative.
        if (upper !== undefined && lower === undefined) {
            min = fallback[0] >= 0 && upper > 0 ? Math.max(0, upper - width) : upper - width
        } else {
            max = min + Math.max(1, width)
        }
    }
    return [round(min, 2), round(max, 2)]
}

interface Context {
    /** Which stream (MQTT); 0 for a table. */
    index: number
    tag: string
    title: string
    /** A table draws many rows from one generator; a stream is one station with fixed identity. */
    table: boolean
}

function numberFor(leaf: Leaf, { index, table }: Context): DraftGenerator {
    const { schema, key } = leaf
    const integer = leaf.type === 'integer'
    if (LAT.test(key) || LON.test(key)) {
        const centre = LAT.test(key) ? CENTRE.lat : CENTRE.lon
        if (table) return { kind: 'jitter', center: centre, spread: 0.03, precision: 6 }
        // A station does not move: one fixed point per stream, a little apart.
        return { kind: 'constant', value: round(centre + (index - 1) * 0.012, 6) }
    }
    // `pm25.value`: the parent names the quantity.
    const quantity = GENERIC_VALUE.test(key) ? leaf.parentKey : key
    if (COUNT.test(quantity)) {
        const [min, max] = range(schema, [0, 40], index)
        return {
            kind: 'dailyProfile',
            min,
            max,
            peakHours: PEAK_HOURS[index % PEAK_HOURS.length],
            noise: 0.15,
            ...(integer ? { integer: true } : {}),
        }
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
    const [min, max] = range(schema, fallback, index)
    const step = integer ? Math.max(1, Math.round((max - min) / 20)) : Math.max(0.01, round((max - min) / 20, 2))
    return { kind: 'randomWalk', min, max, step, ...(integer ? { integer: true } : {}) }
}

function textFor(leaf: Leaf, { index, tag, title, table }: Context): DraftGenerator {
    const { schema, key } = leaf
    const format = schema.format
    if (format === 'date-time' || format === 'date' || format === 'time' || TIME.test(key)) return { kind: 'now' }
    if (UNIT.test(key)) return { kind: 'constant', value: unitFor(leaf.parentKey) }
    const examples = Array.isArray(schema.examples) ? schema.examples.filter((e): e is string => typeof e === 'string') : []
    if (examples.length > 0) {
        return table ? { kind: 'enum', values: examples } : { kind: 'constant', value: examples[index % examples.length] }
    }
    if (typeof schema.default === 'string') return { kind: 'constant', value: schema.default }
    if (ID.test(key)) {
        const id = (n: number) => `${tag}-${String(n).padStart(3, '0')}`
        return table ? { kind: 'enum', values: [1, 2, 3, 4, 5].map(id) } : { kind: 'constant', value: id(index + 1) }
    }
    const base = NAMED.test(key) ? title : leaf.name
    return table ? { kind: 'enum', values: [1, 2, 3].map((n) => `${base} ${n}`) } : { kind: 'constant', value: `${base} ${index + 1}` }
}

function generatorFor(leaf: Leaf, context: Context): DraftGenerator {
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

/** The simulator's column types; coordinates stay plain numbers until the sink builds the point. */
function columnType(leaf: Leaf): 'text' | 'integer' | 'double' | 'boolean' | 'timestamptz' {
    if (leaf.type === 'integer') return 'integer'
    if (leaf.type === 'number') return 'double'
    if (leaf.type === 'boolean') return 'boolean'
    const format = leaf.schema.format
    if (format === 'date-time' || format === 'date' || TIME.test(leaf.key)) return 'timestamptz'
    return 'text'
}

/** The row key: what the structure marks as such, else the first id-like text or integer column. */
function primaryKeyOf(leaves: Leaf[]): Leaf | undefined {
    return (
        leaves.find((leaf) => leaf.schema['x-core-primaryKey'] === true) ??
        leaves.find((leaf) => ID.test(leaf.key) && (leaf.type === 'string' || leaf.type === 'integer'))
    )
}

function mqttDraft(input: SimulationDraftInput, pointer: string, leaves: Leaf[], skip: (reason: string) => SimulationDraft): SimulationDraft {
    const { sourceTitle, source } = input
    const topics = source.topics
    const subscription = Array.isArray(topics) && typeof topics[0] === 'string' ? topics[0] : undefined
    if (!subscription) return skip('die Quelle abonniert kein MQTT-Topic')
    // `a/b/+` and `a/b/#` give each stream a subtopic of `a/b`; an exact topic carries them all.
    const topicBase = subscription.replace(/\/[+#]$/, '')
    if (!topicBase || /[+#]/.test(topicBase)) {
        return skip(`aus dem Abonnement '${subscription}' lässt sich kein Topic zum Senden ableiten`)
    }
    const tag = tagOf(sourceTitle)
    // Stream names become simulator ids under the installation's prefix, so they stay unique across the package.
    const slug = slugify(sourceTitle).slice(0, 40).replace(/-+$/, '')
    const streams = Array.from({ length: STREAMS }, (_, index) => ({
        name: `${slug}-${index + 1}`,
        label: clipLabel(`${sourceTitle} ${index + 1}`),
        fields: Object.fromEntries(
            leaves.map((leaf) => [leaf.path, generatorFor(leaf, { index, tag, title: sourceTitle, table: false })]),
        ),
    }))
    return {
        document: {
            sourceRef: sourceTitle,
            messageClass: pointer,
            topicBase,
            intervalSeconds: MQTT_INTERVAL_SECONDS,
            streams,
        },
    }
}

function sqlDraft(input: SimulationDraftInput, pointer: string, leaves: Leaf[], skip: (reason: string) => SimulationDraft): SimulationDraft {
    const { sourceTitle, source } = input
    if (typeof source.table !== 'string' || !source.table) return skip('die Quelle nennt keine Tabelle')
    const key = primaryKeyOf(leaves)
    if (!key) return skip('keine Schlüsselspalte erkennbar (x-core-primaryKey oder eine Kennung wie baum_id)')
    const tag = tagOf(sourceTitle)
    const context: Context = { index: 0, tag, title: sourceTitle, table: true }
    const columns: Record<string, string> = {}
    const fields: Record<string, DraftGenerator> = {}
    for (const leaf of leaves) {
        columns[leaf.path] = columnType(leaf)
        fields[leaf.path] =
            leaf === key
                ? // The only generator that mints a unique key; an integer key counts without a prefix.
                  { kind: 'sequence', prefix: key.type === 'string' ? `${tag}-` : '', padTo: key.type === 'string' ? 3 : 0 }
                : generatorFor(leaf, context)
    }
    // Rows with a time are measurements and keep arriving; rows without are master data, written once.
    const growing = Object.values(fields).some((generator) => generator.kind === 'now')
    return {
        document: {
            sourceRef: sourceTitle,
            transport: 'sql',
            label: clipLabel(sourceTitle),
            messageClass: pointer,
            table: { columns, primaryKey: key.path },
            ...(growing
                ? {
                      cadence: 'interval',
                      intervalSeconds: SQL_INTERVAL_SECONDS,
                      seedRows: SQL_SEED_ROWS,
                      insertsPerTick: 1,
                      maxRows: SQL_MAX_ROWS,
                  }
                : { cadence: 'fillToLimit', maxRows: SQL_MASTER_ROWS }),
            fields,
        },
    }
}

export function draftSimulation(input: SimulationDraftInput): SimulationDraft {
    const { sourceTitle, source, structure } = input
    const skip = (reason: string): SimulationDraft => ({
        note: `Demodaten für „${sourceTitle}“: ${reason} - keine Simulation erzeugt`,
    })
    const transport = typeof source.connectionType === 'string' ? source.connectionType.toLowerCase() : ''
    if (transport !== 'mqtt' && transport !== 'sql') {
        return skip(`der Simulator speist nur MQTT- und SQL-Quellen, diese ist ${transport || 'ohne Typ'}`)
    }
    const messageClass = messageClassOf(structure)
    if (!messageClass) return skip('die Struktur beschreibt keine Nachricht mit Eigenschaften')
    const walked = leavesOf(messageClass.node, structure, '', 1, transport === 'sql')
    if ('problem' in walked) return skip(walked.problem)
    if (walked.leaves.length === 0) return skip('die Struktur hat keine Felder, die sich erzeugen lassen')
    return transport === 'sql'
        ? sqlDraft(input, messageClass.pointer, walked.leaves, skip)
        : mqttDraft(input, messageClass.pointer, walked.leaves, skip)
}
