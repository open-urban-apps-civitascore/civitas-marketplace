import { describe, expect, it } from 'vitest'

import { applyTextEdit } from '@/lib/export/catalog-entry'
import { draftMetadata, metadataDraft, parseExportMetadata, parseKeywords } from '@/lib/export/metadata'
import { textChanges, textDraftOf, textEditHref } from '@/lib/export/text-edit'

const start = {
    displayName: 'Bäume',
    description: 'Stadtbäume',
    keywords: 'baum, kataster',
    metadata: {
        themes: ['umwelt-klima' as const],
        contact: { email: 'amt@stadt.example' },
        implementation: { status: 'produktiv' as const, parties: { stakeholders: ['Grünflächenamt'] } },
    },
}

describe('textChanges', () => {
    const labels = (after: Parameters<typeof textChanges>[1]) => textChanges(textDraftOf(start), after).map((change) => change.label)

    it('finds nothing in an untouched form', () => {
        expect(textChanges(textDraftOf(start), textDraftOf(start))).toEqual([])
    })

    it('tells what changed, before and after, in the words of the form', () => {
        const after = textDraftOf({ ...start, description: ' Neu ', metadata: { ...start.metadata, implementation: { ...start.metadata.implementation, status: undefined } } })
        expect(textChanges(textDraftOf(start), after)).toEqual([
            { key: 'description', label: 'Kurzbeschreibung', before: 'Stadtbäume', after: 'Neu' },
            { key: 'implementation.status', label: 'Stand der Umsetzung', before: 'Produktiv', after: '' },
        ])
    })

    it('marks a change of contact by its key', () => {
        const after = textDraftOf({ ...start, metadata: { ...start.metadata, contact: { email: 'neu@stadt.example' } } })
        expect(textChanges(textDraftOf(start), after).map((change) => change.key)).toEqual(['contact.email'])
    })

    it('does not count order, spaces or capitals where a reader sees no difference', () => {
        const draft = textDraftOf(start)
        expect(labels({ ...draft, keywords: ' Baum,kataster ' })).toEqual([])
        const both = textDraftOf({ ...start, metadata: { ...start.metadata, themes: ['umwelt-klima', 'mobilitaet-verkehr'] } })
        const turned = { ...both, metadata: { ...both.metadata, themes: ['mobilitaet-verkehr', 'umwelt-klima'] } }
        expect(textChanges(both, turned)).toEqual([])
    })
})

describe('the form and the catalogue row', () => {
    it('leaves a full row untouched when saved as filled in, so opening the form changes nothing', () => {
        const row = {
            id: 'urn:stadt:usecase:baeume', type: 'usecase', version: '1.0.0', maintainer: 'Stadt', license: 'EUPL-1.2',
            displayName: 'Bäume', description: 'Stadtbäume', keywords: ['baum', 'kataster'],
            themes: ['umwelt-klima'],
            contact: { name: 'Amt', role: 'Team', email: 'amt@stadt.example', url: 'https://stadt.example/kontakt' },
            media: [{ src: 'https://stadt.example/a.png', alt: 'Karte', caption: 'Die Karte' }],
            implementation: {
                status: 'produktiv',
                operator: 'Stadt',
                parties: { stakeholders: ['Amt'], serviceProviders: ['Firma'] },
                stack: ['FROST'],
                resources: { totalCost: 'm', setupCost: 's', runningCost: 's', effort: 'm', funding: 'Land', note: 'Notiz' },
                logicModel: { input: 'a', output: 'b', impact: 'c', outcome: 'd' },
                collaboration: { wanted: false, seeking: 'Partner' },
                reference: { url: 'https://stadt.example/projekt', source: 'Projektseite' },
            },
            curation: { tier: 'community', reviewedBy: 'Team', reviewedAt: '2026-10-01' },
            deploymentRef: { url: 'https://gitlab.example/x', ref: 'a'.repeat(40), releaseTag: null, path: 'baeume' },
        }
        const index = JSON.stringify({ version: '1.0.0', updatedAt: '2026-10-01T00:00:00Z', useCases: [row] })
        const parsed = parseExportMetadata(JSON.stringify({ themes: row.themes, contact: row.contact, media: row.media, implementation: row.implementation }))
        if (!parsed.data) throw new Error(parsed.error)
        const roundTrip = parseExportMetadata(JSON.stringify(draftMetadata(metadataDraft(parsed.data))))
        if (!roundTrip.data) throw new Error(roundTrip.error)
        const edit = applyTextEdit(index, row.id, row.version, { displayName: row.displayName, description: row.description, keywords: parseKeywords(row.keywords.join(', ')), metadata: roundTrip.data })
        expect(edit).toEqual({ status: 'unchanged' })
    })
})

describe('textEditHref', () => {
    it('carries what the page needs, safely spelled', () => {
        expect(textEditHref({ targetKey: 'https://gitlab.example/a b', slug: 'baeume', version: '1.0.0' }))
            .toBe('/export/edit?target=https%3A%2F%2Fgitlab.example%2Fa+b&slug=baeume&version=1.0.0')
    })
})
