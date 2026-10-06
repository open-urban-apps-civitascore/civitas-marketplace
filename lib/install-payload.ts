/**
 * Pure helpers for the install payloads. Separate from `install-actions.ts` because that file is
 * a `'use server'` module, where every export must be an async server action — a synchronous
 * helper cannot live there, and a pure function is worth testing on its own.
 */

import {
    isDataStructureEntry,
    type BundledPipeline,
    type CatalogEntry,
    type UseCaseEntry,
} from '@/lib/catalog/types'
import {
    compactName,
    deriveDisambiguator,
    isCoreUrn,
    logicalUrn,
    parseCoreUrn,
} from '@/lib/export/urn'

/**
 * The portal caps every description at this length: `MAX_DESCRIPTION_LENGTH` in its
 * `types/common.ts`, applied as `z.string().trim().max(…)` to structures, sources and datasets
 * alike. It is a frontend rule — the API stores an over-long text without complaint, so the
 * problem only surfaces later, when the edit form refuses to save until someone rewrites text
 * they did not author.
 *
 * Because the constant is portal-wide rather than per-form, every description this app sends
 * goes through the clamp, not just the fields whose forms are known to enforce it today.
 */
export const DESCRIPTION_MAX_LENGTH = 150

/**
 * Fits a catalogue description into the portal's description field.
 *
 * The catalogue's own text is the right length for the catalogue — the package page shows it in
 * full, and the schema keeps it verbatim inside the imported model. Shortening the fixtures to
 * suit one downstream field would degrade the place the text was written for, so the cut happens
 * here, at the seam where catalogue form is translated into portal wire form.
 *
 * A non-string description is dropped rather than coerced: the connector documents are untyped
 * JSON, and a number or object in that slot is an authoring error, not a description.
 */
export function clampDescription(text: unknown): string | undefined {
    if (typeof text !== 'string') return undefined
    // The portal trims before it measures, so the clamp has to measure the same string.
    const trimmed = text.trim()
    if (trimmed.length <= DESCRIPTION_MAX_LENGTH) return trimmed

    // The ellipsis counts toward the limit — it is what tells the reader the text continues
    // somewhere (in the catalogue, and in the model's own description).
    const head = trimmed.slice(0, DESCRIPTION_MAX_LENGTH - 1)
    const lastSpace = head.lastIndexOf(' ')
    // Cutting mid-word reads like corruption; cutting at a word boundary reads like an excerpt.
    // A text with no space at all in that range has no boundary to honour and is cut hard.
    const cut = lastSpace > 0 ? head.slice(0, lastSpace) : head
    // Trailing punctuation before an ellipsis ("Kontext —…") reads like a typo.
    return `${cut.replace(/[\s,;:—–-]+$/u, '')}…`
}

/**
 * Applies the user's broker URL to every bundled datasource that DECLARES
 * `urls` as an install parameter — and only to those. The manifest decides
 * which connector fields are instance-local; a blanket rewrite would let the
 * install dialog reach into fields the package never offered for override.
 */
export function applyDeclaredUrlOverride<
    T extends { document: Record<string, unknown>; parameters?: { field: string }[] },
>(dataSources: T[], brokerUrl: string): T[] {
    const url = brokerUrl.trim()
    if (!url) return dataSources
    return dataSources.map((source) =>
        source.parameters?.some((parameter) => parameter.field === 'urls')
            ? { ...source, document: { ...source.document, urls: [url] } }
            : source,
    )
}

/**
 * The broker URL an install applies to the datasources that declare `urls` as
 * an install parameter. 'custom' is the user's address. 'demo' points the
 * NiFi subscription at the broker the simulator publishes to — but from the
 * PLATFORM's perspective, which is why this is DEMO_DATASOURCE_BROKER_URL and
 * deliberately NOT SIMULATOR_BROKER_URL: the two describe the same broker from
 * two networks. Locally the simulator publishes from the host
 * (tcp://localhost:1884) while NiFi subscribes inside the compose network
 * (the package default tcp://civitas-mosquitto:1883 — so the variable stays
 * UNSET locally and the default stands). On a cluster both perspectives
 * coincide and both variables carry the same in-cluster DNS name. The value
 * must use the `tcp://` scheme: NiFi's MQTT processors reject `mqtt://`.
 */
export function resolveBrokerOverride(
    mode: 'demo' | 'custom' | 'later',
    customBrokerUrl: string,
    demoDatasourceBrokerUrl: string | undefined,
): string {
    if (mode === 'custom') return customBrokerUrl.trim()
    if (mode === 'demo') return demoDatasourceBrokerUrl?.trim() ?? ''
    return ''
}

/**
 * Splits a connection string into the three fields a datasource document keeps
 * apart. Credentials do not stay in the address: `password` is a field the
 * platform encrypts before the registry sees it, and an address carrying
 * `user:pass@` would hand them over in clear instead.
 *
 * Returns undefined for anything unparseable, so a mistyped setting leaves the
 * package default standing rather than writing half an address.
 */
export function splitConnectionString(
    connectionString: string,
): { dsn: string; user?: string; password?: string } | undefined {
    const raw = connectionString.trim()
    if (!raw) return undefined
    let parsed: URL
    try {
        parsed = new URL(raw)
    } catch {
        return undefined
    }
    let user: string
    let password: string
    try {
        user = decodeURIComponent(parsed.username)
        password = decodeURIComponent(parsed.password)
    } catch {
        // A bare '%' in the credentials (a password like '50%off' written without
        // encoding) parses as a URL but does not decode. Treated like any other
        // unparseable setting: no override, rather than a failed install.
        return undefined
    }
    parsed.username = ''
    parsed.password = ''
    return {
        dsn: parsed.toString(),
        ...(user ? { user } : {}),
        ...(password ? { password } : {}),
    }
}

/**
 * The SQL counterpart of {@link applyDeclaredUrlOverride}: applies a connection
 * string to every bundled datasource that DECLARES the matching field as an
 * install parameter, and only to those. Same rule as the broker — the manifest
 * decides which connector fields are instance-local.
 *
 * Each of `dsn`, `user` and `password` is written only where the package
 * offered it, so a package that asks for an address but keeps its own user
 * still gets its user.
 */
export function applyDeclaredDsnOverride<
    T extends { document: Record<string, unknown>; parameters?: { field: string }[] },
>(dataSources: T[], connectionString: string): T[] {
    const parts = splitConnectionString(connectionString)
    if (!parts) return dataSources
    return dataSources.map((source) => {
        const declares = (field: string) =>
            source.parameters?.some((parameter) => parameter.field === field) ?? false
        if (!declares('dsn')) return source
        return {
            ...source,
            document: {
                ...source.document,
                dsn: parts.dsn,
                ...(parts.user && declares('user') ? { user: parts.user } : {}),
                ...(parts.password && declares('password') ? { password: parts.password } : {}),
            },
        }
    })
}

/**
 * The connection string an install applies to the datasources that declare
 * `dsn` as an install parameter. Only 'demo' resolves to anything: it points
 * the platform at the database the demo generator writes to, so the SQL half
 * of a demo install needs no typing — exactly as 'demo' already does for the
 * broker.
 *
 * The generator compares DATABASE NAMES before it writes (D14). Its own
 * DEMO_DB_DSN and this setting must therefore name the same database, which is
 * why this is the platform's view of the SAME address rather than a second
 * database.
 *
 * 'custom' and 'later' resolve to nothing on purpose: pointing the platform at
 * an operator's own database is the deferred case in D14, and it needs stored
 * install parameters and a decision about the generator's write reach. Until
 * then the package default stands and the address is edited in the portal.
 */
export function resolveDsnOverride(
    mode: 'demo' | 'custom' | 'later',
    demoDatasourceDbDsn: string | undefined,
): string {
    return mode === 'demo' ? (demoDatasourceDbDsn?.trim() ?? '') : ''
}

/**
 * Where a member came from, as the description of last resort.
 *
 * The platform requires a description on structures, sources and datasets, and the portal's edit
 * form refuses to save without one. A member that ships none would fail the whole install over a
 * missing sentence, so it gets the one statement that is true for every member of every package:
 * which package and version it came from. Short by construction.
 */
export function versionProvenance(displayName: string, version: string): string {
    const line = `Aus Paket ${displayName} ${version}`
    if (line.length <= DESCRIPTION_MAX_LENGTH) {
        return line
    }
    // A pathologically long package name must not reintroduce the invalid-form state this
    // function exists to prevent: the version stays, the name gives way.
    const room = DESCRIPTION_MAX_LENGTH - `Aus Paket … ${version}`.length
    return `Aus Paket ${displayName.slice(0, Math.max(0, room))}… ${version}`
}

/** The six kinds of member the platform installs, in the spelling its API reads. */
export type PackageMemberKind =
    | 'datastructure'
    | 'datasource'
    | 'dataset'
    | 'mapping'
    | 'datasink'
    | 'pipeline'

export interface PackageMemberRequest {
    kind: PackageMemberKind
    /**
     * The member's identity inside the package. The receiving instance mints its own and keeps
     * this one as the origin of the copy; siblings use it to refer to one another.
     */
    urn: string
    name: string
    description?: string
    content: Record<string, unknown>
}

/** The body of `POST /v1/installations`. */
export interface InstallationRequest {
    /** Where sources and the dataset are created. Instance knowledge, so never package content. */
    datapoolId?: string
    package: {
        id: string
        version: string
        title: string
        members: PackageMemberRequest[]
    }
}

/**
 * A package that cannot be turned into a request. Raised before anything is sent, so a broken
 * reference costs the user one clear sentence instead of a rejection about a URN they never wrote.
 */
export class InstallPayloadError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'InstallPayloadError'
    }
}

/**
 * Connector fields the packages still carry and the platform no longer accepts. `client_id`: every
 * pipeline opens its own broker session, so a fixed client id would make two pipelines evict each
 * other, and the datasource schema rejects the field outright. Dropped here until the packages
 * stop shipping it.
 */
const RETIRED_SOURCE_FIELDS: readonly string[] = ['client_id']

type ReferencedKind = 'datasource' | 'mapping' | 'datasink'

/** Node fields of a pipeline that reference a sibling member, and the kind each one expects. */
const REFERENCE_FIELDS: [field: string, kind: ReferencedKind][] = [
    ['sourceRef', 'datasource'],
    ['lookupSourceRef', 'datasource'],
    ['mappingRef', 'mapping'],
    ['sinkRef', 'datasink'],
]

const REFERENCED_KIND_LABELS: Record<ReferencedKind, string> = {
    datasource: 'Datenquelle',
    mapping: 'Mapping',
    datasink: 'Datensenke',
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function packageMember(
    kind: PackageMemberKind,
    urn: string,
    name: string,
    description: string | undefined,
    content: Record<string, unknown>,
): PackageMemberRequest {
    return { kind, urn, name, ...(description ? { description } : {}), content }
}

/**
 * Member identities are compared and rewritten by the platform as CORE URNs, so anything else is
 * refused here, where the message can still name the member it belongs to.
 */
function requireIdentity(value: unknown, what: string): string {
    if (isCoreUrn(value)) return value
    const found = typeof value === 'string' && value ? `„${value}“` : 'keine'
    throw new InstallPayloadError(`${what} braucht eine CORE-URN als Kennung, gefunden: ${found}.`)
}

function requireTitle(document: Record<string, unknown>, what: string): string {
    const title = document.title
    if (typeof title === 'string' && title.trim()) return title
    throw new InstallPayloadError(`${what} ohne Titel (${String(document.id ?? 'ohne Kennung')}).`)
}

function withoutFields(
    document: Record<string, unknown>,
    fields: readonly string[],
): Record<string, unknown> {
    const copy = { ...document }
    for (const field of fields) delete copy[field]
    return copy
}

/**
 * Publisher and subject area of a package, read from the first member that states them. Dataset
 * and pipeline have no identity of their own in a package, and theirs must live in the same
 * namespace as the members that do.
 */
function packageNamespace(entry: UseCaseEntry): { owner: string; domain: string } {
    const identities = [
        ...entry.bundle.dataStructures.map((structure) => structure.model.$id),
        ...entry.bundle.dataSources.map((source) => source.document.id),
    ]
    for (const identity of identities) {
        const parsed = parseCoreUrn(identity)
        if (parsed) return { owner: parsed.owner, domain: parsed.domain }
    }
    throw new InstallPayloadError(
        'Kein Mitglied des Pakets trägt eine CORE-URN, aus der sich Herausgeber und Fachbereich ablesen lassen.',
    )
}

/**
 * An identity for a member the package does not identify itself. Built like every catalogue
 * identity, with one difference: the disambiguator derives from the PACKAGE and the member, not
 * from the publisher alone. Two packages of one publisher may each ship a pipeline called
 * "Kataster-Import", and those are not the same pipeline.
 */
function derivedIdentity(
    entry: UseCaseEntry,
    namespace: { owner: string; domain: string },
    kind: 'dataset' | 'pipeline',
    title: string,
): string {
    const name = compactName(title)
    const disambiguator = deriveDisambiguator(`${entry.manifest.id}#${kind}#${name}`)
    return `urn:core:standard:${namespace.owner}:${kind}:${namespace.domain}:${name}:${disambiguator}`
}

/** Title to package URN for one kind. A title two members share maps to null: it names neither. */
function handleIndex(members: PackageMemberRequest[]): Map<string, string | null> {
    const index = new Map<string, string | null>()
    for (const { name, urn } of members) index.set(name, index.has(name) ? null : urn)
    return index
}

/**
 * A copy of the pipeline model in which every node reference is a package URN. Only the four
 * reference fields are touched; everything else in the graph travels as authored.
 */
function withResolvedReferences(
    pipeline: BundledPipeline,
    handles: Record<ReferencedKind, Map<string, string | null>>,
): Record<string, unknown> {
    const nodes = pipeline.model.nodes
    // A model without a node list is the platform's to refuse; it says so more precisely.
    if (!Array.isArray(nodes)) return pipeline.model
    return {
        ...pipeline.model,
        nodes: nodes.map((node: unknown) => {
            if (!isRecord(node)) return node
            const resolved: Record<string, unknown> = { ...node }
            for (const [field, kind] of REFERENCE_FIELDS) {
                const value = node[field]
                if (typeof value !== 'string' || !value.trim() || value.startsWith('urn:')) continue
                const urn = handles[kind].get(value)
                if (urn === undefined) {
                    throw new InstallPayloadError(
                        `Pipeline „${pipeline.name}“ verweist in ${field} auf „${value}“, aber das Paket enthält keine ${REFERENCED_KIND_LABELS[kind]} mit diesem Titel.`,
                    )
                }
                if (urn === null) {
                    throw new InstallPayloadError(
                        `Pipeline „${pipeline.name}“ verweist in ${field} auf „${value}“, aber mehrere Mitglieder tragen diesen Titel.`,
                    )
                }
                resolved[field] = urn
            }
            return resolved
        }),
    }
}

function requireDistinctIdentities(members: PackageMemberRequest[]): void {
    const seen = new Set<string>()
    for (const { urn, name } of members) {
        const identity = logicalUrn(urn)
        if (seen.has(identity)) {
            throw new InstallPayloadError(
                `Zwei Mitglieder tragen dieselbe Kennung ${identity} (zuletzt „${name}“).`,
            )
        }
        seen.add(identity)
    }
}

/**
 * Translates a catalogue entry into the platform's installation request.
 *
 * The package format and the request differ in three places, and this function is the whole seam
 * between them:
 *
 * - A package has no dataset member: the use case IS the dataset. One is derived from the
 *   manifest, because mappings, sinks and pipelines need a dataset to belong to.
 * - Pipeline nodes may name a source, sink or mapping by its TITLE. The platform resolves
 *   references by URN only, so a title is translated to the package URN of the sibling it names.
 *   A value that already is a URN passes through untouched.
 * - Dataset and pipeline carry no identity in a package. Theirs is derived from the package id
 *   and their name, so the same package always sends the same URNs.
 *
 * Everything else travels as authored: the platform strips the documents' own labels itself and
 * binds every reference to the copy it makes.
 */
export function buildInstallationRequest(
    entry: CatalogEntry,
    datapoolId?: string,
): InstallationRequest {
    const header = {
        id: entry.manifest.id,
        version: entry.manifest.version,
        title: entry.manifest.displayName,
    }
    const provenance = versionProvenance(entry.manifest.displayName, entry.manifest.version)
    // Structures, sources and datasets must carry a description; the other kinds may go without.
    const requiredDescription = (text: unknown) => clampDescription(text) || provenance

    if (isDataStructureEntry(entry)) {
        // A structure on its own belongs to no datapool, so none is sent even if one was chosen.
        return {
            package: {
                ...header,
                members: [
                    packageMember(
                        'datastructure',
                        requireIdentity(
                            entry.artifact.$id,
                            `Datenstruktur „${entry.manifest.displayName}“`,
                        ),
                        entry.manifest.displayName,
                        requiredDescription(entry.manifest.description),
                        entry.artifact,
                    ),
                ],
            },
        }
    }

    const { bundle } = entry
    const namespace = packageNamespace(entry)

    const structures = bundle.dataStructures.map((structure) =>
        packageMember(
            'datastructure',
            requireIdentity(structure.model.$id, `Datenstruktur „${structure.name}“`),
            structure.name,
            requiredDescription(structure.description),
            structure.model,
        ),
    )
    const sources = bundle.dataSources.map((source) => {
        const title = requireTitle(source.document, 'Datenquelle')
        return packageMember(
            'datasource',
            requireIdentity(source.document.id, `Datenquelle „${title}“`),
            title,
            requiredDescription(source.document.description),
            withoutFields(source.document, RETIRED_SOURCE_FIELDS),
        )
    })
    const dataset = packageMember(
        'dataset',
        derivedIdentity(entry, namespace, 'dataset', entry.manifest.displayName),
        entry.manifest.displayName,
        requiredDescription(entry.manifest.description),
        // Publishing as open data is the operator's decision, never a package default.
        { openDataAccess: false },
    )
    const mappings = bundle.mappings.map((mapping) =>
        packageMember(
            'mapping',
            requireIdentity(mapping.mappingUrn, `Mapping „${mapping.name}“`),
            mapping.name,
            clampDescription(mapping.description),
            mapping.document,
        ),
    )
    const sinks = bundle.dataSinks.map((sink) => {
        const title = requireTitle(sink.document, 'Datensenke')
        return packageMember(
            'datasink',
            requireIdentity(sink.document.id, `Datensenke „${title}“`),
            title,
            clampDescription(sink.document.description),
            sink.document,
        )
    })

    const handles = {
        datasource: handleIndex(sources),
        mapping: handleIndex(mappings),
        datasink: handleIndex(sinks),
    }
    const pipelines = bundle.pipelines.map((pipeline) => {
        // An exported pipeline may carry the identity it had; an authored one carries none.
        const authored = pipeline.model.id
        return packageMember(
            'pipeline',
            isCoreUrn(authored)
                ? authored
                : derivedIdentity(entry, namespace, 'pipeline', pipeline.name),
            pipeline.name,
            clampDescription(pipeline.description),
            withResolvedReferences(pipeline, handles),
        )
    })

    const members = [...structures, ...sources, dataset, ...mappings, ...sinks, ...pipelines]
    requireDistinctIdentities(members)
    return { ...(datapoolId ? { datapoolId } : {}), package: { ...header, members } }
}

/** What `POST /v1/installations` answers: the installation and one line per artifact it made. */
export interface InstallationReceipt {
    id?: string
    packageId?: string
    packageVersion?: string
    dataSetId?: string
    dataSetName?: string
    artifacts?: { artifactType?: string; name?: string; urn?: string; action?: string }[]
}

const SUMMARY_KINDS: [artifactType: string, label: string][] = [
    ['DATA_STRUCTURE', 'Struktur(en)'],
    ['DATA_SOURCE', 'Quelle(n)'],
    ['MAPPING', 'Mapping(s)'],
    ['DATA_SINK', 'Senke(n)'],
    ['PIPELINE', 'Pipeline(s)'],
]

/**
 * The install feedback, counted from the artifact lines the platform recorded. Every kind is
 * named, including the ones that came out as zero: a summary that reports three kinds reads as
 * full success while staying silent about the two that decide whether a release deploys anything.
 */
export function summarizeInstallation(receipt: InstallationReceipt, fallbackName: string): string {
    const lines = receipt.artifacts ?? []
    const count = (artifactType: string) =>
        lines.filter((line) => line.artifactType === artifactType).length

    if (count('DATA_SET') === 0) {
        const structure = lines.find((line) => line.artifactType === 'DATA_STRUCTURE')
        const urn = structure?.urn ? ` · ${structure.urn}` : ''
        return `Datenstruktur „${structure?.name ?? fallbackName}“ angelegt${urn}`
    }
    const counts = SUMMARY_KINDS.map(([type, label]) => `${count(type)} ${label}`).join(' · ')
    return `Dataset „${receipt.dataSetName ?? fallbackName}“ als Entwurf angelegt · ${counts}`
}

/**
 * What a failed response says. The backend answers with an RFC 9457 problem whose `detail` is the
 * actionable sentence. The gateway policy answers a denied request with its bare reason
 * (`permission_denied`, `unknown_endpoint`) as the whole body. Anything longer than a reason, an
 * HTML error page for instance, is nobody's message and is ignored.
 */
export function readFailure(body: string): { detail?: string; reason?: string } {
    let parsed: unknown
    try {
        parsed = JSON.parse(body)
    } catch {
        parsed = body.trim()
    }
    if (typeof parsed === 'string') {
        return parsed && parsed.length <= 80 ? { reason: parsed } : {}
    }
    if (!isRecord(parsed)) return {}
    return {
        ...(typeof parsed.detail === 'string' && parsed.detail ? { detail: parsed.detail } : {}),
        ...(typeof parsed.reason === 'string' && parsed.reason ? { reason: parsed.reason } : {}),
    }
}

export interface FailureDescription {
    status: 'conflict' | 'invalid' | 'error'
    detail: string
}

/**
 * A route the platform does not serve. Behind the gateway that is a 403 with the reason
 * `unknown_endpoint`, without it a 405 or a 404 that carries no problem of its own. A 404 WITH a
 * detail is the backend naming something it looked for, which is a different answer.
 */
function isUnservedRoute(
    httpStatus: number,
    failure: { detail?: string; reason?: string },
): boolean {
    return (
        httpStatus === 405 ||
        (httpStatus === 403 && failure.reason === 'unknown_endpoint') ||
        (httpStatus === 404 && !failure.detail)
    )
}

function describeFailure(
    httpStatus: number,
    statusText: string,
    body: string,
    sentences: { unserved: string; denied: string },
): FailureDescription {
    const failure = readFailure(body)
    const said = failure.detail ?? failure.reason ?? `${httpStatus} ${statusText}`.trim()
    if (httpStatus === 409) return { status: 'conflict', detail: said }
    if (httpStatus === 400) return { status: 'invalid', detail: said }
    if (isUnservedRoute(httpStatus, failure)) return { status: 'error', detail: sentences.unserved }
    if (httpStatus === 403 && failure.reason === 'permission_denied') {
        return { status: 'error', detail: sentences.denied }
    }
    return { status: 'error', detail: said }
}

export function describeInstallFailure(
    httpStatus: number,
    statusText: string,
    body: string,
): FailureDescription {
    return describeFailure(httpStatus, statusText, body, {
        unserved:
            'Diese Plattform-Version bietet die Installation von Paketen nicht an (POST /v1/installations).',
        denied: 'Zugriff verweigert: Ihrer Rolle fehlt die Berechtigung INSTALLATION_CREATE.',
    })
}

/**
 * The summary segment for a release after install that did not go through. Which step refused
 * decides what is left: a refused stage leaves the draft, a refused release a dataset that is
 * already staged (READY). The portal continues from either.
 */
export function describeReleaseFailure(
    step: 'stage' | 'release',
    httpStatus: number,
    statusText: string,
    body: string,
): string {
    const failure = readFailure(body)
    const said =
        httpStatus === 403 && failure.reason === 'permission_denied'
            ? 'Ihrer Rolle fehlt das Recht, Datensätze freizugeben'
            : (failure.detail ?? failure.reason ?? `${httpStatus} ${statusText}`.trim())
    const left = step === 'stage' ? 'Der Datensatz bleibt ein Entwurf' : 'Der Datensatz ist bereit zur Freigabe'
    return ` · Freigabe NICHT gestartet (${httpStatus}): ${said.replace(/\.+$/, '')}. ${left}, freigeben lässt er sich im Portal`
}

export function describeUninstallFailure(
    httpStatus: number,
    statusText: string,
    body: string,
): FailureDescription {
    return describeFailure(httpStatus, statusText, body, {
        unserved:
            'Diese Plattform-Version kann Installationen noch nicht deinstallieren. Die angelegten Artefakte lassen sich im Portal einzeln entfernen.',
        denied: 'Zugriff verweigert: Ihrer Rolle fehlt das Recht, Installationen zu entfernen.',
    })
}
