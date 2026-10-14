import { describe, expect, it } from 'vitest'

import { applyCatalogFilters, facetOptions, isUsefulFacet, type FacetDef } from '@/lib/catalog/facets'
import { buildSearchIndex, matchesQuery } from '@/lib/catalog/search'
import type { CatalogSummary } from '@/lib/catalog/types'
import { NO_SEAL, USE_CASE_FACETS, useCaseSearchText } from '@/lib/use-case-catalog/facets'

const PIN = { url: 'https://gitlab.com/x/y', ref: 'a'.repeat(40), releaseTag: 'v1.0.0', path: '.' }

function row(id: string, extra: Partial<CatalogSummary> = {}): CatalogSummary {
    return {
        id: `urn:stadt:usecase:${id}`,
        type: 'usecase',
        displayName: id,
        description: `Beschreibung ${id}`,
        version: '1.0.0',
        maintainer: 'Stadt Musterbach',
        license: 'EUPL-1.2',
        keywords: [],
        ...extra,
    }
}

const ROWS: CatalogSummary[] = [
    row('jungbaum', {
        deploymentRef: PIN,
        themes: ['umwelt-klima'],
        curation: { tier: 'experimental', reviewedBy: 'Kuratierung', reviewedAt: '2026-10-01' },
        implementation: { status: 'prototyp', resources: { setupCost: 's' }, collaboration: { wanted: true, seeking: 'Kommunen mit Sensoren' } },
    }),
    row('pegelkarte', {
        maintainer: 'Stadt Haßfurt',
        themes: ['katastrophenschutz-sicherheit', 'umwelt-klima'],
        implementation: { status: 'produktiv', operator: 'Stadtwerke Haßfurt', resources: { setupCost: 'l' }, reference: { url: 'https://example.org/pegel', source: 'CIVITAS Connect' } },
    }),
    row('verkehr', { deploymentRef: PIN, themes: ['mobilitaet-verkehr'] }),
]

const facet = (id: string): FacetDef<CatalogSummary> => USE_CASE_FACETS.find((def) => def.id === id)!
const INDEX = buildSearchIndex(ROWS, (entry) => entry.id, useCaseSearchText)
const run = (search: string, facets: Record<string, string[]> = {}) =>
    applyCatalogFilters({ entries: ROWS, facets: USE_CASE_FACETS, state: { search, facets }, index: INDEX, keyOf: (entry) => entry.id }).map(
        (entry) => entry.displayName,
    )

describe('use-case facets', () => {
    it('filters by theme, OR within the facet, in the vocabulary order', () => {
        expect(run('', { kategorie: ['umwelt-klima'] })).toEqual(['jungbaum', 'pegelkarte'])
        expect(run('', { kategorie: ['mobilitaet-verkehr', 'katastrophenschutz-sicherheit'] })).toEqual(['pegelkarte', 'verkehr'])
        expect(facetOptions(facet('kategorie'), ROWS)).toEqual(['umwelt-klima', 'mobilitaet-verkehr', 'katastrophenschutz-sicherheit'])
        expect(facet('kategorie').labelOf!('umwelt-klima')).toBe('Umwelt & Klima')
    })

    it('counts a row without a seal as "Noch ohne Siegel" instead of dropping it', () => {
        expect(run('', { siegel: [NO_SEAL] })).toEqual(['pegelkarte', 'verkehr'])
        expect(facet('siegel').labelOf!(NO_SEAL)).toBe('Noch ohne Siegel')
        expect(facet('siegel').labelOf!('experimental')).toBe('Experimentell')
    })

    it('offers the whole status scale, Idee and In Konzeption included', () => {
        expect(facetOptions(facet('status'), ROWS)).toEqual(['idee', 'entwurf', 'in-entwicklung', 'prototyp', 'produktiv', 'review', 'archiviert'])
        expect(facet('status').labelOf!('entwurf')).toBe('In Konzeption')
    })

    it('reads a cost band as a ceiling', () => {
        expect(run('', { aufbaukosten: ['m'] })).toEqual(['jungbaum'])
        expect(run('', { aufbaukosten: ['l'] })).toEqual(['jungbaum', 'pegelkarte'])
    })

    it('tells installable rows from described ones by the pin', () => {
        expect(run('', { installation: ['beschrieben'] })).toEqual(['pegelkarte'])
        expect(run('', { installation: ['portal'] })).toEqual(['jungbaum', 'verkehr'])
    })

    it('puts every row in one of the two collaboration answers', () => {
        expect(run('', { kooperation: ['gesucht'] })).toEqual(['jungbaum'])
        expect(run('', { kooperation: ['nicht-gesucht'] })).toEqual(['pegelkarte', 'verkehr'])
        expect(facet('kooperation').labelOf!('gesucht')).toBe('Suche Mitstreiter')
    })

    it('hides a facet that cannot narrow the list', () => {
        // No row sets an effort band, so the facet has nothing to offer.
        expect(isUsefulFacet(facet('aufwand'), ROWS)).toBe(false)
        expect(isUsefulFacet(facet('herausgeber'), ROWS)).toBe(true)
    })
})

describe('useCaseSearchText', () => {
    it('finds a row by its operator, umlauts folded, and by its theme label', () => {
        expect(run('stadtwerke hassfurt')).toEqual(['pegelkarte'])
        expect(run('Mobilität')).toEqual(['verkehr'])
        // What a row seeks, but not the worded answer: "Keine Mitstreiter explizit gesucht" would match every row.
        expect(run('kommunen sensoren')).toEqual(['jungbaum'])
        expect(run('mitstreiter')).toEqual([])
    })

    it('leaves URLs and the pin out', () => {
        const text = useCaseSearchText(ROWS[0]!).toLowerCase()
        expect(text).not.toContain('https')
        expect(text).not.toContain('a'.repeat(40))
        expect(matchesQuery(INDEX.get(ROWS[1]!.id)!, 'example.org')).toBe(false)
    })
})
