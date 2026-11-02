import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/catalog/assemble', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/lib/catalog/assemble')>(),
    simulationProblem: vi.fn(() => "Demo-Daten für 'Feed': field 'wert' is not a property of the message class"),
}))
import { draftSimulation } from '@/lib/export/simulation-draft'

describe('a draft the catalogue would refuse', () => {
    it('becomes a note, so nothing half-right goes into a package', () => {
        const draft = draftSimulation({ title: 'Feed', transport: 'mqtt', subscription: 'stadt/+', model: { type: 'object', properties: { wert: { type: 'number' } } } })
        expect(draft).toEqual({ note: 'die erzeugten Werte passen nicht zur Datenstruktur' })
    })
})
