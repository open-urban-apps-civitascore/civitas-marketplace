import { describe, expect, it } from 'vitest'

import { checkPackage } from '@/lib/export/package-check'
import type { InstanceSnapshot } from '@/lib/export/portal-reader'
import { transformSnapshot, type ExportOptions } from '@/lib/export/transform'

/**
 * A Kiez-Baumkataster as a running instance holds it: the target structure
 * came from the catalogue (scope `standard`, must be kept), the source
 * structure and the mapping were modelled by hand (instance-minted, must be
 * re-identified), the source carries credentials, the pipeline references
 * everything by versioned URN.
 */
const ZEILE_INSTANCE = 'urn:core:instance:musterstadt:datastructure:default:baumkatasterzeile:q1w2e3r4t5:1.0.0'
const KIEZBAUM_CATALOG = 'urn:core:standard:openurbanapps:datastructure:environment:kiezbaum:f1i2sjhgvq'
const MAPPING_INSTANCE = 'urn:core:instance:musterstadt:mapping:default:katasterimport:z9x8c7v6b5'
const SOURCE_URN = 'urn:core:instance:musterstadt:datasource:default:baumkatasterdb:a1s2d3f4g5:1.0.0'
const SINK_URN = 'urn:core:instance:musterstadt:datasink:default:kiezbaeumetabelle:h6j7k8l9m0:1.0.0'

function snapshot(): InstanceSnapshot {
    return {
        dataset: { id: 'ds-1', name: 'Kiez-Baumkataster', description: 'Bäume im Kiez' },
        structures: [
            {
                versionId: 'v-zeile',
                dataStructureId: 's-zeile',
                name: 'Baumkataster-Zeile',
                modelUrn: ZEILE_INSTANCE,
                model: {
                    $id: ZEILE_INSTANCE,
                    type: 'object',
                    properties: { baum_id: { type: 'string' }, lon: { type: 'number' }, lat: { type: 'number' } },
                    $defs: {
                        Zeile: { $id: 'urn:core:instance:musterstadt:element:default:zeile:p0o9i8u7y6:1.0.0', type: 'object' },
                    },
                },
            },
            {
                versionId: 'v-kiez',
                dataStructureId: 's-kiez',
                name: 'Kiez-Baum',
                modelUrn: `${KIEZBAUM_CATALOG}:1.0.0`,
                model: { $id: `${KIEZBAUM_CATALOG}:1.0.0`, title: 'Kiez-Baum', type: 'object', properties: { baumId: { type: 'string' } } },
            },
        ],
        sources: [
            {
                id: 'src-1',
                name: 'Baumkataster-DB',
                description: 'Liest das Kataster',
                connectorType: 'SQL',
                configuration: {
                    driver: 'postgres',
                    dsn: 'postgres://kataster:geheim@baumkataster-db:5432/fachverfahren',
                    table: 'kataster.kiez_baeume',
                    user: 'kataster',
                    password: '********',
                    // A field the platform masked on read whose NAME does not say secret.
                    zugang: '********',
                },
                configurationUrn: SOURCE_URN,
                structureVersionId: 'v-zeile',
            },
        ],
        mappings: [
            {
                urn: MAPPING_INSTANCE,
                document: {
                    $schema: 'https://civitasconnect.digital/core/mapping/v1',
                    id: `${MAPPING_INSTANCE}:1.0.0`,
                    title: 'Kataster-Import',
                    source: ZEILE_INSTANCE,
                    target: `${KIEZBAUM_CATALOG}:1.0.0`,
                    fields: { '$.baumId': '$.baum_id', '$.position': { op: 'geoPoint', lon: '$.lon', lat: '$.lat' } },
                    positions: { a: 1 },
                },
            },
        ],
        sinks: [
            {
                id: 'sink-1',
                name: 'Kiez-Bäume-Tabelle',
                dataSinkType: 'POSTGIS',
                configuration: {
                    tableName: 'kiez_baeume',
                    element: `${KIEZBAUM_CATALOG}:1.0.0`,
                    dataStructureVersion: { id: 'v-kiez', dataStructureId: 's-kiez' },
                },
                configurationUrn: SINK_URN,
                structureVersionId: 'v-kiez',
            },
        ],
        pipelines: [
            {
                id: 'p-1',
                name: 'Kataster-Import',
                model: {
                    nodes: [
                        { id: 'n-source', kind: 'source', sourceRef: SOURCE_URN },
                        { id: 'n-mapping', kind: 'mapping', mappingRef: `${MAPPING_INSTANCE}:1.0.0` },
                        { id: 'n-sink', kind: 'sink', sinkRef: SINK_URN },
                    ],
                    edges: [],
                },
                styles: { nodes: [{ id: 'n-source', position: { x: 0, y: 120 } }] },
                dataSourceIds: ['src-1'],
                dataSinkIds: ['sink-1'],
            },
        ],
        warnings: [],
    }
}

const options: ExportOptions = {
    publisher: 'openurbanapps',
    slug: 'kiez-baumkataster',
    version: '1.0.0',
    displayName: 'Kiez-Baumkataster',
    description: 'Baumkataster aus einer Fachverfahrens-Datenbank.',
    maintainer: 'Open Urban Apps',
    license: 'EUPL-1.2',
    keywords: ['baumkataster', 'karte'],
    domain: 'environment',
    provenance: { datasetId: 'ds-1', datasetName: 'Kiez-Baumkataster', exportedAt: '2026-09-08' },
}

const parse = (files: Record<string, string>, path: string) => JSON.parse(files[path]) as Record<string, unknown>

describe('transformSnapshot', () => {
    const pkg = transformSnapshot(snapshot(), options)

    it('lays the package out like the artifact repositories', () => {
        expect(Object.keys(pkg.files).sort()).toEqual([
            'README.md',
            'ci/validate-bundle.py',
            'core-ir/baumkataster-db.datasource.json',
            'core-ir/baumkataster-zeile.datastructure.json',
            'core-ir/kataster-import.mapping.json',
            'core-ir/kataster-import.pipeline.json',
            'core-ir/kiez-baeume-tabelle.datasink.json',
            'core-ir/kiez-baum.datastructure.json',
            'core-ir/manifest.json',
        ])
        expect(pkg.manifest.id).toBe('urn:openurbanapps:usecase:kiez-baumkataster')
        expect(pkg.manifest.members.dataStructures.map((m) => m.file)).toEqual([
            'baumkataster-zeile.datastructure.json',
            'kiez-baum.datastructure.json',
        ])
    })

    it('passes the package validator — the round trip is installable', () => {
        expect(checkPackage(pkg.files)).toEqual([])
    })

    it('keeps catalogue identities and derives instance-minted ones to the published values', () => {
        const zeile = parse(pkg.files, 'core-ir/baumkataster-zeile.datastructure.json')
        const kiez = parse(pkg.files, 'core-ir/kiez-baum.datastructure.json')
        // Same publisher and name as the hand-authored package → the very same URN.
        expect(zeile.$id).toBe('urn:core:standard:openurbanapps:datastructure:environment:baumkatasterzeile:ny4qd9zowt')
        expect(zeile.title).toBe('Baumkataster-Zeile')
        expect(kiez.$id).toBe(KIEZBAUM_CATALOG)
        const defs = zeile.$defs as Record<string, { $id: string }>
        expect(defs.Zeile.$id).toMatch(/^urn:core:standard:openurbanapps:element:environment:baumkatasterzeilezeile:[0-9a-z]{10}$/)
        expect(pkg.identities.find((i) => i.title === 'Kiez-Baum')?.kept).toBe(true)
        expect(pkg.identities.find((i) => i.title === 'Baumkataster-Zeile')?.kept).toBe(false)
    })

    it('binds mapping references to the package identities and drops editor state', () => {
        const mapping = parse(pkg.files, 'core-ir/kataster-import.mapping.json')
        const document = mapping.document as Record<string, unknown>
        expect(mapping.mappingUrn).toBe('urn:core:standard:openurbanapps:mapping:environment:katasterimport:' + (mapping.mappingUrn as string).split(':').pop())
        expect(document.source).toBe('urn:core:standard:openurbanapps:datastructure:environment:baumkatasterzeile:ny4qd9zowt')
        expect(document.target).toBe(KIEZBAUM_CATALOG)
        expect(document).not.toHaveProperty('positions')
        expect(document).not.toHaveProperty('id')
        expect(document).not.toHaveProperty('$schema')
    })

    it('strips credentials and declares them as install parameters', () => {
        const source = parse(pkg.files, 'core-ir/baumkataster-db.datasource.json')
        expect(source).not.toHaveProperty('password')
        expect(source).not.toHaveProperty('zugang')
        expect(source.dsn).toBe('postgres://kataster@baumkataster-db:5432/fachverfahren')
        expect(source.connectionType).toBe('sql')
        expect(source.element).toBe('urn:core:standard:openurbanapps:datastructure:environment:baumkatasterzeile:ny4qd9zowt')
        expect(JSON.stringify(pkg.files)).not.toContain('geheim')
        const member = pkg.manifest.members.dataSources?.[0]
        expect(member?.parameters?.map((p) => p.field).sort()).toEqual(['dsn', 'password', 'user', 'zugang'])
        // The field name decides first (password → secret), the masked value second (zugang → masked).
        expect(pkg.stripped.map((s) => s.reason).sort()).toEqual(['credential-in-url', 'masked', 'secret'])
    })

    it('rewrites the pipeline graph to bundle-local titles and package URNs', () => {
        const pipeline = parse(pkg.files, 'core-ir/kataster-import.pipeline.json')
        const nodes = (pipeline.model as { nodes: Record<string, unknown>[] }).nodes
        expect(nodes[0].sourceRef).toBe('Baumkataster-DB')
        expect(nodes[0]['x-ui-position']).toEqual({ x: 0, y: 120 })
        expect(nodes[1].mappingRef).toBe(parse(pkg.files, 'core-ir/kataster-import.mapping.json').mappingUrn)
        expect(nodes[2].sinkRef).toBe('Kiez-Bäume-Tabelle')
        const sink = parse(pkg.files, 'core-ir/kiez-baeume-tabelle.datasink.json')
        expect(sink.element).toBe(KIEZBAUM_CATALOG)
        expect(sink).not.toHaveProperty('dataStructureVersion')
    })

    it('warns instead of failing when a reference cannot be resolved', () => {
        const broken = snapshot()
        broken.pipelines[0].model = {
            nodes: [{ id: 'n', kind: 'source', sourceRef: 'urn:core:instance:x:datasource:d:n:0000000000:1.0.0' }],
        }
        const out = transformSnapshot(broken, options)
        expect(out.warnings.some((w) => w.includes('sourceRef'))).toBe(true)
    })
})
