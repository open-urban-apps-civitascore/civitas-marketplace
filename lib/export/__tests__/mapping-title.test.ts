import { describe, expect, it } from 'vitest'

import { isUnnamedMapping, mappingTitle } from '@/lib/export/transform'

const urn = 'urn:core:platform:civitas:mapping:common:source-to-target:xbnighpi9t:1.0.0'

describe('mappingTitle', () => {
    it('names a mapping by its title, never by its URN', () => {
        const mapping = { urn, document: { title: 'Messung zu Feuchtewert' } }
        expect(mappingTitle(mapping, 0)).toBe('Messung zu Feuchtewert')
        expect(isUnnamedMapping(mapping)).toBe(false)
    })

    it('falls back to its position, as the package does, and says so', () => {
        const mapping = { urn, document: { title: '  ' } }
        expect(mappingTitle(mapping, 1)).toBe('Mapping 2')
        expect(isUnnamedMapping(mapping)).toBe(true)
    })
})
