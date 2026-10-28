import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { assembleCatalogEntry, parsePackageManifest } from '@/lib/catalog/assemble'
import { isDataStructureEntry } from '@/lib/catalog/types'
import { checkPackage } from '@/lib/export/package-check'
import type { InstanceSnapshot } from '@/lib/export/portal-reader'
import { transformSnapshot, type ExportedPackage, type ExportOptions } from '@/lib/export/transform'
import { extractMasterportal } from '@/lib/geoportal/extract'
import { applyMasterportal, readMasterportalMember, type MasterportalMember } from '@/lib/geoportal/merge'

/**
 * Sharing a use case that shows in the geoportal: its Masterportal entries travel as the member
 * `masterportal`, without what belongs to the instance, and the receiving instance shows them again
 * for its own dataset. The proof is the whole way: geoportal files of one dataset, the package, the
 * install's assembly, the geoportal files of another dataset, and back.
 */

const BAUM = 'urn:core:instance:stadt:datastructure:default:jungbaum:aaaaaaaaaa:1.0.0'

const snapshot: InstanceSnapshot = {
    dataset: { id: 'ba379d1a-1369-4b5e-8f66-768c4e14da38', name: 'Jungbäume' },
    structures: [
        {
            versionId: 'v1',
            dataStructureId: 's1',
            name: 'Jungbaum',
            modelUrn: BAUM,
            model: { type: 'object', properties: { baumId: { type: 'string' } } },
        },
    ],
    sources: [],
    mappings: [],
    sinks: [
        {
            id: 'tabelle',
            name: 'Jungbäume-Tabelle',
            dataSinkType: 'POSTGIS',
            configuration: { tableName: 'jungbaeume', element: BAUM },
            structureVersionId: 'v1',
        },
        { id: 'frost', name: 'Jungbäume-FROST', dataSinkType: 'FROST', configuration: { port: 'Things', element: BAUM } },
    ],
    pipelines: [],
    apis: [
        { name: 'Jungbäume Karte', slug: 'karte', standard: 'OWS' },
        { name: 'Jungbäume SensorThings', slug: 'sta', standard: 'STA' },
    ],
    styles: [{ id: 'gruen', name: 'jungbaeume-gruen', sldContent: '<StyledLayerDescriptor version="1.0.0"/>' }],
    layers: [
        {
            id: 'layer',
            layerName: 'jungbaeume',
            keywords: [],
            attribute: ['baumId'],
            dataSinkId: 'tabelle',
            defaultStyleId: 'gruen',
            alternativeStyleIds: [],
        },
    ],
    warnings: [],
}

const MEMBER: MasterportalMember = readMasterportalMember(
    {
        folder: 'Jungbäume Rundweg',
        layers: [
            {
                apiRef: 'karte',
                visibility: true,
                service: { name: 'Jungbäume - Baumkataster', typ: 'WMS', layers: 'jungbaeume', format: 'image/png' },
            },
            {
                apiRef: 'sta',
                visibility: false,
                service: { name: 'Jungbäume - Bodenfeuchte', typ: 'SensorThings', styleId: 'jungbaeume_bodenfeuchte' },
            },
        ],
        styles: [{ styleId: 'jungbaeume_bodenfeuchte', rules: [{ style: { type: 'circle', circleRadius: 9 } }] }],
    },
    'test',
)

const options: ExportOptions = {
    publisher: 'openurbanapps',
    slug: 'jungbaum-rundweg',
    version: '1.1.6',
    displayName: 'Jungbäume Rundweg',
    description: 'Jungbäume mit Karte im Geoportal',
    maintainer: 'Open Urban Apps',
    license: 'EUPL-1.2',
    keywords: ['karte'],
    domain: 'environment',
    masterportal: MEMBER,
    provenance: { datasetId: snapshot.dataset.id, datasetName: 'Jungbäume', exportedAt: '2026-10-28' },
}

const FILE = 'core-ir/jungbaum-rundweg.masterportal.json'

function withMember(member: unknown): ExportedPackage {
    const pkg = transformSnapshot(snapshot, options)
    return { ...pkg, files: { ...pkg.files, [FILE]: `${JSON.stringify(member, null, 2)}\n` } }
}

describe('exporting a use case with Masterportal entries', () => {
    const pkg = transformSnapshot(snapshot, options)

    it('carries them as one member of its own, as given', () => {
        expect(pkg.manifest.members.masterportal).toEqual([{ file: 'jungbaum-rundweg.masterportal.json' }])
        expect(JSON.parse(pkg.files[FILE])).toEqual(MEMBER)
        expect(pkg.files['README.md']).toContain('jungbaum-rundweg.masterportal.json')
    })

    it('passes the package check', () => {
        expect(checkPackage(pkg.files)).toEqual([])
    })

    it('adds no member without entries', () => {
        const plain = transformSnapshot(snapshot, { ...options, masterportal: undefined })
        expect(plain.manifest.members).not.toHaveProperty('masterportal')
    })

    it('fails the check where a layer names what the package does not bring, or what belongs to the instance', () => {
        const broken = withMember({
            ...MEMBER,
            layers: [
                { apiRef: 'wms', service: { name: 'Fremd', typ: 'WMS', layers: 'andere' } },
                { apiRef: 'karte', service: { name: 'Falsch', typ: 'SensorThings', id: '7' } },
                { apiRef: 'sta', service: { name: 'Ohne Stil', typ: 'SensorThings', styleId: 'fehlt' } },
            ],
        })

        expect(checkPackage(broken.files)).toEqual([
            `${FILE}: layers[1]: service must not carry 'id', the marketplace sets it for the installed dataset`,
            `${FILE}: layers[0] apiRef 'wms' matches no bundled api slug`,
            `${FILE}: layers[0] WMS layers 'andere' matches no bundled layerName`,
            `${FILE}: layers[1] typ 'SensorThings' needs an STA api, but 'karte' is OWS`,
            `${FILE}: layers[2] styleId 'fehlt' matches no style of this member`,
        ])
    })

    it('comes back for another dataset as it went out, through the install\'s assembly', () => {
        const here = applyMasterportal({ services: [], config: {}, styles: [] }, MEMBER, snapshot.dataset.id)
        const shared = extractMasterportal(here, snapshot.dataset.id)?.member
        const exported = transformSnapshot(snapshot, { ...options, masterportal: shared })

        const manifest = parsePackageManifest(JSON.parse(exported.files['core-ir/manifest.json']), 'export')
        const entry = assembleCatalogEntry(manifest, (file) => JSON.parse(exported.files[`core-ir/${file}`]))
        const bundled = isDataStructureEntry(entry) ? undefined : entry.bundle.masterportal?.[0]
        expect(bundled).toBeDefined()
        const there = applyMasterportal(here, readMasterportalMember(bundled!.document, bundled!.file), 'other-dataset')

        expect(extractMasterportal(there, 'other-dataset')?.member).toEqual(MEMBER)
        expect(extractMasterportal(there, snapshot.dataset.id)?.member).toEqual(MEMBER)
    })
})

const hasPython = spawnSync('python3', ['--version']).status === 0

/** Writes the package to a temp directory and runs the script it ships. */
function runShippedValidator(pkg: ExportedPackage): { status: number | null; output: string; errors: string[] } {
    const dir = mkdtempSync(join(tmpdir(), 'export-masterportal-'))
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

describe.skipIf(!hasPython)('exported Masterportal member against the shipped validate-bundle.py', () => {
    it("passes the package repositories' validator", () => {
        const run = runShippedValidator(transformSnapshot(snapshot, options))
        expect(run.status, run.output).toBe(0)
        expect(run.output).toMatch(/^Package OK/)
    })

    it('fails the same rules as the package check', () => {
        const broken = withMember({
            ...MEMBER,
            layers: [
                { apiRef: 'wms', service: { name: 'Fremd', typ: 'WMS', layers: 'andere' } },
                { apiRef: 'karte', service: { name: 'Falsch', typ: 'SensorThings', id: '7' } },
                { apiRef: 'sta', service: { name: 'Ohne Stil', typ: 'SensorThings', styleId: 'fehlt' } },
            ],
        })

        const run = runShippedValidator(broken)

        expect(run.status).toBe(1)
        expect([...run.errors].sort()).toEqual([...checkPackage(broken.files)].sort())
    })
})
