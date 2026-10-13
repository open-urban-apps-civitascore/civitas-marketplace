import { describe, expect, it } from 'vitest'

import { ARTIFACT_KINDS, byKind, inFlowOrder, partsCount } from '@/lib/ui/artifact-kinds'

describe('artifact kinds', () => {
    it('orders the platform artifacts the way the data passes them', () => {
        const rows = [
            { type: 'sink' as const, name: 'Tabelle' },
            { type: 'structure' as const, name: 'Messung' },
            { type: 'pipeline' as const, name: 'Import' },
            { type: 'source' as const, name: 'Feed' },
            { type: 'mapping' as const, name: 'Messung zu Wert' },
            { type: 'structure' as const, name: 'Wert' },
        ]
        expect(inFlowOrder(rows).map((row) => row.name)).toEqual(['Feed', 'Messung zu Wert', 'Messung', 'Wert', 'Import', 'Tabelle'])
    })

    it('groups them by kind, in flow order, keeping the order within a kind', () => {
        const rows = [
            { type: 'structure' as const, name: 'Messung' },
            { type: 'source' as const, name: 'Feed' },
            { type: 'structure' as const, name: 'Wert' },
        ]
        expect(byKind(rows).map(({ type, items }) => [type, items.map((row) => row.name)])).toEqual([
            ['source', ['Feed']],
            ['structure', ['Messung', 'Wert']],
        ])
        expect(byKind([])).toEqual([])
    })

    it('names every kind in German, once and many times', () => {
        expect(ARTIFACT_KINDS.source.one).toBe('Datenquelle')
        expect(ARTIFACT_KINDS.sink.many).toBe('Datensenken')
    })

    it('counts the parts', () => {
        expect(partsCount(1)).toBe('1 Baustein')
        expect(partsCount(6)).toBe('6 Bausteine')
    })
})
