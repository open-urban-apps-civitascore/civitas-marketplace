/**
 * Catalogue domain types — shared by the git-hosted catalogue (repo-list +
 * artifact repos on GitLab) and the local mock fixtures. The wire format of
 * both sources is identical by construction: the fixtures ARE copies of the
 * artifact-repo content, assembled through the same code path
 * (see assemble.ts), so swapping sources never changes install behaviour.
 *
 * URN convention for catalogue artifacts (pending upstream alignment, our
 * proposal): scope `standard` — the documented value for externally authored,
 * unmodified-imported models, which is exactly what a catalogue entry is.
 * The disambiguator is DERIVED, not hand-written: SHA-256 over the stable key
 * `openurbanapps#<artifact-name>`, first 10 bytes folded into base36 — the
 * same `deriveDisambiguator` mechanism Model Forge uses for XÖV imports, so
 * every instance computes the identical identity and equal names from other
 * publishers can never collide. The key must NEVER change once published:
 * a changed key is a new identity, and installed instances would stop
 * recognising the artifact.
 */

import type { Contact, Curation, Implementation, MediaItem } from '@/lib/catalog/schema'
import type { Theme } from '@/lib/catalog/vocabulary'

/**
 * Catalogue metadata for one installable entry — the "packaging".
 *
 * `id`: for datastructure entries this IS the artifact's logical CORE URN.
 * Use cases have no platform identity yet (the install-registry gap), so they
 * carry a marketplace-owned urn in a distinct scheme — never a fake CORE URN.
 */
export interface CatalogManifest {
    id: string
    type: 'datastructure' | 'usecase'
    displayName: string
    description: string
    version: string
    maintainer: string
    license: string
    keywords: string[]
}

/**
 * One instance-local install parameter of a connector document: a top-level
 * field whose value belongs to the receiving instance (broker URL, table
 * name), not to the portable content. The document carries the catalogue
 * default; a future install dialog offers these fields for override before
 * the value lands in the wire configuration. Declaring the split here keeps
 * the catalogue honest about what travels and what is per-instance.
 */
export interface InstallParameter {
    /** Top-level field of the connector document this parameter sets. */
    field: string
    label: string
    description?: string
}

/**
 * One member file of a package. Parameters are packaging metadata (which
 * connector fields are instance-local), so they live here — never inside the
 * CORE-IR document, whose shape belongs to the platform's schemas.
 */
export interface PackageMember {
    /** File name inside the package's `core-ir/` directory. */
    file: string
    parameters?: InstallParameter[]
}

export interface DashboardBindings {
    /** Target database connection name in Superset, e.g. payload_data */
    database?: string
    /** Target schema name pattern, e.g. ds_${datasetId} */
    schema?: string
    /** Target table name inside the schema */
    table?: string
}

export interface PackageDashboardMember {
    /** File name inside the package's `core-ir/` directory (e.g. *.dashboard.json or *.zip). */
    file: string
    tool?: 'superset' | 'grafana'
    targetVersion?: string
    bindings?: DashboardBindings
}

export interface PackageMembers {
    dataStructures: PackageMember[]
    dataSources?: PackageMember[]
    mappings?: PackageMember[]
    dataSinks?: PackageMember[]
    pipelines?: PackageMember[]
    simulations?: PackageMember[]
    dashboards?: PackageDashboardMember[]
}


/**
 * The package document (`core-ir/manifest.json` in an artifact repo): the
 * catalogue manifest plus the member list that makes the package fetchable
 * over raw URLs (no directory listing exists there) — and, honestly declared
 * ahead of time, the dependency slot for future add-on requirements.
 *
 * This is deliberately the complete "what is this package" statement in ONE
 * document. The platform records the id and version of an installed package
 * on the installation, and for every artifact the identity it carried in the
 * package.
 */
export interface PackageManifest extends CatalogManifest {
    members: PackageMembers
    /** Reserved: future add-on/package requirements. Always present, [] for now. */
    dependencies: unknown[]
    /**
     * The author-owned catalogue metadata, copied into the package so it is
     * self-describing away from the index. The export writes these (see
     * lib/export/transform); they were being spread in without being declared
     * here, so no consumer could see them.
     */
    themes?: Theme[]
    contact?: Contact
    media?: MediaItem[]
    implementation?: Implementation
}

/** A bundled data structure: name + the opaque artifact (its `$id` is the identity). */
export interface BundledDataStructure {
    name: string
    description?: string
    model: Record<string, unknown>
}

/**
 * A bundled data source, authored as a CORE-IR datasource document
 * (datasource.schema.json): `$schema`, `id`, `title`, `connectionType`,
 * `element` plus the connector fields. `title` doubles as the bundle-local
 * handle a pipeline's `sourceRef` resolves against; `element` names the
 * payload structure by CORE URN. The declared `id` is the identity of the
 * source INSIDE the package (scope `standard`, derived disambiguator). The
 * receiving instance installs a copy under an identity of its own and keeps
 * this one as the origin of the copy; the document travels as authored.
 */
export interface BundledDataSource {
    document: Record<string, unknown>
    /** Fields of `document` that are instance-local install parameters. */
    parameters?: InstallParameter[]
}

/**
 * A bundled mapping. Unlike a structure, whose identity travels inside the
 * artifact as `$id`, a mapping carries its URN in the envelope: Model Forge
 * stamps `id` on every write, so an authored one would be overwritten.
 * `mappingUrn` is what a pipeline of the same package references, and what
 * the platform records as the origin of the copy it installs.
 */
export interface BundledMapping {
    mappingUrn: string
    name: string
    description?: string
    document: Record<string, unknown>
}

/**
 * A bundled data sink, authored as a CORE-IR datasink document
 * (datasink.schema.json): `$schema`, `id`, `title`, `connectionType`
 * (`postgis` | `frost`) plus the variant's fields. `title` is the
 * bundle-local handle pipelines reference via `sinkRef`; `element` names the
 * target structure by its logical CORE URN and the platform rewrites it to
 * the copy it installed. As with sources, the declared `id` is the identity
 * inside the package and becomes the origin of the installed copy.
 */
export interface BundledDataSink {
    document: Record<string, unknown>
    /** Fields of `document` that are instance-local install parameters. */
    parameters?: InstallParameter[]
}

/**
 * A bundled pipeline. The graph references its bundle siblings
 * (sourceRef/sinkRef/mappingRef) by TITLE or by their package URN. The
 * platform resolves references by URN only, so the install translates a title
 * into the package URN of the sibling it names before it sends the package.
 * Values starting with `urn:` pass through verbatim.
 */
export interface BundledPipeline {
    name: string
    description?: string
    model: Record<string, unknown>
}

/**
 * One field generator of a demo-data simulation. The vocabulary is the
 * simulator's own (src/types.ts there) — the catalogue transports it verbatim
 * rather than inventing a parallel one, so a bundled scenario can be sent to
 * `PUT /simulations/:id` and `POST /sample` without translation.
 */
export type GeneratorSpec =
    | { kind: 'constant'; value: unknown }
    | { kind: 'now' }
    | { kind: 'enum'; values: unknown[] }
    | { kind: 'randomWalk'; min: number; max: number; step: number; start?: number; integer?: boolean }
    | {
          kind: 'dailyProfile'
          min: number
          max: number
          peakHours: number[]
          noise?: number
          integer?: boolean
      }

/**
 * One publisher the simulator would run for this use case — one MQTT stream on
 * one topic, typically one measuring station. Field keys are dotted paths
 * (`pm25.value`), exactly as the simulator expands them into nested objects.
 */
export interface SimulationStream {
    /** Stream slug, unique within the simulation; part of the simulator id. */
    name: string
    fields: Record<string, GeneratorSpec>
}

/**
 * A bundled demo-data scenario: which datasource it feeds, which class of the
 * SOURCE structure its messages instantiate, and the streams themselves.
 *
 * `messageClass` is a JSON pointer into the source structure — `#` for a
 * structure whose root is the message shape, `#/$defs/Messung` for a structure
 * that keeps its classes in $defs. The assembly validates every field path
 * against that class (required coverage + subset), so scenario and structure
 * cannot drift apart silently.
 *
 * `topicBase` names where the scenario publishes, and the assembly enforces
 * that it agrees with the datasource's subscription: an exact subscription
 * (`topicBase` verbatim) puts every stream on that one topic, a wildcard
 * subscription (`topicBase/+`) gives each stream its own subtopic. The actual
 * publish topic is derived from the SUBSCRIPTION at install time — the
 * datasource is the authority on where the platform listens. Broker URLs are
 * deliberately NOT part of this document — they are instance-local values
 * (the datasource carries the default, the install may override it).
 */
export interface BundledMqttSimulation {
    /** Absent means mqtt: every scenario published before SQL existed. */
    transport?: 'mqtt'
    /** Bundle-local handle of the datasource this scenario feeds (its title). */
    sourceRef: string
    /** JSON pointer to the message class inside the source structure. */
    messageClass: string
    topicBase: string
    intervalSeconds?: number
    streams: SimulationStream[]
}

/**
 * A scenario that fills a SQL table instead of publishing to a broker.
 *
 * The asymmetry with MQTT is the point, and it comes from D14: a broker needs
 * no preparation and keeps no history, while a table has to exist before
 * anything can read it, and nothing in CIVITAS ever creates it. So this
 * scenario describes the TABLE as well as the rows, and the generator owns
 * that table's lifetime — creating it, seeding it, and keeping it inside
 * `maxRows`.
 *
 * There are no streams: a table is one shape, not many. And there is no
 * address — the DSN the generator writes to is its own configuration, never
 * package content (a password has no business travelling in a catalogue
 * entry). Which table inside that database is named here; the datasource says
 * where the platform READS, and the generator compares the two database names
 * so a scenario cannot fill a table nobody looks at.
 */
export interface BundledSqlSimulation {
    transport: 'sql'
    sourceRef: string
    messageClass: string
    /** Column types and the UPSERT key; the key must be among the columns. */
    table: { columns: Record<string, string>; primaryKey?: string }
    fields: Record<string, GeneratorSpec>
    /** Written once at start-up, so the first read is never of an empty table. */
    seedRows?: number
    insertsPerTick?: number
    /** Mandatory: every pipeline run re-reads the whole table (D14). */
    maxRows: number
    intervalSeconds?: number
}

export type BundledSimulation = BundledMqttSimulation | BundledSqlSimulation

/** Narrowing helper — the absent `transport` of older scenarios means mqtt. */
export function isSqlSimulation(
    simulation: BundledSimulation,
): simulation is BundledSqlSimulation {
    return simulation.transport === 'sql'
}

export interface DataStructureEntry {
    manifest: CatalogManifest & { type: 'datastructure' }
    artifact: Record<string, unknown>
}

export interface BundledDashboard {
    file: string
    tool: 'superset' | 'grafana'
    targetVersion?: string
    bindings?: DashboardBindings
    /** Content either as parsed JSON object or raw/base64 string */
    content: Record<string, unknown>
}

export interface UseCaseEntry {
    manifest: CatalogManifest & { type: 'usecase' }
    bundle: {
        dataStructures: BundledDataStructure[]
        dataSources: BundledDataSource[]
        mappings: BundledMapping[]
        dataSinks: BundledDataSink[]
        pipelines: BundledPipeline[]
        simulations: BundledSimulation[]
        dashboards?: BundledDashboard[]
    }
}


export type CatalogEntry = DataStructureEntry | UseCaseEntry

/** Type guard: TypeScript cannot narrow on the nested manifest.type discriminant. */
export function isDataStructureEntry(entry: CatalogEntry): entry is DataStructureEntry {
    return entry.manifest.type === 'datastructure'
}

/**
 * Where a catalogue row's content lives: git repo + immutable pin. The pin is
 * `ref` — a full 40-hex commit SHA, the ONLY thing an install ever fetches.
 * `releaseTag` carries the upstream release name the SHA was curated from; it
 * exists for display and drift detection and is never used to fetch anything
 * (null when upstream has no release yet).
 */
export interface DeploymentRef {
    url: string
    ref: string
    releaseTag: string | null
    /** Folder inside the repo holding the content; '.' for the root. */
    path: string
}

/**
 * How a use case was realised in practice, by whom, at what cost — the part of
 * a catalogue entry that describes an implementation rather than shipping one.
 *
 * Deliberately ORTHOGONAL to installability. A packaged entry may carry it too
 * ("this is who runs it in production"), so there are not two kinds of row in
 * the schema, only one optional block. What decides installability stays
 * `deploymentRef` and nothing else.
 *
 * DEFINED IN `lib/catalog/schema`, not here: this block is the part of an
 * entry a municipality fills in itself, so its shape is a form contract before
 * it is a display type, and one definition has to serve the form, the export
 * writer, this parser and the catalogue's CI. Re-exported so the 17 modules
 * that already import from this file keep one place to look.
 */
export type {
    Contact,
    Curation,
    Implementation,
    MediaItem,
    Reference,
    Resources,
} from '@/lib/catalog/schema'

/**
 * One row of the repo-list index: the catalogue manifest (everything the list
 * page renders — no per-entry fetch needed for browsing) plus the source
 * pointer the install resolves the package from. The duplication with the
 * package's own manifest is deliberate and VERIFIED: the install cross-checks
 * id and version between row and fetched manifest and refuses on mismatch.
 */
export interface CatalogSummary extends CatalogManifest {
    /**
     * Absent for local mock fixtures (which need no fetch), for tombstoned rows
     * whose historical pin data is deliberately not parsed, and for DESCRIBED
     * entries — those document an implementation running elsewhere and have
     * nothing to fetch. Presence of this field is the single test for
     * installability; nothing else decides it.
     */
    deploymentRef?: DeploymentRef
    /**
     * How this was realised in practice. On a described entry it carries the
     * whole substance and its `reference` is what marks the row as deliberately
     * pin-less; on a packaged entry it is extra context about a real
     * deployment. See {@link Implementation}.
     */
    implementation?: Implementation
    /**
     * Subject areas, from a closed vocabulary — the catalogue's primary facet.
     * Separate from `keywords`, which is free text and carries technical tags
     * (`frost`, `sql`): one list doing both jobs is how the live data ended up
     * offering `Umwelt` and `umwelt` as two different filter options.
     */
    themes?: Theme[]
    /** Who to contact about this entry — modelled on `dcat:contactPoint`. */
    contact?: Contact
    /**
     * How closely we checked it (D11) — the same block add-on rows carry, so
     * the whole catalogue speaks one trust vocabulary. Absent means unreviewed.
     */
    curation?: Curation
    /** Screenshots of the running thing, supplied by the operating municipality. */
    media?: MediaItem[]
    /** Tombstone: entry withdrawn — hidden from the catalogue, never deleted. */
    revoked?: boolean
    revokedReason?: string
}

/**
 * A deployable infrastructure add-on (NodeRed, Airflow, …) — a separate
 * top-level catalogue section, NOT a bundle member. Add-ons are installed
 * operator-side (GitOps) via their `deploymentRef`; the marketplace only
 * lists them. Shape unchanged from catalogue schema v1.
 */
export interface AddonEntry {
    id: string
    name: string
    description: string
    author: string
    categories: string[]
    repository?: string
    iconUrl?: string
    licenses?: { addon?: string; tool?: string }
    compatibility: { coreVersion: string; branch?: string; lastUpdated?: string }[]
    requiredCapabilities?: string[]
    /**
     * `ref` pins the package to an immutable version: a full 40-hex commit
     * SHA — the only thing an install ever fetches. `releaseTag` carries the
     * upstream release name for display and drift detection (never fetched);
     * null when upstream has no release. Absent `ref`: listable, not
     * installable.
     */
    deploymentRef: {
        type: string
        url: string
        chartName?: string
        path?: string
        ref?: string
        releaseTag?: string | null
    }
    /** Longer text; `description` stays the one-sentence summary a card shows. */
    details?: string
    documentation?: string
    wrappedTool?: { name: string; homepage?: string }
    /**
     * Present together with `deploymentRef.ref` and `curation` on an entry the
     * marketplace may propose for installation — see lib/addon-catalog.
     */
    install?: { componentName: string; subdomain: string }
    /** One trust vocabulary for the whole catalogue (D11) — see {@link Curation}. */
    curation?: Curation
    deprecated?: { reason: string; successorId?: string }
    revoked?: boolean
    revokedReason?: string
}

/**
 * The repo-list index (`index.json` in the catalogue repo) — the entire
 * catalogue in one git-hosted file, F-Droid model. `version` is the content
 * version of the whole index (SemVer, bumped on every merge); `updatedAt` is
 * its ISO-8601 timestamp.
 */
export interface RepoListIndex {
    version: string
    updatedAt: string
    addons: AddonEntry[]
    useCases: CatalogSummary[]
    dataStructures: CatalogSummary[]
}

/** Freshness metadata for the "catalogue as of …" hint in the UI. */
export interface CatalogMeta {
    /** Content version of the served index ("fixtures" in mock mode). */
    version: string
    fetchedAt: Date
    origin: 'remote' | 'mock' | 'unconfigured' | 'unreachable'
    /** true = not live: last-known-good, unconfigured, or unreachable. */
    stale: boolean
}
