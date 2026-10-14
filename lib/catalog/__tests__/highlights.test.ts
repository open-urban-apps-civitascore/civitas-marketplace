import { describe, expect, it } from 'vitest'

import { catalogPreview, newestFirst } from '@/lib/catalog/highlights'

const row = (id: string) => ({ id, title: id, summary: '', meta: '', href: `/x/${id}` })

describe('catalog highlights', () => {
    it('previews the end of a section, where shared entries are appended, last first', () => {
        expect(newestFirst(['a', 'b', 'c', 'd', 'e'])).toEqual(['e', 'd', 'c'])
        expect(newestFirst(['a'])).toEqual(['a'])
        expect(newestFirst([])).toEqual([])
    })

    it('counts the whole section, not only the preview', () => {
        const preview = catalogPreview('use-case', 'Anwendungsfälle', '/use-cases', ['a', 'b', 'c', 'd'].map(row))
        expect(preview.total).toBe(4)
        expect(preview.entries.map((entry) => entry.id)).toEqual(['d', 'c', 'b'])
    })
})
