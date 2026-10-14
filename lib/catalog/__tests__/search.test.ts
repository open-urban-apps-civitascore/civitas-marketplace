import { assert, describe, test } from 'vitest'

import { buildSearchIndex, foldGerman, matchesQuery } from '@/lib/catalog/search'

describe('foldGerman', () => {
    test('folds umlauts so all three spellings find the same row', () => {
        const folded = foldGerman('Grünflächen')
        assert.strictEqual(folded, 'gruenflaechen')
        assert.ok(matchesQuery(folded, 'grunflachen') === false)
        assert.ok(matchesQuery(folded, 'Gruenflaechen'))
        assert.ok(matchesQuery(folded, 'GRÜNFLÄCHEN'))
    })

    test('folds ß', () => {
        assert.strictEqual(foldGerman('Straßenzustand'), 'strassenzustand')
    })
})

describe('matchesQuery', () => {
    const hay = foldGerman('Verkehrszählung Musterhausen — Radverkehr am Bahnhof')

    test('every token must be present, in any order', () => {
        assert.ok(matchesQuery(hay, 'verkehr musterhausen'))
        assert.ok(matchesQuery(hay, 'musterhausen verkehr'))
        assert.ok(!matchesQuery(hay, 'musterhausen feinstaub'))
    })

    test('an empty query matches everything', () => {
        assert.ok(matchesQuery(hay, ''))
        assert.ok(matchesQuery(hay, '   '))
    })
})

describe('buildSearchIndex', () => {
    const entries = [
        { id: 'a', title: 'Baumkataster', body: 'Grünflächen' },
        { id: 'b', title: 'Verkehrszählung', body: 'Mobilität' },
    ]
    const index = buildSearchIndex(
        entries,
        (e) => e.id,
        (e) => `${e.title} ${e.body}`,
    )

    test('indexes each entry under its key, folded', () => {
        assert.strictEqual(index.get('a'), 'baumkataster gruenflaechen')
        assert.strictEqual(index.size, 2)
    })

    test('a URL-ish query does not match an entry that merely contains URLs', () => {
        // The whole reason the haystack is enumerated rather than stringified: a
        // query of "https" must not match every row in the catalog.
        const urlFree = buildSearchIndex(
            [{ id: 'c', title: 'Feinstaub', body: 'Luftqualität' }],
            (e) => e.id,
            (e) => `${e.title} ${e.body}`,
        )
        assert.ok(!matchesQuery(urlFree.get('c') ?? '', 'https'))
    })
})
