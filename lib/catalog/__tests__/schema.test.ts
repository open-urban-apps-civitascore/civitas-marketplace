import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { renderIndexJsonSchema } from '@/lib/catalog/json-schema'
import { parseRepoListIndex } from '@/lib/catalog/repo-list'
import {
    catalogSummarySchema,
    contactSchema,
    mediaSchema,
    resourcesSchema,
} from '@/lib/catalog/schema'

const SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4'

const IDENTITY = {
    id: 'urn:openurbanapps:usecase:test',
    type: 'usecase',
    displayName: 'Test',
    description: 'Test',
    version: '1.0.0',
    maintainer: 'Open Urban Apps',
    license: 'EUPL-1.2',
    keywords: ['frost'],
}

function index(row: Record<string, unknown>) {
    return {
        version: '3.3.0',
        updatedAt: '2026-09-23T00:00:00Z',
        addons: [],
        useCases: [{ ...IDENTITY, ...row }],
        dataStructures: [],
    }
}

const PINNED = { deploymentRef: { url: 'https://gitlab.example/repo', ref: SHA } }
const DESCRIBED = { implementation: { reference: { url: 'https://example.org/x' } } }

describe('generated JSON Schema', () => {
    // The catalogue repository's CI validates merge requests against the
    // committed copy of this file. If it drifts from the Zod definition, the
    // catalogue starts accepting rows the marketplace will refuse to parse —
    // silently, because a rejected index falls back to last-known-good.
    it('matches the committed data/index.schema.json', () => {
        const committed = readFileSync(
            path.resolve(import.meta.dirname, '../../../data/index.schema.json'),
            'utf8',
        )
        expect(committed).toBe(renderIndexJsonSchema())
    })
})

describe('controlled vocabularies', () => {
    it('carries themes, curation, contact and media through the parser', () => {
        const row = {
            ...PINNED,
            themes: ['umwelt-klima', 'mobilitaet-verkehr'],
            curation: { tier: 'community', reviewedBy: 'OUA', reviewedAt: '2026-09-01' },
            contact: { name: 'Klimaschutzstelle', email: 'klima@example.de' },
            media: [{ src: 'screenshots/dashboard.png', alt: 'Dashboard mit Messwerten' }],
        }
        const parsed = parseRepoListIndex(index(row))
        expect(parsed.useCases[0]).toMatchObject(row)
    })

    it('refuses the prose cost bands the live catalogue drifted into', () => {
        // "M, unter 10.000 Euro" is what nine hand-curated entries actually
        // held. It is a band written as a sentence — unfilterable, and one
        // typo from being a second band.
        expect(resourcesSchema.safeParse({ setupCost: 'M, unter 10.000 Euro' }).success).toBe(false)
        expect(resourcesSchema.safeParse({ setupCost: 'm', effort: 'm' }).success).toBe(true)
    })

    it('refuses a theme outside the vocabulary', () => {
        expect(() => parseRepoListIndex(index({ ...PINNED, themes: ['umwelt'] }))).toThrow(
            /themes/,
        )
    })

    it('refuses a described row that also carries a pin', () => {
        // The parser branches on the pin, so a row with both is parsed as
        // pinned and rejected when that pin is not a commit. The generated
        // contract has to agree, or CI passes a row the runtime then refuses —
        // taking the whole index down to last-known-good, silently.
        const both = {
            ...IDENTITY,
            implementation: { reference: { url: 'https://example.org/x' } },
            deploymentRef: { url: 'https://gitlab.example/repo', ref: 'v2.0.0' },
        }
        expect(catalogSummarySchema.safeParse(both).success).toBe(false)
        expect(() => parseRepoListIndex(index(both))).toThrow()
    })

    it('keeps a 36-month total apart from the setup/running split', () => {
        // CIVITAS Connect asks one question — Geschätzte Gesamtkosten over 36
        // months — and that figure already contains the running cost. Folding
        // it into setupCost would sell three years of ownership as a one-off.
        expect(resourcesSchema.safeParse({ totalCost: 'm' }).success).toBe(true)
        const parsed = resourcesSchema.parse({ totalCost: 'm', setupCost: 's', runningCost: 's' })
        expect(parsed).toEqual({ totalCost: 'm', setupCost: 's', runningCost: 's' })
    })

    it('refuses a curation tier outside the vocabulary', () => {
        expect(() =>
            parseRepoListIndex(
                index({
                    ...PINNED,
                    curation: { tier: 'gold', reviewedBy: 'OUA', reviewedAt: '2026-09-01' },
                }),
            ),
        ).toThrow(/curation\.tier/)
    })
})

describe('contact', () => {
    it('needs a channel somebody can actually use', () => {
        expect(contactSchema.safeParse({ name: 'Jemand' }).success).toBe(false)
        expect(contactSchema.safeParse({ email: 'a@b.de' }).success).toBe(true)
        expect(contactSchema.safeParse({ url: 'https://example.de/kontakt' }).success).toBe(true)
    })

    it('refuses an http contact url', () => {
        expect(contactSchema.safeParse({ url: 'http://example.de' }).success).toBe(false)
    })
})

describe('media', () => {
    it('requires alternative text', () => {
        expect(mediaSchema.safeParse({ src: 'a/b.png' }).success).toBe(false)
        expect(mediaSchema.safeParse({ src: 'a/b.png', alt: '' }).success).toBe(false)
        expect(mediaSchema.safeParse({ src: 'a/b.png', alt: 'Kartenansicht' }).success).toBe(true)
    })

    it('accepts an https URL for an entry that has no repository', () => {
        expect(mediaSchema.safeParse({ src: 'https://example.de/a.png', alt: 'x' }).success).toBe(
            true,
        )
        expect(mediaSchema.safeParse({ src: 'http://example.de/a.png', alt: 'x' }).success).toBe(
            false,
        )
    })

    it('refuses a relative path that could traverse out of the pinned commit', () => {
        // Same attack as the package path: a relative `src` is resolved against
        // the raw URL at the pin, and `..` would walk off it onto a mutable ref.
        expect(mediaSchema.safeParse({ src: '../../etc/passwd', alt: 'x' }).success).toBe(false)
    })
})

describe('described entries', () => {
    it('stays listable without a pin and keeps its describing blocks', () => {
        const parsed = parseRepoListIndex(
            index({
                ...DESCRIBED,
                themes: ['umwelt-klima'],
                implementation: {
                    ...DESCRIBED.implementation,
                    status: 'produktiv',
                    operator: 'Stadt Haßfurt',
                    resources: { setupCost: 's', effort: 'm', funding: 'Smart City' },
                },
            }),
        )
        const row = parsed.useCases[0]
        expect(row.deploymentRef).toBeUndefined()
        expect(row.implementation?.status).toBe('produktiv')
        expect(row.implementation?.resources?.setupCost).toBe('s')
        expect(row.themes).toEqual(['umwelt-klima'])
    })

    it('still refuses a row that merely forgot its pin', () => {
        expect(() => parseRepoListIndex(index({}))).toThrow(/deploymentRef/)
    })
})
