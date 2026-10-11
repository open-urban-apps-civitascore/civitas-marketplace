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

const OWN_OBSERVATIONS = 'urn:core:standard:openurbanapps:datastructure:test:beobachtung:abcdefghij'
const PLATFORM_OBSERVATIONS = 'urn:core:platform:civitas:datastructure:frost:Observations:4sntm03fzg'

/** Rewrites one member document in place. */
function edit(files: Record<string, string>, name: string, change: (document: Record<string, unknown>) => void) {
    const document = JSON.parse(files[`core-ir/${name}`])
    change(document)
    files[`core-ir/${name}`] = JSON.stringify(document)
}

/**
 * validPackage() plus a FROST flow as the Jungbaum package has it: the feed is
 * mapped into a bundled copy of the Observations structure, and the FROST sink
 * names that copy as its element.
 */
function frostPackage(): Record<string, string> {
    const files = validPackage()
    const manifest = JSON.parse(files['core-ir/manifest.json'])
    manifest.members.dataStructures.push({ file: 'beobachtung.datastructure.json' })
    manifest.members.mappings.push({ file: 'f.mapping.json' })
    manifest.members.dataSinks.push({ file: 'frost.datasink.json' })
    manifest.members.pipelines.push({ file: 'f.pipeline.json' })
    files['core-ir/manifest.json'] = JSON.stringify(manifest)
    files['core-ir/beobachtung.datastructure.json'] = JSON.stringify({
        $id: OWN_OBSERVATIONS,
        title: 'Beobachtung',
        $ref: '#/$defs/Observation',
        $defs: {
            Observation: {
                type: 'object',
                properties: { result: { type: 'number' }, parameters: { type: 'object', properties: { quelle: { type: 'string' } } } },
            },
        },
    })
    files['core-ir/f.mapping.json'] = JSON.stringify({
        mappingUrn: 'urn:core:standard:openurbanapps:mapping:test:f:abcdefghij',
        name: 'F',
        document: { source: STRUCTURE, target: OWN_OBSERVATIONS, fields: {} },
    })
    files['core-ir/frost.datasink.json'] = JSON.stringify({
        $schema: 's',
        id: 'urn:core:standard:openurbanapps:datasink:test:frost:abcdefghij',
        title: 'Messwerte',
        connectionType: 'frost',
        port: 'Observations',
        element: OWN_OBSERVATIONS,
    })
    files['core-ir/f.pipeline.json'] = JSON.stringify({
        name: 'F',
        model: {
            nodes: [
                { id: 'a', kind: 'source', sourceRef: 'Feed' },
                { id: 'b', kind: 'mapping', mappingRef: 'F' },
                { id: 'c', kind: 'sink', sinkRef: 'Messwerte' },
            ],
        },
    })
    return files
}

describe('checkPackage', () => {
    it('accepts a package that hangs together', () => {
        expect(checkPackage(validPackage())).toEqual([])
    })

    it('accepts a package with dashboards member', () => {
        const files = validPackage()
        const manifest = JSON.parse(files['core-ir/manifest.json'])
        manifest.members.dashboards = [{ file: 'dashboard.json', tool: 'superset' }]
        files['core-ir/manifest.json'] = JSON.stringify(manifest)
        files['core-ir/dashboard.json'] = JSON.stringify({ tool: 'superset', name: 'Test Dashboard' })
        expect(checkPackage(files)).toEqual([])
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

    describe('$defs members', () => {
        it('accepts a member that only the root refers to', () => {
            expect(checkPackage(frostPackage())).toEqual([])
        })

        it('reports a member that refers to another, as the install\'s limitation', () => {
            const files = frostPackage()
            edit(files, 'beobachtung.datastructure.json', (structure) => {
                structure.$defs = {
                    Observation: { type: 'object', properties: { parameters: { $ref: '#/$defs/Parameters' } } },
                    Parameters: { type: 'object', properties: { quelle: { type: 'string' } } },
                }
            })
            const errors = checkPackage(files)
            expect(errors).toHaveLength(1)
            expect(errors[0]).toContain("$defs member 'Observation' refers to '#/$defs/Parameters'")
            expect(errors[0]).toContain('a limitation of the install')
        })
    })

    describe('platform FROST structures', () => {
        it('accepts a bundled copy of one', () => {
            expect(checkPackage(frostPackage())).toEqual([])
        })

        it('matches the exact URN, not a prefix', () => {
            const files = frostPackage()
            const versioned = `${PLATFORM_OBSERVATIONS}:1.0.0`
            edit(files, 'f.mapping.json', (mapping) => {
                mapping.document = { source: STRUCTURE, target: versioned, fields: {} }
            })
            expect(checkPackage(files)).toContain(`core-ir/f.mapping.json: mapping target '${versioned}' is not a bundled structure $id`)
            expect(checkPackage(files).some((e) => e.includes('platform FROST structure'))).toBe(false)
        })

        it('reports one as a mapping target and as a FROST sink element', () => {
            const files = frostPackage()
            edit(files, 'f.mapping.json', (mapping) => {
                mapping.document = { source: STRUCTURE, target: PLATFORM_OBSERVATIONS, fields: {} }
            })
            edit(files, 'frost.datasink.json', (sink) => {
                sink.element = PLATFORM_OBSERVATIONS
            })
            const errors = checkPackage(files)
            expect(errors).toContain(
                `core-ir/f.mapping.json: mapping target '${PLATFORM_OBSERVATIONS}' is a platform FROST structure; bundle a copy of it`,
            )
            expect(errors).toContain(
                `core-ir/frost.datasink.json: element '${PLATFORM_OBSERVATIONS}' is a platform FROST structure; the portal refuses it, bundle a copy`,
            )
            // One message per reference, not the "not bundled" one on top.
            expect(errors.some((e) => e.includes('is not a bundled structure'))).toBe(false)
        })
    })

    describe('FROST sink port', () => {
        it('accepts each of the three ports', () => {
            for (const port of ['Things', 'Observations', 'ThingTree']) {
                const files = frostPackage()
                edit(files, 'frost.datasink.json', (sink) => {
                    sink.port = port
                })
                expect(checkPackage(files)).toEqual([])
            }
        })

        it('reports a FROST sink without a port, or with one outside the set', () => {
            for (const port of [undefined, 'observations']) {
                const files = frostPackage()
                edit(files, 'frost.datasink.json', (sink) => {
                    sink.port = port
                })
                expect(checkPackage(files)).toEqual([
                    'core-ir/frost.datasink.json: a FROST sink needs a port, one of Things, Observations, ThingTree',
                ])
            }
        })
    })

    describe('FROST sink element', () => {
        it('accepts a FROST sink without an element when no mapping feeds it', () => {
            const files = frostPackage()
            edit(files, 'frost.datasink.json', (sink) => {
                delete sink.element
            })
            edit(files, 'f.pipeline.json', (pipeline) => {
                pipeline.model = {
                    nodes: [
                        { id: 'a', kind: 'source', sourceRef: 'Feed' },
                        { id: 'c', kind: 'sink', sinkRef: 'Messwerte' },
                    ],
                }
            })
            expect(checkPackage(files)).toEqual([])
        })

        it('reports an element that is not a bundled structure', () => {
            const files = frostPackage()
            const other = 'urn:core:standard:x:datastructure:d:other:0000000000'
            edit(files, 'frost.datasink.json', (sink) => {
                sink.element = other
            })
            expect(checkPackage(files)).toContain(`core-ir/frost.datasink.json: element '${other}' is not a bundled structure $id`)
        })
    })

    describe('mapped FROST sink', () => {
        it('accepts a sink that names the last mapping\'s target, found by the mapping\'s URN', () => {
            const files = frostPackage()
            edit(files, 'f.pipeline.json', (pipeline) => {
                pipeline.model = {
                    nodes: [
                        { id: 'a', kind: 'source', sourceRef: 'Feed' },
                        { id: 'b', kind: 'mapping', mappingRef: 'M' },
                        { id: 'b2', kind: 'mapping', mappingRef: 'urn:core:standard:openurbanapps:mapping:test:f:abcdefghij' },
                        { id: 'c', kind: 'sink', sinkRef: 'Messwerte' },
                    ],
                }
            })
            expect(checkPackage(files)).toEqual([])
        })

        it('reports a sink whose element is a bundled structure other than the last mapping\'s target', () => {
            const files = frostPackage()
            edit(files, 'frost.datasink.json', (sink) => {
                sink.element = STRUCTURE
            })
            expect(checkPackage(files)).toEqual([
                `core-ir/f.pipeline.json: FROST sink 'Messwerte' must name the last mapping's target '${OWN_OBSERVATIONS}' ` +
                    'as its element, or the release cannot find the match keys',
            ])
        })
    })
})
