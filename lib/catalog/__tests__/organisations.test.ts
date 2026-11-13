import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { OrganisationView } from '@/components/catalog/organisation-view'
import { UseCaseInfobox } from '@/components/catalog/use-case-infobox'
import type { ParsedAddon } from '@/lib/addon-catalog/listing'
import { entriesOf, leadOrganisationHref, monogram } from '@/lib/catalog/organisations'
import type { CatalogSummary, Organisation } from '@/lib/catalog/types'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const MUSTERHAUSEN: Organisation = { id: 'musterhausen', name: 'Stadt Musterhausen', website: 'https://www.musterhausen.example/rathaus' }
const OPEN_URBAN_APPS: Organisation = { id: 'openurbanapps', name: 'Open Urban Apps' }
const ORGANISATIONS = [MUSTERHAUSEN, OPEN_URBAN_APPS]

const entry = (slug: string, extra: Partial<CatalogSummary> = {}): CatalogSummary => ({
    id: `urn:openurbanapps:usecase:${slug}`,
    type: 'usecase',
    displayName: slug,
    description: `${slug} in einem Satz.`,
    version: '1.0.0',
    maintainer: 'Open Urban Apps',
    maintainerOrg: 'openurbanapps',
    license: 'EUPL-1.2',
    keywords: [],
    ...extra,
})

const LED = entry('verkehrszaehlung', { implementation: { operator: 'Stadt Musterhausen – Stabsstelle Mobilität', operatorOrg: 'musterhausen' } })
const PUBLISHED = entry('jungbaum')
const ADDON = { listing: { id: 'grafana', displayName: 'Grafana', summary: 'Dashboards.', categories: [], publisher: 'Civitas Connect e. V.', publisherOrg: 'civitasconnect', links: {}, compatibleCoreVersions: [], platformNeeds: [] }, missingForInstall: [] } as unknown as ParsedAddon

describe('an organisation’s entries', () => {
    it('lists each use case once, under its stronger role, and the add-ons it publishes', () => {
        expect(entriesOf('musterhausen', [LED, PUBLISHED], [ADDON])).toEqual({ led: [LED], published: [], addons: [] })
        expect(entriesOf('openurbanapps', [LED, PUBLISHED], [ADDON])).toEqual({ led: [], published: [LED, PUBLISHED], addons: [] })
        expect(entriesOf('civitasconnect', [LED, PUBLISHED], [ADDON]).addons).toEqual([ADDON])
        // Both leading and publishing: once, as leading.
        const own = entry('eigen', { maintainer: 'Stadt Musterhausen', maintainerOrg: 'musterhausen', implementation: { operator: 'Stadt Musterhausen', operatorOrg: 'musterhausen' } })
        expect(entriesOf('musterhausen', [own], [])).toEqual({ led: [own], published: [], addons: [] })
    })

    it('makes initials that tell organisations apart', () => {
        expect(['Stadt Musterhausen', 'Open Urban Apps', 'Civitas Connect e. V.', 'Gemeinde Musterbach'].map(monogram)).toEqual(['MU', 'OU', 'CC', 'MU'])
    })
})

describe('the lead organisation’s button in „Auf einen Blick“', () => {
    it('leads to the organisation the field names, and only to one the catalogue lists', () => {
        expect(leadOrganisationHref(LED, ORGANISATIONS)).toBe('/organisationen/musterhausen')
        // No operator: the field shows the publisher.
        expect(leadOrganisationHref(PUBLISHED, ORGANISATIONS)).toBe('/organisationen/openurbanapps')
        // An operator without a code is never the publisher's page.
        expect(leadOrganisationHref(entry('x', { implementation: { operator: 'Stadtwerke Irgendwo' } }), ORGANISATIONS)).toBeUndefined()
        expect(leadOrganisationHref(LED, [OPEN_URBAN_APPS])).toBeUndefined()
    })

    it('is a button with the name, and plain text without a page', () => {
        const linked = renderToStaticMarkup(createElement(UseCaseInfobox, { entry: LED, leadHref: '/organisationen/musterhausen' }))
        expect(linked).toMatch(/<a [^>]*href="\/organisationen\/musterhausen"[^>]*>Stadt Musterhausen – Stabsstelle Mobilität/)
        const plain = renderToStaticMarkup(createElement(UseCaseInfobox, { entry: LED }))
        expect(plain).not.toContain('/organisationen/')
        expect(text(plain)).toContain('Stadt Musterhausen – Stabsstelle Mobilität')
    })
})

describe('the organisation page', () => {
    const view = (organisation: Organisation, code: string) =>
        renderToStaticMarkup(createElement(OrganisationView, { organisation, entries: entriesOf(code, [LED, PUBLISHED], [ADDON]), installed: new Set<string>() }))

    it('shows the website, the contact or that there is none, and the use cases it leads', () => {
        const said = text(view(MUSTERHAUSEN, 'musterhausen'))
        expect(said).toContain('MU Stadt Musterhausen www.musterhausen.example Keine zentrale Kontaktstelle hinterlegt')
        expect(said).toContain('Anwendungsfälle (1) verkehrszaehlung')
        expect(said).not.toContain('Federführend')
        const withContact = text(view({ ...OPEN_URBAN_APPS, contact: { name: 'Team Marktplatz', email: 'team@openurbanapps.example' } }, 'openurbanapps'))
        expect(withContact).toContain('Team Marktplatz: team@openurbanapps.example')
    })

    it('names each role when it has more than one, and leaves its own name off its cards', () => {
        const html = renderToStaticMarkup(
            createElement(OrganisationView, {
                organisation: OPEN_URBAN_APPS,
                entries: { led: [entry('kiez', { implementation: { operator: 'Open Urban Apps', operatorOrg: 'openurbanapps' } })], published: [PUBLISHED], addons: [] },
                installed: new Set<string>(),
            }),
        )
        expect(text(html)).toContain('Federführend (1)')
        expect(text(html)).toContain('Herausgegeben (1)')
        expect(text(html)).not.toMatch(/Open Urban Apps[\s\S]*Open Urban Apps/)
    })

    it('says so when it has nothing in the catalogue yet', () => {
        expect(text(view({ id: 'leer', name: 'Gemeinde Leer' }, 'leer'))).toContain('Noch keine Anwendungsfälle im Katalog.')
    })
})
