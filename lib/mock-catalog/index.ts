import airQualityManifest from './air-quality-station/manifest.json'
import airQualityArtifact from './air-quality-station/artifact.schema.json'
import trafficManifest from './traffic-counting/manifest.json'
import trafficStructure from './traffic-counting/structure.artifact.schema.json'
import trafficTargetStructure from './traffic-counting/structure.target.artifact.schema.json'
import trafficSourceFeed from './traffic-counting/zaehlstellen-feed.datasource.json'
import trafficSinkTable from './traffic-counting/verkehrsmessung-tabelle.datasink.json'
import trafficMapping from './traffic-counting/mapping.json'
import trafficPipeline from './traffic-counting/pipeline.json'
import airStaManifest from './luftqualitaet-sta/manifest.json'
import airStaStructure from './luftqualitaet-sta/structure.artifact.schema.json'
import airStaTargetStructure from './luftqualitaet-sta/structure.target.artifact.schema.json'
import airStaSourceFeed from './luftqualitaet-sta/luftmessungs-feed.datasource.json'
import airStaSinkFrost from './luftqualitaet-sta/frost-observations.datasink.json'
import airStaMapping from './luftqualitaet-sta/mapping.json'
import airStaPipeline from './luftqualitaet-sta/pipeline.json'

/**
 * Catalogue metadata for one installable entry — the "packaging". Mirrors the
 * manifest format decided for the GitLab catalogue, so swapping this mock for
 * fetched entries later changes only the data source, not the shape.
 *
 * `id`: for datastructure entries this IS the artifact's logical CORE URN.
 * Use cases have no platform identity yet (the install-registry gap), so they
 * carry a marketplace-owned urn in a distinct scheme — never a fake CORE URN.
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

/** A bundled data structure: name + the opaque artifact (its `$id` is the identity). */
export interface BundledDataStructure {
    name: string
    description?: string
    model: Record<string, unknown>
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
    }
}

export type CatalogEntry = DataStructureEntry | UseCaseEntry

export const mockCatalog: CatalogEntry[] = [
    {
        manifest: airQualityManifest as DataStructureEntry['manifest'],
        artifact: airQualityArtifact,
    },
    {
        manifest: trafficManifest as UseCaseEntry['manifest'],
        bundle: {
            dataStructures: [
                {
                    name: 'Verkehrszählung',
                    description: 'Zählstellen und Zählungen im Geräteformat des Simulators',
                    model: trafficStructure,
                },
                {
                    name: 'Verkehrsmessung',
                    description: 'Normalisiertes Zielformat, gegen das Auswertungen laufen',
                    model: trafficTargetStructure,
                },
            ],
            dataSources: [
                {
                    document: trafficSourceFeed,
                    parameters: [
                        {
                            field: 'urls',
                            label: 'MQTT-Broker-URLs',
                            description:
                                'Broker-Adresse(n) der Ziel-Instanz; Standard ist der Plattform-Broker.',
                        },
                    ],
                },
            ],
            mappings: [trafficMapping as BundledMapping],
            dataSinks: [
                {
                    document: trafficSinkTable,
                    parameters: [
                        {
                            field: 'tableName',
                            label: 'PostGIS-Tabellenname',
                            description:
                                'Name der Zieltabelle in der PostGIS-Datenbank der Instanz.',
                        },
                    ],
                },
            ],
            pipelines: [trafficPipeline as BundledPipeline],
        },
    },
    {
        manifest: airStaManifest as UseCaseEntry['manifest'],
        bundle: {
            dataStructures: [
                {
                    name: 'Luftmessung',
                    description:
                        'Rohformat der Luftqualitäts-Stationen (PM2,5 als Pflichtwert, PM10/Gase optional)',
                    model: airStaStructure,
                },
                {
                    name: 'STA-Observation',
                    description:
                        'SensorThings-Zielformat, das der FROST-Server als Observation akzeptiert',
                    model: airStaTargetStructure,
                },
            ],
            dataSources: [
                {
                    document: airStaSourceFeed,
                    parameters: [
                        {
                            field: 'urls',
                            label: 'MQTT-Broker-URLs',
                            description:
                                'Broker-Adresse(n) der Ziel-Instanz; Standard ist der Plattform-Broker.',
                        },
                    ],
                },
            ],
            mappings: [airStaMapping as BundledMapping],
            // FROST needs no instance-local parameters: the sink references only the
            // mapping's target structure; server and project come from the platform.
            dataSinks: [{ document: airStaSinkFrost }],
            pipelines: [airStaPipeline as BundledPipeline],
        },
    },
]

export function findCatalogEntry(id: string): CatalogEntry | undefined {
    return mockCatalog.find((entry) => entry.manifest.id === id)
}

/** Type guard: TypeScript cannot narrow on the nested manifest.type discriminant. */
export function isDataStructureEntry(entry: CatalogEntry): entry is DataStructureEntry {
    return entry.manifest.type === 'datastructure'
}
