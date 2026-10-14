import { describe, expect, it } from 'vitest'

import type { CatalogSummary } from '@/lib/catalog/types'
import { buildUseCaseListing } from '@/lib/use-case-catalog/listing'

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
