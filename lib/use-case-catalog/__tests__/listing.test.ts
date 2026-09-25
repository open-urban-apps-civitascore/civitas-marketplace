import { describe, expect, it } from 'vitest'

import type { CatalogSummary } from '@/lib/catalog/types'
import {
    buildUseCaseListing,
    collaborationInvite,
    logicModelSteps,
    factGroups,
} from '@/lib/use-case-catalog/listing'

const SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4'

function summary(overrides: Partial<CatalogSummary> = {}): CatalogSummary {
    return {
        id: 'urn:openurbanapps:usecase:test',
        type: 'usecase',
        displayName: 'Baumbewässerung',
        description: 'Sensoren melden, welche Jungbäume Wasser brauchen.',
        version: '1.0.0',
        maintainer: 'Open Urban Apps',
        license: 'EUPL-1.2',
        keywords: ['sensorik'],
        ...overrides,
    }
}

const PIN = { url: 'https://gitlab.example/repo', ref: SHA, releaseTag: null, path: '.' }
const REFERENCE = { url: 'https://example.org/praxis', source: 'CIVITAS Connect' }

describe('buildUseCaseListing', () => {
    it('calls a pinned row installable and exposes the pin', () => {
        const listing = buildUseCaseListing(summary({ deploymentRef: PIN }))
        expect(listing.state).toBe('installable')
        expect(listing.install).toEqual(PIN)
        expect(listing.reference).toBeUndefined()
    })

    it('calls a row with a reference and no pin described', () => {
        const listing = buildUseCaseListing(
            summary({ implementation: { reference: REFERENCE } }),
        )
        expect(listing.state).toBe('described')
        expect(listing.install).toBeUndefined()
        expect(listing.reference).toEqual(REFERENCE)
    })

    it('calls a row with neither unlisted — the local mock case, not a described entry', () => {
        const listing = buildUseCaseListing(summary())
        expect(listing.state).toBe('unlisted')
        expect(listing.install).toBeUndefined()
        expect(listing.reference).toBeUndefined()
    })

    it('resolves themes to labels and leaves technical tags alone', () => {
        const listing = buildUseCaseListing(
            summary({ themes: ['umwelt-klima', 'katastrophenschutz-sicherheit'], keywords: ['frost'] }),
        )
        expect(listing.themes).toEqual(['Umwelt & Klima', 'Katastrophenschutz & Sicherheit'])
        expect(listing.keywords).toEqual(['frost'])
    })

    it('does not credit the curator as publisher of a described entry', () => {
        expect(buildUseCaseListing(summary({ deploymentRef: PIN })).publisherRole).toBe(
            'Herausgeber',
        )
        expect(
            buildUseCaseListing(summary({ implementation: { reference: REFERENCE } })).publisherRole,
        ).toBe('Katalogeintrag gepflegt von')
    })

    it('reports no curation rather than inventing a tier', () => {
        expect(buildUseCaseListing(summary()).curation).toBeUndefined()
    })
})

describe('factGroups', () => {
    it('omits every group a row has nothing for', () => {
        expect(factGroups(summary())).toEqual([])
    })

    it('groups status, people and costs, and abbreviates the bands', () => {
        const groups = factGroups(
            summary({
                implementation: {
                    status: 'produktiv',
                    operator: 'Stadt Haßfurt',
                    parties: { serviceProviders: ['Stadtwerke (Betrieb)'] },
                    resources: { setupCost: 's', effort: 'm', funding: 'Smart City' },
                },
            }),
        )
        expect(groups.map((group) => group.key)).toEqual([
            'classification',
            'people',
            'costs',
        ])
        expect(groups[0].facts[0]).toMatchObject({
            label: 'Use Case Status',
            values: ['Produktiv'],
        })
        expect(groups[0].facts[0].hint).toBeTruthy()
        expect(groups[2].facts.map((fact) => [fact.badge, fact.values[0]])).toEqual([
            ['S', 'unter 1.000 €'],
            ['M', 'unter 50 Tage'],
            [undefined, 'Smart City'],
        ])
    })

    it('shows the note even when no effort band was given', () => {
        const groups = factGroups(
            summary({ implementation: { resources: { totalCost: 'm', note: 'Ohne Personalkosten.' } } }),
        )
        expect(groups[0].facts.map((fact) => fact.label)).toEqual([
            'Geschätzte Gesamtkosten (36 Monate)',
            'Anmerkung zu Ressourceneinsatz',
        ])
    })

    it('drops a group whose only fields are empty lists', () => {
        const groups = factGroups(
            summary({ implementation: { parties: { stakeholders: [] } } }),
        )
        expect(groups).toEqual([])
    })
})

describe('logicModelSteps', () => {
    it('returns the filled steps in reading order, not in key order', () => {
        const steps = logicModelSteps(
            summary({
                implementation: {
                    logicModel: {
                        input: 'Sensoren und Personal',
                        output: 'Eine Karte',
                        impact: 'Weniger Ausfälle',
                        outcome: 'Der Bauhof fährt gezielt',
                    },
                },
            }),
        )
        expect(steps.map((step) => step.label)).toEqual(['Input', 'Output', 'Outcome', 'Impact'])
        expect(steps[2].text).toBe('Der Bauhof fährt gezielt')
        expect(steps[0].gloss).toBe('Was hineingeht')
    })

    it('skips the steps nobody filled in', () => {
        const steps = logicModelSteps(
            summary({ implementation: { logicModel: { input: 'Sensoren' } } }),
        )
        expect(steps.map((step) => step.label)).toEqual(['Input'])
    })

    it('is empty when there is no logic model at all', () => {
        expect(logicModelSteps(summary())).toEqual([])
    })
})

describe('collaborationInvite', () => {
    it('is present only when partners are actually wanted', () => {
        expect(
            collaborationInvite(summary({ implementation: { collaboration: { wanted: true, seeking: 'Kommunen' } } })),
        ).toEqual({ seeking: 'Kommunen' })
        expect(
            collaborationInvite(summary({ implementation: { collaboration: { wanted: false } } })),
        ).toBeUndefined()
        expect(collaborationInvite(summary())).toBeUndefined()
    })
})
