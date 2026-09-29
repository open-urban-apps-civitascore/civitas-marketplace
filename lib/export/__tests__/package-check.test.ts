import { describe, expect, it } from 'vitest'

import { checkPackage } from '@/lib/export/package-check'

const STRUCTURE = 'urn:core:standard:openurbanapps:datastructure:test:messung:abcdefghij'

function validPackage(): Record<string, string> {
    return {
        'core-ir/manifest.json': JSON.stringify({
            id: 'urn:openurbanapps:usecase:test',
            type: 'usecase',
            version: '1.0.0',
            displayName: 'Test',
            description: 'Test',
            maintainer: 'x',
            license: 'EUPL-1.2',
            keywords: [],
            members: {
                dataStructures: [{ file: 'messung.datastructure.json' }],
                dataSources: [{ file: 'feed.datasource.json' }],
                mappings: [{ file: 'm.mapping.json' }],
                dataSinks: [{ file: 't.datasink.json' }],
                pipelines: [{ file: 'p.pipeline.json' }],
            },
            dependencies: [],
        }),
        'core-ir/messung.datastructure.json': JSON.stringify({ $id: STRUCTURE, title: 'Messung', type: 'object' }),
        'core-ir/feed.datasource.json': JSON.stringify({
            $schema: 's',
            id: 'urn:core:standard:openurbanapps:datasource:test:feed:abcdefghij',
            title: 'Feed',
            connectionType: 'mqtt',
            element: STRUCTURE,
        }),
        'core-ir/m.mapping.json': JSON.stringify({
            mappingUrn: 'urn:core:standard:openurbanapps:mapping:test:m:abcdefghij',
            name: 'M',
            document: { source: STRUCTURE, target: STRUCTURE, fields: {} },
        }),
        'core-ir/t.datasink.json': JSON.stringify({
            $schema: 's',
            id: 'urn:core:standard:openurbanapps:datasink:test:t:abcdefghij',
            title: 'Tabelle',
            connectionType: 'postgis',
            element: STRUCTURE,
        }),
        'core-ir/p.pipeline.json': JSON.stringify({
            name: 'P',
            model: {
                nodes: [
                    { id: 'a', kind: 'source', sourceRef: 'Feed' },
                    { id: 'b', kind: 'mapping', mappingRef: 'M' },
                    { id: 'c', kind: 'sink', sinkRef: 'Tabelle' },
                ],
            },
        }),
    }
}

describe('checkPackage', () => {
    it('accepts a package that hangs together', () => {
        expect(checkPackage(validPackage())).toEqual([])
    })

    it('reports a listed member file that does not exist', () => {
        const files = validPackage()
        delete files['core-ir/t.datasink.json']
        expect(checkPackage(files)).toContain("members.dataSinks lists 't.datasink.json' but core-ir/t.datasink.json does not exist")
    })

    it('reports an unlisted JSON file inside core-ir', () => {
        const files = validPackage()
        files['core-ir/stray.json'] = '{}'
        expect(checkPackage(files)).toContain('core-ir/stray.json exists but is not listed in manifest members')
    })

    it('reports pipeline references that match no bundled member', () => {
        const files = validPackage()
        files['core-ir/p.pipeline.json'] = JSON.stringify({
            name: 'P',
            model: { nodes: [{ id: 'a', kind: 'source', sourceRef: 'Nope' }] },
        })
        expect(checkPackage(files).some((e) => e.includes("sourceRef 'Nope'"))).toBe(true)
    })

    it('lets explicit urn: references pass through', () => {
        const files = validPackage()
        files['core-ir/p.pipeline.json'] = JSON.stringify({
            name: 'P',
            model: { nodes: [{ id: 'a', kind: 'source', sourceRef: 'urn:core:standard:x:datasource:d:n:0000000000' }] },
        })
        expect(checkPackage(files)).toEqual([])
    })

    it('reports a mapping side that is not a bundled structure', () => {
        const files = validPackage()
        files['core-ir/m.mapping.json'] = JSON.stringify({
            mappingUrn: 'urn:core:standard:openurbanapps:mapping:test:m:abcdefghij',
            name: 'M',
            document: { source: 'urn:core:standard:x:datastructure:d:other:0000000000', target: STRUCTURE, fields: {} },
        })
        expect(checkPackage(files).some((e) => e.includes('mapping source'))).toBe(true)
    })
})
