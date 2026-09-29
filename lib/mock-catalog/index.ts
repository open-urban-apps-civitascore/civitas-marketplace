import type { PackageManifest } from '@/lib/catalog/types'

import airQualityManifest from './air-quality-station/manifest.json'
import airQualityArtifact from './air-quality-station/air-quality-station.datastructure.json'
import trafficManifest from './traffic-counting/manifest.json'
import trafficStructure from './traffic-counting/verkehrszaehlung.datastructure.json'
import trafficTargetStructure from './traffic-counting/verkehrsmessung.datastructure.json'
import trafficSourceFeed from './traffic-counting/zaehlstellen-feed.datasource.json'
import trafficSinkTable from './traffic-counting/verkehrsmessung-tabelle.datasink.json'
import trafficMapping from './traffic-counting/zaehlung-zu-messung.mapping.json'
import trafficPipeline from './traffic-counting/zaehlung-zu-messung.pipeline.json'
import trafficSimulation from './traffic-counting/zaehlstellen.simulation.json'
import airStaManifest from './luftqualitaet-sta/manifest.json'
import airStaStructure from './luftqualitaet-sta/luftmessung.datastructure.json'
import airStaTargetStructure from './luftqualitaet-sta/luftstation.datastructure.json'
import airStaSourceFeed from './luftqualitaet-sta/luftmessungs-feed.datasource.json'
import airStaSinkFrost from './luftqualitaet-sta/frost-observations.datasink.json'
import airStaMapping from './luftqualitaet-sta/luftmessung-zu-station.mapping.json'
import airStaPipeline from './luftqualitaet-sta/luftqualitaets-import.pipeline.json'
import airStaSimulation from './luftqualitaet-sta/luftmessung.simulation.json'
import treesManifest from './kiez-baumkataster/manifest.json'
import treesSourceStructure from './kiez-baumkataster/baumkataster-zeile.datastructure.json'
import treesTargetStructure from './kiez-baumkataster/kiez-baum.datastructure.json'
import treesSourceDb from './kiez-baumkataster/baumkataster-db.datasource.json'
import treesMapping from './kiez-baumkataster/kataster-import.mapping.json'
import treesSinkTable from './kiez-baumkataster/kiez-baeume-tabelle.datasink.json'
import treesPipeline from './kiez-baumkataster/kataster-import.pipeline.json'

/**
 * Local catalogue fixtures: verbatim copies of the artifact-repo content
 * (gitlab.com/civitascore-openurbanapps/commune-*) — manifest.json plus the
 * member files it lists, under the same file names. They serve two purposes:
 * offline/demo catalogue when no REPO_LIST_URL is configured, and test
 * fixtures for the assembly path. Because both sources run through
 * assembleCatalogEntry, keeping these byte-equal to the repo content means
 * mock installs and remote installs are provably the same request.
 */

export interface MockPackage {
    manifest: PackageManifest
    /** Member file contents, keyed by the file name the manifest lists. */
    files: Record<string, Record<string, unknown>>
}

export const mockPackages: MockPackage[] = [
    {
        manifest: airQualityManifest as unknown as PackageManifest,
        files: {
            'air-quality-station.datastructure.json': airQualityArtifact,
        },
    },
    {
        manifest: trafficManifest as unknown as PackageManifest,
        files: {
            'verkehrszaehlung.datastructure.json': trafficStructure,
            'verkehrsmessung.datastructure.json': trafficTargetStructure,
            'zaehlstellen-feed.datasource.json': trafficSourceFeed,
            'zaehlung-zu-messung.mapping.json': trafficMapping,
            'verkehrsmessung-tabelle.datasink.json': trafficSinkTable,
            'zaehlung-zu-messung.pipeline.json': trafficPipeline,
            'zaehlstellen.simulation.json': trafficSimulation,
        },
    },
    {
        manifest: airStaManifest as unknown as PackageManifest,
        files: {
            'luftmessung.datastructure.json': airStaStructure,
            'luftstation.datastructure.json': airStaTargetStructure,
            'luftmessungs-feed.datasource.json': airStaSourceFeed,
            'luftmessung-zu-station.mapping.json': airStaMapping,
            'frost-observations.datasink.json': airStaSinkFrost,
            'luftqualitaets-import.pipeline.json': airStaPipeline,
            'luftmessung.simulation.json': airStaSimulation,
        },
    },
    // SQL-sourced, simulation-less package: the seed SQL under
    // kiez-baumkataster/seed/ is deliberately NOT a member — the source table
    // belongs to the (demo) Fachverfahren, not to the platform install.
    {
        manifest: treesManifest as unknown as PackageManifest,
        files: {
            'baumkataster-zeile.datastructure.json': treesSourceStructure,
            'kiez-baum.datastructure.json': treesTargetStructure,
            'baumkataster-db.datasource.json': treesSourceDb,
            'kataster-import.mapping.json': treesMapping,
            'kiez-baeume-tabelle.datasink.json': treesSinkTable,
            'kataster-import.pipeline.json': treesPipeline,
        },
    },
]
