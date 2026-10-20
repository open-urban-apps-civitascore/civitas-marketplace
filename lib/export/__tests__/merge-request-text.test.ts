import { describe, expect, it } from 'vitest'

import { catalogPinOf, proposedByOther, proposerOf, readmeSourceOf, shareSourceLine, shareSourceOf } from '@/lib/export/merge-request-text'

const BODY = (line: string) => ['Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.', '', '## Bäume 1.1.0', '', '---', 'Branch `export/baeume-1.1.0` · exported via the marketplace export', '', line].join('\n')

describe('the source line', () => {
    it('reads back what it writes, at the end of a description, without touching the first line', () => {
        const source = { kind: 'dataset' as const, id: '3f2c-ds', instance: 'https://portal.demo.example' }
        const line = shareSourceLine(source)
        expect(line).toBe('<!-- oua-share {"kind":"dataset","id":"3f2c-ds","instance":"https://portal.demo.example"} -->')
        expect(shareSourceOf(BODY(line))).toEqual(source)
        expect(proposerOf(BODY(line))).toBe('Ewa')
    })

    it('leaves out what is unknown, and reads it back as unknown', () => {
        expect(shareSourceLine({ kind: 'dataset', id: 'ds' })).toBe('<!-- oua-share {"kind":"dataset","id":"ds"} -->')
        expect(shareSourceOf(BODY(shareSourceLine({ kind: 'dataset', instance: 'https://x.example' })))).toEqual({ kind: 'dataset', instance: 'https://x.example' })
    })

    it('cannot be ended early by a value', () => {
        const source = { kind: 'dataset' as const, id: 'a --> <b>', instance: 'https://x.example/?q=<!--' }
        const line = shareSourceLine(source)
        expect(line.match(/-->/g)).toHaveLength(1)
        expect(line).not.toContain('<b>')
        expect(shareSourceOf(BODY(line))).toEqual(source)
    })

    it('finds nothing in a proposal without one, or with a garbled or foreign one', () => {
        expect(shareSourceOf(undefined)).toBeUndefined()
        expect(shareSourceOf(null)).toBeUndefined()
        expect(shareSourceOf(BODY(''))).toBeUndefined()
        expect(shareSourceOf(BODY('<!-- oua-share {"kind":"dataset", -->'))).toBeUndefined()
        expect(shareSourceOf(BODY('<!-- oua-share {"kind":"structure","id":"x"} -->'))).toBeUndefined()
        // Only a line of its own counts, not one quoted inside a sentence.
        expect(shareSourceOf('See <!-- oua-share {"kind":"dataset","id":"x"} --> here')).toBeUndefined()
        expect(shareSourceOf(BODY('<!-- oua-share {"kind":"dataset","id":"  "} -->'))).toEqual({ kind: 'dataset' })
    })
})

describe('readmeSourceOf', () => {
    const readme = (provenance: string) => `# Bäume — CORE-IR Use-Case Package\n\nStadtbäume\n\nExported from a running CIVITAS/CORE instance through the Open Urban Apps\nmarketplace on 2026-10-01 by Ewa\n${provenance}\nVersion 1.1.0 · EUPL-1.2 · maintained by Stadt.\n`

    it('reads the dataset and the instance an older package names', () => {
        expect(readmeSourceOf(readme('(dataset `Bäume (Mitte)`, id `ds-1`, instance https://portal.demo.example).'))).toEqual({
            kind: 'dataset',
            id: 'ds-1',
            instance: 'https://portal.demo.example',
        })
    })

    it('reads only the dataset where the exporting instance had no address set', () => {
        expect(readmeSourceOf(readme('(dataset `Bäume`, id `ds-1`).'))).toEqual({ kind: 'dataset', id: 'ds-1' })
    })

    it('guesses nothing from a README changed beyond recognition, or none at all', () => {
        expect(readmeSourceOf(readme('From dataset Bäume.'))).toBeUndefined()
        expect(readmeSourceOf(undefined)).toBeUndefined()
    })
})

describe('catalogPinOf', () => {
    it('reads the repository and folder a catalogue proposal pins', () => {
        const description = `Proposed by …\n\nAdds \`urn:stadt:usecase:baeume\` in \`useCases\`, pinned to\n\`${'f'.repeat(40)}\` of https://gitlab.example/group/catalog (path \`packages/baeume\`).`
        expect(catalogPinOf(description)).toEqual({ repo: 'https://gitlab.example/group/catalog', path: 'packages/baeume' })
        expect(catalogPinOf('Adds `x` in `useCases`.')).toBeUndefined()
    })
})

describe('proposedByOther', () => {
    it('is true only where both are named and differ, case and spaces aside', () => {
        expect(proposedByOther('Ewa', 'Kim')).toBe(true)
        expect(proposedByOther('Ewa', ' ewa ')).toBe(false)
        expect(proposedByOther(undefined, 'Kim')).toBe(false)
        expect(proposedByOther('Ewa', undefined)).toBe(false)
    })
})
