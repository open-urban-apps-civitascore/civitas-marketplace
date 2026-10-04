import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { transformSnapshot } from '@/lib/export/transform'
import type { InstanceSnapshot } from '@/lib/export/portal-reader'

/**
 * The acceptance test that matters: an exported package must satisfy the
 * package repositories' OWN validator (`ci/validate-bundle.py`, which every
 * export ships), not only our TypeScript port of it. Runs the real script
 * against a package written to a temp directory; skipped where python3 is
 * not installed, so CI without Python still passes the rest.
 */
const python = spawnSync('python3', ['--version'])
const hasPython = python.status === 0

const KIEZBAUM = 'urn:core:standard:openurbanapps:datastructure:environment:kiezbaum:f1i2sjhgvq'

const snapshot: InstanceSnapshot = {
    dataset: { id: 'ds', name: 'Luft und Bäume', description: 'Zwei Quellen, zwei Senken' },
    structures: [
        {
            versionId: 'v1',
            dataStructureId: 's1',
            name: 'Luftmessung',
            modelUrn: 'urn:core:instance:stadt:datastructure:default:luftmessung:aaaaaaaaaa:1.0.0',
            model: { type: 'object', properties: { pm25: { type: 'number' }, stationId: { type: 'string' } } },
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
            name: 'Luftmessungs-Feed',
            connectorType: 'MQTT',
            configuration: { urls: ['tcp://civitas-mosquitto:1883'], topics: ['stadt/luft/+'], client_id: 'x', password: '********' },
            configurationUrn: 'urn:core:instance:stadt:datasource:default:luftmessungsfeed:bbbbbbbbbb:1.0.0',
            structureVersionId: 'v1',
        },
    ],
    mappings: [
        {
            urn: 'urn:core:instance:stadt:mapping:default:luftzubaum:cccccccccc',
            document: {
                title: 'Luft zu Baum',
                source: 'urn:core:instance:stadt:datastructure:default:luftmessung:aaaaaaaaaa:1.0.0',
                target: `${KIEZBAUM}:1.0.0`,
                fields: { '$.baumId': '$.stationId' },
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
            name: 'Luft-Import',
            model: {
                nodes: [
                    { id: 'a', kind: 'source', sourceRef: 'urn:core:instance:stadt:datasource:default:luftmessungsfeed:bbbbbbbbbb:1.0.0' },
                    { id: 'b', kind: 'mapping', mappingRef: 'urn:core:instance:stadt:mapping:default:luftzubaum:cccccccccc:1.0.0' },
                    { id: 'c', kind: 'sink', sinkRef: 'urn:core:instance:stadt:datasink:default:baumtabelle:dddddddddd:1.0.0' },
                ],
                edges: [],
            },
            dataSourceIds: ['src'],
            dataSinkIds: ['sink'],
        },
    ],
    warnings: [],
}

describe.skipIf(!hasPython)('exported package against the real validate-bundle.py', () => {
    it('passes the package repositories\' validator', () => {
        const pkg = transformSnapshot(snapshot, {
            publisher: 'stadt',
            slug: 'luft-und-baeume',
            version: '1.0.0',
            displayName: 'Luft und Bäume',
            description: 'Zwei Quellen, zwei Senken',
            maintainer: 'Stadt',
            license: 'EUPL-1.2',
            keywords: ['luft'],
            domain: 'environment',
            provenance: { datasetId: 'ds', datasetName: 'Luft und Bäume', exportedAt: '2026-09-08' },
        })
        const dir = mkdtempSync(join(tmpdir(), 'export-roundtrip-'))
        try {
            for (const [path, content] of Object.entries(pkg.files)) {
                mkdirSync(dirname(join(dir, path)), { recursive: true })
                writeFileSync(join(dir, path), content)
            }
            const output = execFileSync('python3', ['ci/validate-bundle.py'], { cwd: dir, encoding: 'utf8' })
            expect(output).toMatch(/^Package OK/)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
