import { exportMetadataSchema, type ExportMetadata } from '@/lib/export/metadata'
import type { BundledSimulation, InstallParameter, PackageManifest, PackageMember } from '@/lib/catalog/types'
import type { InstanceSnapshot, SnapshotMapping } from '@/lib/export/portal-reader'
import { catalogUrn, isCatalogAuthored, isCoreUrn, logicalUrn, parseCoreUrn, slugify } from '@/lib/export/urn'
import { VALIDATE_BUNDLE_SCRIPT } from '@/lib/export/validate-bundle-script'

/**
 * Turns an instance snapshot into a CORE-IR package — the inverse of the
 * install path in `install-actions.ts`. Pure: no network, no clock unless
 * given one, so the interesting decisions (identity, references, secrets) are
 * testable in isolation.
 *
 * What changes on the way out:
 *   - identity: instance-minted URNs become catalogue URNs (derived, stable);
 *     catalogue-authored ones (scope `standard`) travel unchanged
 *   - references: versioned URNs become logical ones; pipeline source/sink
 *     references become bundle-local titles, as the package format demands
 *   - secrets: never leave the instance — stripped and declared as install
 *     parameters instead, so the receiving instance asks for its own
 *   - addresses: the instance's broker and database hosts give way to the
 *     neutral defaults the catalogue's packages carry; the receiving
 *     instance sets its own through the same install parameters
 *   - maps: a layer's sink and style ids become the sink's title and the
 *     styles' names, the references the install binds again
 */

export interface ExportOptions {
    metadata?: ExportMetadata
    /** URN owner of everything re-identified, and the id scheme (`urn:<publisher>:usecase:<slug>`). */
    publisher: string
    slug: string
    version: string
    displayName: string
    description: string
    maintainer: string
    license: string
    keywords: string[]
    /** URN domain segment for re-identified artifacts. */
    domain: string
    /** Demo data chosen for the package, already in package form (lib/export/simulations.ts). */
    simulations?: BundledSimulation[]
    provenance: {
        datasetId: string
        datasetName: string
        instance?: string
        exportedBy?: string
        exportedAt: string
    }
}

export interface IdentityChange {
    kind: 'datastructure' | 'mapping' | 'datasource' | 'datasink'
    title: string
    from?: string
    to: string
    kept: boolean
}

export interface StrippedField {
    file: string
    field: string
    reason: 'secret' | 'masked' | 'credential-in-url'
}

export interface ExportedPackage {
    manifest: PackageManifest
    /** Path relative to the package directory → content. */
    files: Record<string, string>
    identities: IdentityChange[]
    stripped: StrippedField[]
    parameters: { file: string; fields: string[] }[]
    warnings: string[]
}

const DATASOURCE_SCHEMA = 'https://civitasconnect.digital/core/datasource/v1'
const DATASINK_SCHEMA = 'https://civitasconnect.digital/core/datasink/v1'

/** Field names that carry credentials; matched case-insensitively as substrings. */
const SECRET_KEY = /(password|passwd|secret|token|api[-_]?key|credential|private[-_]?key|client[-_]?secret)/i
const MASKED_VALUE = /^\*{3,}$/
/** `scheme://user:password@host` — the password part is a credential in a URL-shaped value. */
const URL_CREDENTIAL = /^([a-z][a-z0-9+.-]*:\/\/[^/@:]+):([^/@]*)@/i

/**
 * Where a package's sources point until an instance says otherwise: the broker
 * and database names the catalogue's packages use for a local stack. The values
 * the instance read from are its own (cluster-internal hosts, its user), and an
 * install replaces them through the declared parameters anyway.
 */
const NEUTRAL_BROKER = 'tcp://civitas-mosquitto:1883'
const NEUTRAL_DB_HOST = 'localhost:5432'

/** The connector's address fields with the instance's hosts replaced; the database name stays (D14 compares it). */
function neutralAddresses(connectionType: string, configuration: Record<string, unknown>): Record<string, unknown> {
    const out = { ...configuration }
    if (connectionType === 'mqtt' && Array.isArray(out.urls)) out.urls = [NEUTRAL_BROKER]
    if (connectionType === 'sql' && typeof out.dsn === 'string') {
        out.dsn = out.dsn.replace(/^([a-z][a-z0-9+.-]*:\/\/)(?:[^@/]*@)?[^/]*/i, `$1${NEUTRAL_DB_HOST}`)
    }
    return out
}

/** Connector meta fields the package carries at the top level of the document, never inside the configuration. */
const CONNECTOR_META = new Set(['$schema', 'id', 'title', 'description', 'connectionType', 'element', 'dataStructureVersion'])
/**
 * The platform's sink output labels its configuration with the sink kind (`type`: FROST or
 * POSTGIS, a JSON subtype tag of the read API, not a setting). The package says the kind as
 * `connectionType`, and a FROST sink carrying `type` is refused at install: "FROST sinks
 * accept only a port and an optional element URN".
 */
const SINK_OUTPUT_ONLY = new Set(['type'])

const PARAMETER_LABELS: Record<string, InstallParameter> = {
    urls: { field: 'urls', label: 'Broker-URL(s)', description: 'Der Broker, den diese Instanz erreicht.' },
    dsn: { field: 'dsn', label: 'Datenbank-DSN', description: 'Verbindung zur Fachverfahrens-Datenbank dieser Instanz.' },
    user: { field: 'user', label: 'Datenbank-Benutzer' },
    password: { field: 'password', label: 'Datenbank-Passwort', description: 'Wird nie im Paket transportiert.' },
    client_id: { field: 'client_id', label: 'MQTT-Client-ID' },
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

function stringOr(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value : fallback
}

/**
 * A mapping's name in the package: its document title, or "Mapping 2" by its
 * position. The share page names it the same way, so what it shows is what
 * travels - never the instance's raw URN.
 */
export function mappingTitle(mapping: SnapshotMapping, index: number): string {
    return stringOr(mapping.document.title, `Mapping ${index + 1}`)
}

/** Whether a mapping has no title of its own and gets the made-up one. */
export function isUnnamedMapping(mapping: SnapshotMapping): boolean {
    return stringOr(mapping.document.title, '') === ''
}

function json(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`
}

/** File names must be unique inside core-ir/; a second "Messung" becomes messung-2. */
function fileNamer() {
    const used = new Set<string>()
    return (title: string, kind: string): string => {
        const base = slugify(title)
        let name = `${base}.${kind}.json`
        for (let n = 2; used.has(name); n++) name = `${base}-${n}.${kind}.json`
        used.add(name)
        return name
    }
}

/**
 * Removes credentials from a connector configuration, in place on a copy.
 * Three shapes are recognised: a field whose NAME says secret, a value the
 * platform already masked on read (`********`), and a password inside a
 * URL-shaped value. Each removal is reported so the preview and the merge
 * request can say what the receiving instance has to supply.
 */
function stripSecrets(
    configuration: Record<string, unknown>,
    file: string,
    stripped: StrippedField[],
): Record<string, unknown> {
    const clean: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(configuration)) {
        if (SECRET_KEY.test(key)) {
            stripped.push({ file, field: key, reason: 'secret' })
            continue
        }
        if (typeof value === 'string' && MASKED_VALUE.test(value)) {
            stripped.push({ file, field: key, reason: 'masked' })
            continue
        }
        if (typeof value === 'string' && URL_CREDENTIAL.test(value)) {
            clean[key] = value.replace(URL_CREDENTIAL, '$1@')
            stripped.push({ file, field: key, reason: 'credential-in-url' })
            continue
        }
        if (Array.isArray(value)) {
            clean[key] = value.map((item) =>
                typeof item === 'string' && URL_CREDENTIAL.test(item)
                    ? (stripped.push({ file, field: key, reason: 'credential-in-url' }), item.replace(URL_CREDENTIAL, '$1@'))
                    : item,
            )
            continue
        }
        clean[key] = value
    }
    return clean
}

function installParameters(
    connectorType: string,
    document: Record<string, unknown>,
    strippedFields: string[],
): InstallParameter[] {
    const wanted = connectorType === 'sql' ? ['dsn', 'user', 'password'] : connectorType === 'mqtt' ? ['urls'] : []
    const fields = new Set<string>([...wanted.filter((f) => f in document || strippedFields.includes(f)), ...strippedFields])
    return [...fields].map((field) => PARAMETER_LABELS[field] ?? { field, label: field })
}

/** Node positions the editor saved next to the model, re-attached as `x-ui-position` so the layout travels. */
function positionsOf(styles: Record<string, unknown> | undefined): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>()
    const nodes = styles && Array.isArray(styles.nodes) ? styles.nodes : []
    for (const node of nodes) {
        if (!isRecord(node) || typeof node.id !== 'string' || !isRecord(node.position)) continue
        const { x, y } = node.position
        if (typeof x === 'number' && typeof y === 'number') positions.set(node.id, { x, y })
    }
    return positions
}

export function transformSnapshot(snapshot: InstanceSnapshot, options: ExportOptions): ExportedPackage {
    const warnings = [...snapshot.warnings]
    const identities: IdentityChange[] = []
    const stripped: StrippedField[] = []
    const parameters: { file: string; fields: string[] }[] = []
    const files: Record<string, string> = {}
    const nameFile = fileNamer()
    const { publisher, domain } = options

    // ── Structures: the identity map every other member resolves against ──
    const urnMap = new Map<string, string>() // logical instance URN → package URN
    const structureMembers: PackageMember[] = []
    for (const structure of snapshot.structures) {
        const from = logicalUrn(structure.modelUrn)
        const kept = isCatalogAuthored(from)
        const to = kept ? from : catalogUrn(publisher, 'datastructure', domain, structure.name)
        urnMap.set(from, to)
        identities.push({ kind: 'datastructure', title: structure.name, from, to, kept })

        const model: Record<string, unknown> = { ...structure.model, $id: to }
        if (typeof model.title !== 'string' || !model.title) model.title = structure.name
        if (typeof model.description !== 'string' && structure.description) model.description = structure.description
        // Classes inside $defs carry element identities of their own; instance-minted ones are re-identified too.
        if (isRecord(model.$defs)) {
            const defs: Record<string, unknown> = {}
            for (const [defName, def] of Object.entries(model.$defs)) {
                if (isRecord(def) && isCoreUrn(def.$id) && !isCatalogAuthored(def.$id) && parseCoreUrn(def.$id)?.type === 'element') {
                    defs[defName] = { ...def, $id: catalogUrn(publisher, 'element', domain, `${structure.name} ${defName}`) }
                } else {
                    defs[defName] = def
                }
            }
            model.$defs = defs
        }
        const file = nameFile(structure.name, 'datastructure')
        files[`core-ir/${file}`] = json(model)
        structureMembers.push({ file })
    }
    const resolveStructure = (ref: unknown, where: string): string | undefined => {
        if (!isCoreUrn(ref)) return undefined
        const to = urnMap.get(logicalUrn(ref))
        if (!to) warnings.push(`${where}: Datenstruktur ${ref} ist nicht im Paket - der Verweis zeigt weiter auf diese Instanz`)
        return to ?? logicalUrn(ref)
    }
    const structureOfVersion = (versionId: string | undefined): string | undefined => {
        const structure = snapshot.structures.find((s) => s.versionId === versionId)
        return structure ? urnMap.get(logicalUrn(structure.modelUrn)) : undefined
    }

    // ── Sources ──
    const sourceMembers: PackageMember[] = []
    const sourceTitleByUrn = new Map<string, string>()
    for (const source of snapshot.sources) {
        const file = nameFile(source.name, 'datasource')
        const connectionType = source.connectorType.toLowerCase()
        const id = catalogUrn(publisher, 'datasource', domain, source.name)
        const configuration = neutralAddresses(connectionType, stripSecrets(
            Object.fromEntries(Object.entries(source.configuration).filter(([key]) => !CONNECTOR_META.has(key))),
            file,
            stripped,
        ))
        const element = structureOfVersion(source.structureVersionId) ?? resolveStructure(source.configuration.element, file)
        if (!element) warnings.push(`${file}: die Quelle nennt keine Struktur - element fehlt`)
        const document: Record<string, unknown> = {
            $schema: DATASOURCE_SCHEMA,
            id,
            title: source.name,
            ...(source.description ? { description: source.description } : {}),
            connectionType,
            ...(element ? { element } : {}),
            ...configuration,
        }
        files[`core-ir/${file}`] = json(document)
        const strippedHere = stripped.filter((s) => s.file === file).map((s) => s.field)
        const params = installParameters(connectionType, document, strippedHere)
        sourceMembers.push(params.length ? { file, parameters: params } : { file })
        if (params.length) parameters.push({ file, fields: params.map((p) => p.field) })
        if (source.configurationUrn) sourceTitleByUrn.set(logicalUrn(source.configurationUrn), source.name)
        identities.push({ kind: 'datasource', title: source.name, from: source.configurationUrn && logicalUrn(source.configurationUrn), to: id, kept: false })
    }

    // ── Mappings ──
    const mappingMembers: PackageMember[] = []
    const mappingUrnMap = new Map<string, string>()
    for (const [index, mapping] of snapshot.mappings.entries()) {
        const title = mappingTitle(mapping, index)
        const kept = isCatalogAuthored(mapping.urn)
        const to = kept ? mapping.urn : catalogUrn(publisher, 'mapping', domain, title)
        mappingUrnMap.set(mapping.urn, to)
        identities.push({ kind: 'mapping', title, from: mapping.urn, to, kept })
        const file = nameFile(title, 'mapping')
        const inner: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(mapping.document)) {
            if (['$schema', 'id', '$id', 'logicalUrn', 'positions', 'x-ui-styles'].includes(key)) continue
            inner[key] = value
        }
        for (const side of ['source', 'target'] as const) {
            const resolved = resolveStructure(inner[side], file)
            if (resolved) inner[side] = resolved
        }
        files[`core-ir/${file}`] = json({
            mappingUrn: to,
            name: title,
            ...(typeof mapping.document.description === 'string' ? { description: mapping.document.description } : {}),
            document: inner,
        })
        mappingMembers.push({ file })
    }

    // ── Sinks ──
    const sinkMembers: PackageMember[] = []
    const sinkTitleByUrn = new Map<string, string>()
    for (const sink of snapshot.sinks) {
        const file = nameFile(sink.name, 'datasink')
        const connectionType = sink.dataSinkType.toLowerCase()
        const id = catalogUrn(publisher, 'datasink', domain, sink.name)
        const configuration = stripSecrets(
            Object.fromEntries(Object.entries(sink.configuration).filter(([key]) => !CONNECTOR_META.has(key) && !SINK_OUTPUT_ONLY.has(key))),
            file,
            stripped,
        )
        const element = resolveStructure(sink.configuration.element, file) ?? structureOfVersion(sink.structureVersionId)
        if (!element) warnings.push(`${file}: die Senke nennt keine Zielstruktur - element fehlt`)
        const document: Record<string, unknown> = {
            $schema: DATASINK_SCHEMA,
            id,
            title: sink.name,
            connectionType,
            ...configuration,
            ...(element ? { element } : {}),
        }
        files[`core-ir/${file}`] = json(document)
        const strippedHere = stripped.filter((s) => s.file === file).map((s) => s.field)
        const params = installParameters(connectionType, document, strippedHere)
        sinkMembers.push(params.length ? { file, parameters: params } : { file })
        if (params.length) parameters.push({ file, fields: params.map((p) => p.field) })
        if (sink.configurationUrn) sinkTitleByUrn.set(logicalUrn(sink.configurationUrn), sink.name)
        identities.push({ kind: 'datasink', title: sink.name, from: sink.configurationUrn && logicalUrn(sink.configurationUrn), to: id, kept: false })
    }

    // ── Pipelines: the graph references bundle siblings by title, mappings by their package URN ──
    const pipelineMembers: PackageMember[] = []
    for (const pipeline of snapshot.pipelines) {
        const file = nameFile(pipeline.name, 'pipeline')
        const positions = positionsOf(pipeline.styles)
        const nodes = Array.isArray(pipeline.model.nodes) ? pipeline.model.nodes : []
        const rewritten = nodes.map((node) => {
            if (!isRecord(node)) return node
            const copy: Record<string, unknown> = { ...node }
            if (isCoreUrn(copy.sourceRef)) {
                const title = sourceTitleByUrn.get(logicalUrn(copy.sourceRef))
                if (title) copy.sourceRef = title
                else warnings.push(`${file}: sourceRef ${copy.sourceRef} gehört zu keiner Quelle des Pakets`)
            }
            if (isCoreUrn(copy.sinkRef)) {
                const title = sinkTitleByUrn.get(logicalUrn(copy.sinkRef))
                if (title) copy.sinkRef = title
                else warnings.push(`${file}: sinkRef ${copy.sinkRef} gehört zu keiner Senke des Pakets`)
            }
            if (isCoreUrn(copy.mappingRef)) {
                const to = mappingUrnMap.get(logicalUrn(copy.mappingRef))
                if (to) copy.mappingRef = to
                else warnings.push(`${file}: mappingRef ${copy.mappingRef} gehört zu keinem Mapping des Pakets`)
            }
            const position = typeof copy.id === 'string' ? positions.get(copy.id) : undefined
            if (position && !('x-ui-position' in copy)) copy['x-ui-position'] = position
            return copy
        })
        files[`core-ir/${file}`] = json({
            name: pipeline.name,
            ...(pipeline.description ? { description: pipeline.description } : {}),
            model: { ...pipeline.model, nodes: rewritten },
        })
        pipelineMembers.push({ file })
    }

    // ── Demo data: one member per scenario, named after the source it feeds ──
    const simulationMembers: PackageMember[] = []
    for (const simulation of options.simulations ?? []) {
        const file = nameFile(simulation.sourceRef, 'simulation')
        files[`core-ir/${file}`] = json(simulation)
        simulationMembers.push({ file })
    }

    // ── Geo members: named APIs, styles, and the layers that publish a sink ──
    // None carries an identity in a package; the install derives theirs. A layer
    // names its sink by title and its styles by name, the way the install binds them.
    const apiMembers: PackageMember[] = []
    for (const api of snapshot.apis ?? []) {
        const file = nameFile(api.slug, 'api')
        files[`core-ir/${file}`] = json({
            name: api.name,
            slug: api.slug,
            standard: api.standard,
            ...(api.version ? { version: api.version } : {}),
            ...(api.description ? { description: api.description } : {}),
        })
        apiMembers.push({ file })
    }
    const styleNameById = new Map<string, string>()
    const styleMembers: PackageMember[] = []
    for (const style of snapshot.styles ?? []) {
        styleNameById.set(style.id, style.name)
        const file = nameFile(style.name, 'style')
        files[`core-ir/${file}`] = json({ name: style.name, sldContent: style.sldContent })
        styleMembers.push({ file })
    }
    const sinkTitleById = new Map(snapshot.sinks.map((sink) => [sink.id, sink.name]))
    const layerMembers: PackageMember[] = []
    for (const layer of snapshot.layers ?? []) {
        const file = nameFile(layer.layerName, 'layer')
        const sinkRef = layer.dataSinkId ? sinkTitleById.get(layer.dataSinkId) : undefined
        if (!sinkRef) {
            // The install refuses a layer without its sink, so it stays home and says why.
            warnings.push(`Kartenebene ${layer.layerName}: ihre Senke ist nicht Teil des Pakets, die Ebene wird ausgelassen`)
            continue
        }
        const styleRef = (id: string) => {
            const name = styleNameById.get(id)
            if (!name) warnings.push(`${file}: Stil ${id} ist nicht Teil des Pakets, der Verweis entfällt`)
            return name
        }
        const defaultStyleRef = layer.defaultStyleId ? styleRef(layer.defaultStyleId) : undefined
        const alternativeStyleRefs = layer.alternativeStyleIds.map(styleRef).filter((name): name is string => !!name)
        files[`core-ir/${file}`] = json({
            layerName: layer.layerName,
            ...(layer.title ? { title: layer.title } : {}),
            ...(layer.description ? { description: layer.description } : {}),
            ...(layer.keywords.length ? { keywords: layer.keywords } : {}),
            sinkRef,
            ...(layer.attribute.length ? { attribute: layer.attribute } : {}),
            ...(layer.geometryColumnRef ? { geometryColumnRef: layer.geometryColumnRef } : {}),
            ...(layer.cqlFilter ? { cqlFilter: layer.cqlFilter } : {}),
            ...(defaultStyleRef ? { defaultStyleRef } : {}),
            ...(alternativeStyleRefs.length ? { alternativeStyleRefs } : {}),
            ...(layer.crs ? { crs: layer.crs } : {}),
            ...(layer.nativeBoundingBox ? { nativeBoundingBox: layer.nativeBoundingBox } : {}),
            ...(layer.latLonBoundingBox ? { latLonBoundingBox: layer.latLonBoundingBox } : {}),
        })
        layerMembers.push({ file })
    }

    const manifest: PackageManifest = {
        ...exportMetadataSchema.parse(options.metadata ?? {}),
        id: `urn:${publisher}:usecase:${options.slug}`,
        type: 'usecase',
        displayName: options.displayName,
        description: options.description,
        version: options.version,
        maintainer: options.maintainer,
        license: options.license,
        keywords: options.keywords,
        members: {
            dataStructures: structureMembers,
            dataSources: sourceMembers,
            mappings: mappingMembers,
            dataSinks: sinkMembers,
            pipelines: pipelineMembers,
            simulations: simulationMembers,
            dashboards: [],
            ...(apiMembers.length ? { apis: apiMembers } : {}),
            ...(styleMembers.length ? { styles: styleMembers } : {}),
            ...(layerMembers.length ? { layers: layerMembers } : {}),
        },
        dependencies: [],
    }
    files['core-ir/manifest.json'] = json(manifest)
    files['ci/validate-bundle.py'] = VALIDATE_BUNDLE_SCRIPT
    files['README.md'] = readme(manifest, options, identities, parameters, stripped)

    return { manifest, files, identities, stripped, parameters, warnings }
}

function readme(
    manifest: PackageManifest,
    options: ExportOptions,
    identities: IdentityChange[],
    parameters: { file: string; fields: string[] }[],
    stripped: StrippedField[],
): string {
    const members = (Object.entries(manifest.members) as [string, PackageMember[] | undefined][])
        .flatMap(([kind, list]) => (list ?? []).map((m) => `  ${m.file.padEnd(44)} <- ${kind}`))
        .join('\n')
    const identityRows = identities
        .map((i) => `| ${i.title} (${i.kind}) | \`${i.to}\` | ${i.kept ? 'kept from its catalogue package' : 'derived on export'} |`)
        .join('\n')
    const parameterRows = parameters.length
        ? parameters.map((p) => `- \`${p.file}\`: ${p.fields.map((f) => `\`${f}\``).join(', ')}`).join('\n')
        : '- none'
    const strippedRows = stripped.length
        ? [...new Set(stripped.map((s) => `- \`${s.file}\`: \`${s.field}\` (${s.reason})`))].join('\n')
        : '- none'
    const { provenance } = options
    return `# ${manifest.displayName} — CORE-IR Use-Case Package

${manifest.description}

Exported from a running CIVITAS/CORE instance through the Open Urban Apps
marketplace on ${provenance.exportedAt}${provenance.exportedBy ? ` by ${provenance.exportedBy}` : ''}
(dataset \`${provenance.datasetName}\`, id \`${provenance.datasetId}\`${provenance.instance ? `, instance ${provenance.instance}` : ''}).
Version ${manifest.version} · ${manifest.license} · maintained by ${manifest.maintainer}.

## Package layout (catalogue format v3)

\`\`\`
core-ir/
  manifest.json                                <- package document (entry point)
${members}
ci/
  validate-bundle.py                           <- run before opening a merge request
\`\`\`

Validate locally:

\`\`\`sh
python3 ci/validate-bundle.py
\`\`\`

## Install parameters

Fields the receiving instance supplies at install time (declared per member in
the manifest). Credentials never travel inside a package:

${parameterRows}

Stripped on export:

${strippedRows}

## Identity (URNs)

Scope \`standard\` marks catalogue-authored identities. Derived disambiguators
come from SHA-256 over \`${options.publisher}#<name>\`, so every instance computes
the identical identity; identities kept from a catalogue package are unchanged.

| Member | Logical CORE URN | Origin |
|---|---|---|
${identityRows}
`
}
