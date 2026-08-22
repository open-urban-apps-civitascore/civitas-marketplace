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

export interface PackageMembers {
    dataStructures: PackageMember[]
    dataSources?: PackageMember[]
    mappings?: PackageMember[]
    dataSinks?: PackageMember[]
    pipelines?: PackageMember[]
    simulations?: PackageMember[]
}

/**
 * The package document (`core-ir/manifest.json` in an artifact repo): the
 * catalogue manifest plus the member list that makes the package fetchable
 * over raw URLs (no directory listing exists there) — and, honestly declared
 * ahead of time, the dependency slot for future add-on requirements.
 *
 * This is deliberately the complete "what is this package" statement in ONE
 * document — the shape we propose the platform adopt for a first-class
 * package concept (today the platform persists only catalogEntryId/-Version
 * in its install provenance).
 */
export interface PackageManifest extends CatalogManifest {
    members: PackageMembers
    /** Reserved: future add-on/package requirements. Always present, [] for now. */
    dependencies: unknown[]
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
 * payload structure by CORE URN. The declared `id` is the catalogue-owned
 * logical identity (scope `standard`, derived disambiguator) — today's wire
 * API cannot adopt it for connector shells (the receiving instance mints
 * one), so the install maps the document onto the existing
 * name/connectorType/configuration fields and the id stays catalogue-side
 * until the platform grows an identity-keeping door for sources and sinks.
 *
 * The connector configuration matters beyond ingestion: only a configured
 * source gets a minted configuration URN, and only that URN lets a bundle
 * pipeline reference the source in its graph.
 */
export interface BundledDataSource {
    document: Record<string, unknown>
    /** Fields of `document` that are instance-local install parameters. */
    parameters?: InstallParameter[]
}

/**
 * A bundled mapping. Unlike a structure, whose identity travels inside the
 * artifact as `$id`, a mapping carries its URN in the envelope: Model Forge
 * stamps `id` on every write, so an authored one would be overwritten. Without
 * `mappingUrn` the platform mints a random identity and every re-install would
 * duplicate the mapping instead of resolving to the same one.
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
 * target structure by its logical CORE URN and the platform resolves and
 * rewrites it to the installed version. As with sources, the declared `id`
 * is the catalogue-owned identity the wire API cannot adopt yet — the
 * install maps the document onto name/dataSinkType/configuration.
 */
export interface BundledDataSink {
    document: Record<string, unknown>
    /** Fields of `document` that are instance-local install parameters. */
    parameters?: InstallParameter[]
}

/**
 * A bundled pipeline. The graph references its bundle siblings by NAME
 * (sourceRef/sinkRef/mappingRef): minted URNs differ per instance, so names
 * are the only identities a bundle can author. Values starting with `urn:`
 * pass through verbatim for the advanced case of referencing something
 * already installed.
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
 * `topicBase` is a template, not a final topic: the install appends a
 * per-installation nonce so two installs never share a topic. Broker URLs are
 * deliberately NOT part of this document — they are instance-local values.
 */
export interface BundledSimulation {
    /** Bundle-local handle of the datasource this scenario feeds (its title). */
    sourceRef: string
    /** JSON pointer to the message class inside the source structure. */
    messageClass: string
    topicBase: string
    intervalSeconds?: number
    streams: SimulationStream[]
}

export interface DataStructureEntry {
    manifest: CatalogManifest & { type: 'datastructure' }
    artifact: Record<string, unknown>
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
    }
}

export type CatalogEntry = DataStructureEntry | UseCaseEntry

/** Type guard: TypeScript cannot narrow on the nested manifest.type discriminant. */
export function isDataStructureEntry(entry: CatalogEntry): entry is DataStructureEntry {
    return entry.manifest.type === 'datastructure'
}

/** Where a catalogue row's package content lives: git repo + pinned ref (tag/commit). */
export interface RepoSource {
    repoUrl: string
    gitIdentifier: string
}

/**
 * One row of the repo-list index: the catalogue manifest (everything the list
 * page renders — no per-entry fetch needed for browsing) plus the source
 * pointer the install resolves the package from. The duplication with the
 * package's own manifest is deliberate and VERIFIED: the install cross-checks
 * id and version between row and fetched manifest and refuses on mismatch.
 */
export interface CatalogSummary extends CatalogManifest {
    /** Absent only for local mock fixtures, which need no fetch. */
    source?: RepoSource
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
    deploymentRef: { type: string; url: string; chartName?: string; path?: string }
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
