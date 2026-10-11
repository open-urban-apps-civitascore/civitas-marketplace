import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { checkPackage } from '@/lib/export/package-check'
import { transformSnapshot, type ExportedPackage, type ExportOptions } from '@/lib/export/transform'
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

const BEOBACHTUNG = 'urn:core:instance:stadt:datastructure:default:beobachtung:eeeeeeeeee:1.0.0'

/**
 * The same dataset with a FROST flow as the platform stores it: the sink's
 * configuration names only its port and the mapping target's versioned URN,
 * and the structure behind that URN is part of the snapshot.
 */
const frostSnapshot: InstanceSnapshot = {
    ...snapshot,
    structures: [
        ...snapshot.structures,
        {
            versionId: 'v3',
            dataStructureId: 's3',
            name: 'Beobachtung',
            modelUrn: BEOBACHTUNG,
            model: {
                $ref: '#/$defs/Observation',
                $defs: { Observation: { type: 'object', properties: { result: { type: 'number' } } } },
            },
        },
    ],
    mappings: [
        ...snapshot.mappings,
        {
            urn: 'urn:core:instance:stadt:mapping:default:luftzubeobachtung:gggggggggg',
            document: {
                title: 'Luft zu Beobachtung',
                source: 'urn:core:instance:stadt:datastructure:default:luftmessung:aaaaaaaaaa:1.0.0',
                target: BEOBACHTUNG,
                fields: { '$.result': '$.pm25' },
            },
        },
    ],
    sinks: [
        ...snapshot.sinks,
        {
            id: 'frost',
            name: 'Messwerte',
            dataSinkType: 'FROST',
            configuration: { port: 'Observations', element: BEOBACHTUNG },
            configurationUrn: 'urn:core:instance:stadt:datasink:default:messwerte:ffffffffff:1.0.0',
        },
    ],
    pipelines: [
        ...snapshot.pipelines,
        {
            id: 'p2',
            name: 'Luft-Sensorik',
            model: {
                nodes: [
                    { id: 'a', kind: 'source', sourceRef: 'urn:core:instance:stadt:datasource:default:luftmessungsfeed:bbbbbbbbbb:1.0.0' },
                    { id: 'b', kind: 'mapping', mappingRef: 'urn:core:instance:stadt:mapping:default:luftzubeobachtung:gggggggggg:1.0.0' },
                    { id: 'c', kind: 'sink', sinkRef: 'urn:core:instance:stadt:datasink:default:messwerte:ffffffffff:1.0.0' },
                ],
                edges: [],
            },
            dataSourceIds: ['src'],
            dataSinkIds: ['frost'],
        },
    ],
}

const options: ExportOptions = {
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
}

/** Writes the package to a temp directory and runs the script it ships; status 0 means it passed. */
function runShippedValidator(pkg: ExportedPackage): { status: number | null; output: string; errors: string[] } {
    const dir = mkdtempSync(join(tmpdir(), 'export-roundtrip-'))
    try {
        for (const [path, content] of Object.entries(pkg.files)) {
            mkdirSync(dirname(join(dir, path)), { recursive: true })
            writeFileSync(join(dir, path), content)
        }
        const run = spawnSync('python3', ['ci/validate-bundle.py'], { cwd: dir, encoding: 'utf8' })
        const errors = run.stdout
            .split('\n')
            .filter((line) => line.startsWith('  - '))
            .map((line) => line.slice(4))
        return { status: run.status, output: `${run.stdout}${run.stderr}`, errors }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

describe.skipIf(!hasPython)('exported package against the real validate-bundle.py', () => {
    it('passes the package repositories\' validator', () => {
        const run = runShippedValidator(transformSnapshot(snapshot, options))
        expect(run.status).toBe(0)
        expect(run.output).toMatch(/^Package OK/)
    })

    it('passes both checks with a mapped FROST sink', () => {
        const pkg = transformSnapshot(frostSnapshot, options)
        const sink = JSON.parse(pkg.files['core-ir/messwerte.datasink.json'])
        const mapping = JSON.parse(pkg.files['core-ir/luft-zu-beobachtung.mapping.json'])
        // The port travels, and the element is re-identified like the mapping's target.
        expect(sink.port).toBe('Observations')
        expect(sink.element).toBe(mapping.document.target)
        const run = runShippedValidator(pkg)
        expect(run.status).toBe(0)
        expect(run.output).toMatch(/^Package OK/)
        expect(checkPackage(pkg.files)).toEqual([])
    })

    it('fails both checks when the FROST sink\'s structure is missing from the snapshot', () => {
        // The state the export is in when the reader cannot find the structure a
        // FROST sink names: the references stay instance URNs.
        const pkg = transformSnapshot(
            { ...frostSnapshot, structures: snapshot.structures, warnings: [] },
            options,
        )
        const run = runShippedValidator(pkg)
        const logical = BEOBACHTUNG.slice(0, BEOBACHTUNG.lastIndexOf(':'))
        expect(run.status).toBe(1)
        expect(run.errors).toEqual([
            `core-ir/luft-zu-beobachtung.mapping.json: mapping target '${logical}' is not a bundled structure $id`,
            `core-ir/messwerte.datasink.json: element '${logical}' is not a bundled structure $id`,
        ])
        expect(checkPackage(pkg.files).sort()).toEqual([...run.errors].sort())
    })
})
