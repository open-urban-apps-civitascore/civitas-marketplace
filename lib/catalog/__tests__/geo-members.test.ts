import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { assembleCatalogEntry, parsePackageManifest } from '@/lib/catalog/assemble'
import { isDataStructureEntry, type UseCaseEntry } from '@/lib/catalog/types'
import { checkPackage } from '@/lib/export/package-check'
import { VALIDATE_BUNDLE_SCRIPT } from '@/lib/export/validate-bundle-script'
import { buildInstallationRequest, summarizeInstallation } from '@/lib/install-payload'

/**
 * A use case with a map: one PostGIS sink, an OWS api that serves it, a style and a layer. The
 * same package goes through every check a geo member meets on its way: the catalogue assembly,
 * the install request, the export's package check and the package repositories' own validator.
 */
const STRUCTURE_ID = 'urn:core:standard:openurbanapps:datastructure:environment:kiezbaum:aaaaaaaaaa'
const SINK_ID = 'urn:core:standard:openurbanapps:datasink:environment:kiezbaeumetabelle:bbbbbbbbbb'
const SLD =
    '<StyledLayerDescriptor version="1.0.0"><NamedLayer><Name>baeume</Name></NamedLayer></StyledLayerDescriptor>'

type Files = Record<string, Record<string, unknown>>

const MEMBERS = {
    dataStructures: [{ file: 'kiez-baum.datastructure.json' }],
    dataSinks: [{ file: 'kiez-baeume-tabelle.datasink.json' }],
    apis: [{ file: 'karte.api.json' }],
    styles: [{ file: 'baeume-gruen.style.json' }],
    layers: [{ file: 'baeume.layer.json' }],
}

function packageFiles(overrides: Files = {}, members: Record<string, unknown> = MEMBERS): Files {
    return {
        'manifest.json': {
            id: 'urn:openurbanapps:usecase:kiez-baeume',
            type: 'usecase',
            displayName: 'Kiez-Bäume',
            description: 'Straßenbäume des Kiezes auf der Karte',
            version: '1.0.0',
            maintainer: 'Open Urban Apps',
            license: 'EUPL-1.2',
            keywords: ['baum', 'karte'],
            members,
            dependencies: [],
        },
        'kiez-baum.datastructure.json': {
            $id: STRUCTURE_ID,
            title: 'Kiez-Baum',
            type: 'object',
            properties: { baumId: { type: 'string' }, art: { type: 'string' } },
        },
        'kiez-baeume-tabelle.datasink.json': {
            $schema: 'https://civitasconnect.digital/core/datasink/v1',
            id: SINK_ID,
            title: 'Kiez-Bäume-Tabelle',
            connectionType: 'postgis',
            tableName: 'kiez_baeume',
            element: STRUCTURE_ID,
        },
        'karte.api.json': { name: 'Karte der Kiez-Bäume', slug: 'karte', standard: 'OWS', version: '1.1.0' },
        'baeume-gruen.style.json': { name: 'baeume-gruen', sldContent: SLD },
        'baeume.layer.json': {
            layerName: 'baeume',
            title: 'Straßenbäume',
            sinkRef: 'Kiez-Bäume-Tabelle',
            defaultStyleRef: 'baeume-gruen',
            alternativeStyleRefs: ['baeume-gruen'],
            attribute: ['baumId', 'art'],
        },
        ...overrides,
    }
}

function assemble(files: Files): UseCaseEntry {
    const manifest = parsePackageManifest(files['manifest.json'], 'test')
    const entry = assembleCatalogEntry(manifest, (file) => files[file])
    if (isDataStructureEntry(entry)) throw new Error('expected a use case')
    return entry
}

describe('catalogue assembly of geo members', () => {
    it('assembles apis, styles and layers', () => {
        const entry = assemble(packageFiles())
        expect(entry.bundle.apis).toHaveLength(1)
        expect(entry.bundle.styles).toHaveLength(1)
        expect(entry.bundle.layers).toHaveLength(1)
    })

    it('refuses a slug the platform reserves', () => {
        const files = packageFiles({ 'karte.api.json': { name: 'Admin', slug: 'admin', standard: 'OWS' } })
        expect(() => assemble(files)).toThrow(/reserved/)
    })

    it('refuses a layer whose sink is not in the package', () => {
        const files = packageFiles({
            'baeume.layer.json': { layerName: 'baeume', sinkRef: 'Andere Tabelle', defaultStyleRef: 'baeume-gruen' },
        })
        expect(() => assemble(files)).toThrow(/sinkRef 'Andere Tabelle'/)
    })

    it('refuses a layer whose style is not in the package', () => {
        const files = packageFiles({
            'baeume.layer.json': { layerName: 'baeume', sinkRef: 'Kiez-Bäume-Tabelle', defaultStyleRef: 'rot' },
        })
        expect(() => assemble(files)).toThrow(/style 'rot'/)
    })

    it('refuses layers no OWS api serves', () => {
        const { apis: _apis, ...withoutApis } = MEMBERS
        expect(() => assemble(packageFiles({}, withoutApis))).toThrow(/OWS api that serves/)
    })

    it('refuses an OWS api without a PostGIS sink', () => {
        const files = packageFiles({
            'kiez-baeume-tabelle.datasink.json': {
                $schema: 'https://civitasconnect.digital/core/datasink/v1',
                id: SINK_ID,
                title: 'Kiez-Bäume-Tabelle',
                connectionType: 'frost',
                element: STRUCTURE_ID,
            },
        })
        expect(() => assemble(files)).toThrow(/PostGIS/)
    })

    it('refuses a layer name GeoServer cannot publish', () => {
        const files = packageFiles({
            'baeume.layer.json': { layerName: '1-baeume', sinkRef: 'Kiez-Bäume-Tabelle' },
        })
        expect(() => assemble(files)).toThrow(/layerName/)
    })
})

describe('install request with geo members', () => {
    const request = buildInstallationRequest(assemble(packageFiles()), 'pool-1')
    const members = request.package.members
    const byKind = (kind: string) => members.filter((member) => member.kind === kind)

    it('sends the geo members after the members they reference', () => {
        expect(members.map((member) => member.kind)).toEqual([
            'datastructure',
            'dataset',
            'api',
            'datasink',
            'style',
            'layer',
        ])
    })

    it('derives their identities from the package and their names', () => {
        expect(byKind('api')[0].urn).toMatch(/^urn:core:standard:openurbanapps:api:environment:karte:[0-9a-z]{10}$/)
        expect(byKind('style')[0].urn).toMatch(
            /^urn:core:standard:openurbanapps:style:environment:baeumegruen:[0-9a-z]{10}$/,
        )
        expect(byKind('api')[0].name).toBe('Karte der Kiez-Bäume')
    })

    it('binds the layer to its sink and styles by package URN', () => {
        const style = byKind('style')[0]
        const layer = byKind('layer')[0].content
        expect(layer.sinkRef).toBe(SINK_ID)
        expect(layer.defaultStyleRef).toBe(style.urn)
        expect(layer.alternativeStyleRefs).toEqual([style.urn])
        expect(layer.attribute).toEqual(['baumId', 'art'])
    })
})

describe('install summary', () => {
    it('names the geo kinds only where the package had them', () => {
        const withMap = summarizeInstallation(
            {
                dataSetName: 'Kiez-Bäume',
                artifacts: [
                    { artifactType: 'DATA_SET' },
                    { artifactType: 'NAMED_API' },
                    { artifactType: 'LAYER' },
                ],
            },
            'Kiez-Bäume',
        )
        expect(withMap).toContain('1 API(s)')
        expect(withMap).toContain('1 Kartenebene(n)')
        expect(withMap).not.toContain('Stil')

        const withoutMap = summarizeInstallation(
            { dataSetName: 'Kiez-Bäume', artifacts: [{ artifactType: 'DATA_SET' }] },
            'Kiez-Bäume',
        )
        expect(withoutMap).not.toContain('API')
    })
})

function packageLayout(files: Files): Record<string, string> {
    return Object.fromEntries(
        Object.entries(files).map(([name, content]) => [`core-ir/${name}`, `${JSON.stringify(content, null, 2)}\n`]),
    )
}

describe('package check of the export', () => {
    it('accepts the geo members', () => {
        expect(checkPackage(packageLayout(packageFiles()))).toEqual([])
    })

    it('names a layer whose sink is not in the package', () => {
        const files = packageFiles({
            'baeume.layer.json': { layerName: 'baeume', sinkRef: 'Andere Tabelle', defaultStyleRef: 'baeume-gruen' },
        })
        expect(checkPackage(packageLayout(files))).toEqual([
            "core-ir/baeume.layer.json: sinkRef 'Andere Tabelle' matches no bundled datasink title",
        ])
    })
})

const hasPython = spawnSync('python3', ['--version']).status === 0

describe.skipIf(!hasPython)('package repositories\' validator with geo members', () => {
    function validate(files: Files): { status: number | null; output: string } {
        const dir = mkdtempSync(join(tmpdir(), 'geo-members-'))
        try {
            mkdirSync(join(dir, 'core-ir'))
            mkdirSync(join(dir, 'ci'))
            for (const [path, content] of Object.entries(packageLayout(files))) {
                writeFileSync(join(dir, path), content)
            }
            writeFileSync(join(dir, 'ci', 'validate-bundle.py'), VALIDATE_BUNDLE_SCRIPT)
            const run = spawnSync('python3', ['ci/validate-bundle.py'], { cwd: dir, encoding: 'utf8' })
            return { status: run.status, output: `${run.stdout}${run.stderr}` }
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    }

    it('accepts the geo package', () => {
        const result = validate(packageFiles())
        expect(result.output).toMatch(/^Package OK/)
        expect(result.status).toBe(0)
    })

    it('refuses layers no OWS api serves', () => {
        const { apis: _apis, ...withoutApis } = MEMBERS
        const files = packageFiles({}, withoutApis)
        delete files['karte.api.json']
        const result = validate(files)
        expect(result.status).toBe(1)
        expect(result.output).toContain('layers need an OWS api that serves them')
    })

    it('refuses a reserved slug', () => {
        const result = validate(packageFiles({ 'karte.api.json': { name: 'Admin', slug: 'admin', standard: 'OWS' } }))
        expect(result.status).toBe(1)
        expect(result.output).toContain("api slug 'admin' is reserved by the platform")
    })
})
