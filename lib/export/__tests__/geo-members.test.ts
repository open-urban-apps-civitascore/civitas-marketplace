import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { assembleCatalogEntry, parsePackageManifest } from '@/lib/catalog/assemble'
import { checkPackage } from '@/lib/export/package-check'
import type { InstanceSnapshot } from '@/lib/export/portal-reader'
import { transformSnapshot, type ExportedPackage, type ExportOptions } from '@/lib/export/transform'
import { buildInstallationRequest } from '@/lib/install-payload'

/**
 * Sharing a use case with a map: its named API, styles and layers travel in
 * the package, and the layer's references come out the way the install binds
 * them again (sink by title, styles by name). The proof is the way back: the
 * exported package passes the package check, the shipped validator, and the
 * install's own reference resolution.
 */

const KIEZBAUM = 'urn:core:standard:openurbanapps:datastructure:environment:kiezbaum:f1i2sjhgvq'

const snapshot: InstanceSnapshot = {
    dataset: { id: 'ds', name: 'Kiez-Bäume', description: 'Bäume mit Karte' },
    structures: [
        {
            versionId: 'v1',
            dataStructureId: 's1',
            name: 'Baumzeile',
            modelUrn: 'urn:core:instance:stadt:datastructure:default:baumzeile:aaaaaaaaaa:1.0.0',
            model: { type: 'object', properties: { baum_id: { type: 'string' }, lon: { type: 'number' }, lat: { type: 'number' } } },
        },
        {
            versionId: 'v2',
            dataStructureId: 's2',
            name: 'Kiez-Baum',
            modelUrn: `${KIEZBAUM}:1.0.0`,
            model: { $id: `${KIEZBAUM}:1.0.0`, title: 'Kiez-Baum', type: 'object' },
        },
    ],
    sources: [
        {
            id: 'src',
            name: 'Baum-Feed',
            connectorType: 'MQTT',
            configuration: { urls: ['tcp://civitas-mosquitto:1883'], topics: ['stadt/baeume'] },
            configurationUrn: 'urn:core:instance:stadt:datasource:default:baumfeed:bbbbbbbbbb:1.0.0',
            structureVersionId: 'v1',
        },
    ],
    mappings: [
        {
            urn: 'urn:core:instance:stadt:mapping:default:zeilezubaum:cccccccccc',
            document: {
                title: 'Zeile zu Baum',
                source: 'urn:core:instance:stadt:datastructure:default:baumzeile:aaaaaaaaaa:1.0.0',
                target: `${KIEZBAUM}:1.0.0`,
                fields: { '$.baumId': '$.baum_id', '$.position': { op: 'geoPoint', lon: '$.lon', lat: '$.lat' } },
            },
        },
    ],
    sinks: [
        {
            id: 'sink',
            name: 'Baum-Tabelle',
            dataSinkType: 'POSTGIS',
            configuration: { tableName: 'baeume', element: `${KIEZBAUM}:1.0.0` },
            configurationUrn: 'urn:core:instance:stadt:datasink:default:baumtabelle:dddddddddd:1.0.0',
            structureVersionId: 'v2',
        },
    ],
    pipelines: [
        {
            id: 'p',
            name: 'Baum-Import',
            model: {
                nodes: [
                    { id: 'a', kind: 'source', sourceRef: 'urn:core:instance:stadt:datasource:default:baumfeed:bbbbbbbbbb:1.0.0' },
                    { id: 'b', kind: 'mapping', mappingRef: 'urn:core:instance:stadt:mapping:default:zeilezubaum:cccccccccc:1.0.0' },
                    { id: 'c', kind: 'sink', sinkRef: 'urn:core:instance:stadt:datasink:default:baumtabelle:dddddddddd:1.0.0' },
                ],
                edges: [],
            },
            dataSourceIds: ['src'],
            dataSinkIds: ['sink'],
        },
    ],
    apis: [{ name: 'Kiez-Bäume Karte', slug: 'karte', standard: 'OWS', description: 'Die Bäume als Kartendienst.' }],
    styles: [
        { id: 'style-gruen', name: 'baeume-gruen', sldContent: '<StyledLayerDescriptor version="1.0.0"/>' },
        { id: 'style-orange', name: 'baeume-orange', sldContent: '<StyledLayerDescriptor version="1.0.0"/>' },
    ],
    layers: [
        {
            id: 'layer',
            layerName: 'baeume',
            title: 'Kiez-Bäume',
            keywords: ['baum'],
            attribute: ['baumId', 'position'],
            geometryColumnRef: 'position',
            dataSinkId: 'sink',
            defaultStyleId: 'style-gruen',
            alternativeStyleIds: ['style-orange'],
            crs: 'EPSG:4326',
            nativeBoundingBox: { minX: 7.13, minY: 51.25, maxX: 7.16, maxY: 51.27 },
            latLonBoundingBox: { minX: 7.13, minY: 51.25, maxX: 7.16, maxY: 51.27 },
        },
    ],
    warnings: [],
}

const options: ExportOptions = {
    publisher: 'stadt',
    slug: 'kiez-baeume',
    version: '1.0.0',
    displayName: 'Kiez-Bäume',
    description: 'Bäume mit Karte',
    maintainer: 'Stadt',
    license: 'EUPL-1.2',
    keywords: ['baum'],
    domain: 'environment',
    provenance: { datasetId: 'ds', datasetName: 'Kiez-Bäume', exportedAt: '2026-10-12' },
}

const fileJson = (pkg: ExportedPackage, path: string) => JSON.parse(pkg.files[path]) as Record<string, unknown>

describe('exporting a use case with a map', () => {
    const pkg = transformSnapshot(snapshot, options)

    it('carries the named API, the styles and the layer as members', () => {
        expect(pkg.manifest.members.apis).toEqual([{ file: 'karte.api.json' }])
        expect(pkg.manifest.members.styles).toHaveLength(2)
        expect(pkg.manifest.members.layers).toEqual([{ file: 'baeume.layer.json' }])
        expect(fileJson(pkg, 'core-ir/karte.api.json')).toEqual({
            name: 'Kiez-Bäume Karte',
            slug: 'karte',
            standard: 'OWS',
            description: 'Die Bäume als Kartendienst.',
        })
    })

    it("names the layer's sink by title and its styles by name, and drops the instance ids", () => {
        const layer = fileJson(pkg, 'core-ir/baeume.layer.json')
        expect(layer.sinkRef).toBe('Baum-Tabelle')
        expect(layer.defaultStyleRef).toBe('baeume-gruen')
        expect(layer.alternativeStyleRefs).toEqual(['baeume-orange'])
        expect(layer).not.toHaveProperty('dataSinkId')
        expect(layer).not.toHaveProperty('defaultStyleId')
        expect(layer).not.toHaveProperty('id')
    })

    it('passes the package check', () => {
        expect(checkPackage(pkg.files)).toEqual([])
    })

    it("becomes an install request whose layer references resolve", () => {
        const manifest = parsePackageManifest(fileJson(pkg, 'core-ir/manifest.json'), 'export')
        const entry = assembleCatalogEntry(manifest, (file) => fileJson(pkg, `core-ir/${file}`))
        const request = JSON.stringify(buildInstallationRequest(entry))
        expect(request).toContain('"defaultStyleRef":"urn:')
        expect(request).toContain('"alternativeStyleRefs":["urn:')
    })

    it('leaves out a layer whose sink is not part of the package, and says so', () => {
        const orphan = transformSnapshot(
            { ...snapshot, layers: [{ ...snapshot.layers![0], dataSinkId: 'elsewhere' }] },
            options,
        )
        expect(orphan.manifest.members.layers).toBeUndefined()
        expect(orphan.warnings.some((warning) => warning.includes('Kartenebene baeume'))).toBe(true)
    })

    it('adds no geo members to a package without a map', () => {
        const plain = transformSnapshot({ ...snapshot, apis: [], styles: [], layers: [] }, options)
        expect(plain.manifest.members).not.toHaveProperty('apis')
        expect(plain.manifest.members).not.toHaveProperty('layers')
    })
})

const hasPython = spawnSync('python3', ['--version']).status === 0

describe.skipIf(!hasPython)('exported package with a map against the shipped validate-bundle.py', () => {
    it("passes the package repositories' validator", () => {
        const pkg = transformSnapshot(snapshot, options)
        const dir = mkdtempSync(join(tmpdir(), 'export-geo-'))
        try {
            for (const [path, content] of Object.entries(pkg.files)) {
                mkdirSync(dirname(join(dir, path)), { recursive: true })
                writeFileSync(join(dir, path), content)
            }
            const run = spawnSync('python3', ['ci/validate-bundle.py'], { cwd: dir, encoding: 'utf8' })
            expect(run.status, `${run.stdout}${run.stderr}`).toBe(0)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
