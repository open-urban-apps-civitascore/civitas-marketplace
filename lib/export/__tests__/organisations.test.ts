import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LeadOrganisationField, OrganisationField, type OrganisationOptions } from '@/components/export/organisation-field'
import type { Organisation } from '@/lib/catalog/types'
import { applyCatalogEntry, buildCatalogEntry, catalogInputFromManifest } from '@/lib/export/catalog-entry'
import { restoredBasics, type SteckbriefBasics } from '@/lib/export/new-version'
import {
    checkOrganisations,
    composeLead,
    departmentOf,
    isFollowing,
    leadAfterPick,
    organisationProblem,
    parseOrganisationProposals,
    shownDepartment,
    similarOrganisation,
    suggestedCode,
    withLeadDefault,
} from '@/lib/export/organisations'
import { parseDraft } from '@/lib/export/share-drafts'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const MUSTERHAUSEN: Organisation = { id: 'musterhausen', name: 'Stadt Musterhausen', website: 'https://musterhausen.example' }
const OPEN_URBAN_APPS: Organisation = { id: 'openurbanapps', name: 'Open Urban Apps' }
const LISTED = [MUSTERHAUSEN, OPEN_URBAN_APPS]
const LEIPZIG: Organisation = { id: 'leipzig', name: 'Stadt Leipzig', website: 'https://leipzig.example', contact: { email: 'digital@leipzig.example' } }

describe('organisations a share proposes', () => {
    it('reads them from the form, and says in plain words what is wrong', () => {
        expect(parseOrganisationProposals('')).toEqual([])
        expect(parseOrganisationProposals(JSON.stringify([LEIPZIG]))).toEqual([LEIPZIG])
        expect(parseOrganisationProposals(JSON.stringify([{ ...LEIPZIG, contact: { email: 'kein-at' } }]))).toBe('Neue Organisation: die Team-E-Mail ist ungültig.')
        expect(parseOrganisationProposals(JSON.stringify([{ ...LEIPZIG, website: 'http://leipzig.example' }]))).toBe('Neue Organisation: die Website braucht eine https-Adresse.')
        expect(parseOrganisationProposals(JSON.stringify([{ ...LEIPZIG, id: 'Stadt Leipzig' }]))).toBe('Neue Organisation: das Kürzel braucht 2 bis 40 Kleinbuchstaben oder Ziffern.')
        expect(parseOrganisationProposals('{kaputt')).toMatch(/^Neue Organisation: die Angaben sind ungültig/)
        // Only a missing name is called one.
        expect(parseOrganisationProposals(JSON.stringify([LEIPZIG, LEIPZIG, LEIPZIG, LEIPZIG, LEIPZIG]))).toMatch(/^Neue Organisation: die Angaben sind ungültig/)
        expect(parseOrganisationProposals(JSON.stringify([{ ...LEIPZIG, contact: 'digital@leipzig.example' }]))).toBe('Neue Organisation: die Angaben sind unvollständig.')
        expect(parseOrganisationProposals(JSON.stringify([{ id: 'leipzig' }]))).toBe('Neue Organisation: der Name fehlt.')
    })

    it('checks a proposal in the form by the same rules as the server and the catalogue', () => {
        expect(organisationProblem(LEIPZIG)).toBeUndefined()
        expect(organisationProblem({ ...LEIPZIG, contact: { email: 'team@stadt.d' } })).toBe('die Team-E-Mail ist ungültig')
        expect(organisationProblem({ ...LEIPZIG, website: 'https://stadt leipzig.de' })).toBe('die Website braucht eine https-Adresse')
    })

    it('holds a code to the name beside it, as the catalogue’s check does, and keeps only proposals in use', () => {
        const share = (extra: object) => ({ maintainer: 'Stadt Musterhausen', maintainerOrg: 'musterhausen', ...extra })
        expect(checkOrganisations(share({}), LISTED)).toEqual([])
        expect(checkOrganisations(share({ maintainer: 'Musterhausen' }), LISTED)).toBe('Herausgeber: die gewählte Organisation heißt „Stadt Musterhausen“.')
        expect(checkOrganisations(share({ maintainerOrg: 'irgendwo' }), LISTED)).toMatch(/^Herausgeber: diese Organisation ist nicht im Katalog/)
        // A department may follow the lead organisation's name.
        const lead = (operator: string, operatorOrg = 'musterhausen') => share({ metadata: { implementation: { operator, operatorOrg } } })
        expect(checkOrganisations(lead('Stadt Musterhausen - Umweltamt'), LISTED)).toEqual([])
        expect(checkOrganisations(lead('Umweltamt Musterhausen'), LISTED)).toBe('Federführende Organisation: der Eintrag muss mit „Stadt Musterhausen“ beginnen.')
        // Proposed: usable as if listed; an unused proposal and a listed code go nowhere.
        const proposing = { maintainer: 'Stadt Leipzig', maintainerOrg: 'leipzig', organisations: [LEIPZIG, { id: 'ungenutzt', name: 'Ungenutzt' }, MUSTERHAUSEN] }
        expect(checkOrganisations(proposing, LISTED)).toEqual([LEIPZIG])
        // A typed Herausgeber only where the catalogue has no list yet.
        expect(checkOrganisations({ maintainer: 'Erika Mustermann' }, LISTED)).toBe('Herausgeber: bitte eine Organisation aus der Liste wählen oder neu vorschlagen.')
        expect(checkOrganisations({ maintainer: 'Stadt Leipzig' }, [])).toEqual([])
    })

    it('fills in „wie Herausgeber“ only where nothing else was chosen', () => {
        const publisher = { maintainer: 'Stadt Musterhausen', maintainerOrg: 'musterhausen' }
        expect(withLeadDefault({}, publisher)).toEqual({ implementation: { operator: 'Stadt Musterhausen', operatorOrg: 'musterhausen' } })
        expect(withLeadDefault({ implementation: { status: 'prototyp' } }, { maintainer: 'Freier Text', maintainerOrg: '' })).toEqual({ implementation: { status: 'prototyp', operator: 'Freier Text' } })
        const chosen = { implementation: { operator: 'Gemeinde Musterbach', operatorOrg: 'musterbach' } }
        expect(withLeadDefault(chosen, publisher)).toBe(chosen)
    })

    it('suggests a readable code, and notices a name that is probably a listed one', () => {
        expect(['Stadt Leipzig', 'Zweckverband Wasser Süd', 'Open Urban Apps', ''].map(suggestedCode)).toEqual(['leipzig', 'zweckverbandwassersued', 'openurbanapps', ''])
        expect(similarOrganisation('Musterhausen', LISTED)).toBe(MUSTERHAUSEN)
        expect(similarOrganisation('Stadt Leipzig', LISTED)).toBeUndefined()
        // A short code is in too many names; a name without Latin letters gets no code.
        const au: Organisation = { id: 'au', name: 'Markt Au' }
        expect(['Augsburg', 'Landau', 'Bautzen'].map((name) => similarOrganisation(name, [au]))).toEqual([undefined, undefined, undefined])
        expect(similarOrganisation('Markt Au', [au])).toBeUndefined()
        expect(suggestedCode('東京都')).toBe('')
    })

    it('restores a draft from before the codes without pairing its name with the instance’s code', () => {
        const initial = { maintainer: 'Open Urban Apps', maintainerOrg: 'openurbanapps', displayName: 'Bäume' } as SteckbriefBasics
        expect(restoredBasics(initial, { maintainer: 'Erika Mustermann', displayName: 'Bäume 2' }, LISTED)).toMatchObject({ maintainer: 'Erika Mustermann', maintainerOrg: '', displayName: 'Bäume 2' })
        expect(restoredBasics(initial, { maintainer: 'stadt musterhausen' }, LISTED)).toMatchObject({ maintainerOrg: 'musterhausen' })
        expect(restoredBasics(initial, { maintainer: 'Stadt Leipzig', maintainerOrg: 'leipzig' }, LISTED)).toMatchObject({ maintainerOrg: 'leipzig' })
        expect(restoredBasics(initial, undefined, LISTED)).toBe(initial)
    })

    it('keeps them in a draft, and drops a draft whose list is broken', () => {
        const draft = { datasetId: 'd', datasetName: 'D', savedAt: '2026-11-13T10:00:00Z', step: 2, basics: {}, metadata: { fields: {}, themes: [], media: [] }, targetKey: 't', demoExcluded: [] }
        expect(parseDraft(JSON.stringify({ ...draft, organisations: [LEIPZIG] }))?.organisations).toEqual([LEIPZIG])
        expect(parseDraft(JSON.stringify({ ...draft, organisations: 'kaputt' }))).toBeUndefined()
    })
})

describe('the catalogue entry of a share', () => {
    const SHA = 'b95660bc21b90c67f13bae25ef8452c9a8293227'
    const location = { repoUrl: 'https://gitlab.example/katalog', path: 'packages/spielplatz', commitSha: SHA }
    const manifest = (extra: object) =>
        JSON.stringify({ id: 'urn:openurbanapps:usecase:spielplatz', displayName: 'Spielplatz', description: 'Spielplätze', version: '1.0.0', maintainer: 'Stadt Leipzig', license: 'EUPL-1.2', keywords: [], ...extra })
    const index = (useCases: unknown[], organisations: unknown[] = [MUSTERHAUSEN]) =>
        JSON.stringify({ version: '4.3.0', updatedAt: '2026-11-13T00:00:00Z', addons: [], useCases, dataStructures: [], organisations })
    const now = new Date('2026-11-14T10:00:00Z')

    it('takes the code and the proposals from the package, and adds a new organisation once', () => {
        const input = catalogInputFromManifest(manifest({ maintainerOrg: 'leipzig', organisations: [LEIPZIG, { id: 'KAPUTT' }] }), location)
        if (typeof input === 'string') throw new Error(input)
        expect(input.organisations).toEqual([LEIPZIG])
        const row = buildCatalogEntry(input)
        expect(Object.keys(row).slice(5, 7)).toEqual(['maintainer', 'maintainerOrg'])
        const edit = applyCatalogEntry(index([]), row, now, input.organisations)
        if (edit.status !== 'added') throw new Error(edit.status)
        expect(edit.organisations).toEqual([LEIPZIG])
        const written = JSON.parse(edit.content)
        expect(written.organisations).toEqual([MUSTERHAUSEN, LEIPZIG])
        expect(written.useCases[0].maintainerOrg).toBe('leipzig')
        // Listed already: nothing added twice.
        const again = applyCatalogEntry(index([], [MUSTERHAUSEN, LEIPZIG]), row, now, [LEIPZIG])
        expect(again.status === 'added' && again.organisations).toEqual([])
    })

    it('never links to an organisation the catalogue does not list, and keeps a row’s links a package did not know', () => {
        const unlisted = buildCatalogEntry({ ...location, id: 'urn:openurbanapps:usecase:spielplatz', displayName: 'Spielplatz', description: 'x', version: '1.0.0', maintainer: 'Stadt Leipzig', maintainerOrg: 'leipzig', license: 'EUPL-1.2', keywords: [] })
        const added = applyCatalogEntry(index([]), unlisted, now)
        expect(added.status === 'added' && JSON.parse(added.content).useCases[0].maintainerOrg).toBeUndefined()

        const before = { ...buildCatalogEntry({ ...location, id: 'urn:openurbanapps:usecase:spielplatz', displayName: 'Spielplatz', description: 'x', version: '1.0.0', maintainer: 'Stadt Musterhausen', license: 'EUPL-1.2', keywords: [], metadata: { implementation: { operator: 'Stadt Musterhausen' } } }), maintainerOrg: 'musterhausen', implementation: { operator: 'Stadt Musterhausen', operatorOrg: 'musterhausen' } }
        const nextVersion = buildCatalogEntry({ ...location, id: 'urn:openurbanapps:usecase:spielplatz', displayName: 'Spielplatz', description: 'x', version: '1.0.1', maintainer: 'Stadt Musterhausen', license: 'EUPL-1.2', keywords: [], metadata: { implementation: { operator: 'Stadt Musterhausen' } } })
        const replaced = applyCatalogEntry(index([before]), nextVersion, now)
        const row = replaced.status === 'replaced' ? JSON.parse(replaced.content).useCases[0] : undefined
        expect(row).toMatchObject({ version: '1.0.1', maintainerOrg: 'musterhausen', implementation: { operator: 'Stadt Musterhausen', operatorOrg: 'musterhausen' } })
    })

    it('keeps only links the catalogue accepts, and names a proposed code that was taken meanwhile', () => {
        const entry = (maintainer: string, extra: object = {}) =>
            buildCatalogEntry({ ...location, id: 'urn:openurbanapps:usecase:spielplatz', displayName: 'Spielplatz', description: 'x', version: '1.0.0', maintainer, license: 'EUPL-1.2', keywords: [], ...extra })
        const rowOf = (edit: ReturnType<typeof applyCatalogEntry>) => (edit.status === 'added' ? JSON.parse(edit.content) : undefined)
        // Listed code, other name: the text stays, the link goes.
        const renamed = rowOf(applyCatalogEntry(index([]), entry('Musterhausen', { maintainerOrg: 'musterhausen' }), now))
        expect(renamed.useCases[0].maintainerOrg).toBeUndefined()
        // The lead must start with the name.
        const lead = rowOf(applyCatalogEntry(index([]), entry('Stadt Musterhausen', { maintainerOrg: 'musterhausen', metadata: { implementation: { operator: 'Umweltamt', operatorOrg: 'musterhausen' } } }), now))
        expect(lead.useCases[0]).toMatchObject({ maintainerOrg: 'musterhausen', implementation: { operator: 'Umweltamt' } })
        expect(lead.useCases[0].implementation.operatorOrg).toBeUndefined()
        // Proposed as `musterhausen` by someone else: not added, not linked, and said in the merge request.
        const other: Organisation = { id: 'musterhausen', name: 'Musterhausen GmbH' }
        const taken = applyCatalogEntry(index([]), entry('Musterhausen GmbH', { maintainerOrg: 'musterhausen' }), now, [other])
        expect(taken.status === 'added' && { organisations: taken.organisations, taken: taken.taken }).toEqual({ organisations: [], taken: [{ proposed: other, listedAs: 'Stadt Musterhausen' }] })
        expect(rowOf(taken).organisations).toEqual([MUSTERHAUSEN])
        // A proposal the entry does not link to stays out of the list.
        const unused = applyCatalogEntry(index([]), entry('Stadt Musterhausen', { maintainerOrg: 'musterhausen' }), now, [LEIPZIG])
        expect(unused.status === 'added' && unused.organisations).toEqual([])
    })
})

describe('the lead organisation, as the field keeps it', () => {
    it('keeps the department as typed, spaces included, and the lead without them', () => {
        expect(composeLead('Stadt Musterhausen', ' Amt für Umwelt ')).toBe('Stadt Musterhausen - Amt für Umwelt')
        expect(departmentOf('Stadt Musterhausen – Umweltamt', 'Stadt Musterhausen')).toBe('Umweltamt')
        const typing = 'Amt '
        const lead = composeLead('Stadt Musterhausen', typing)
        expect(shownDepartment(lead, 'Stadt Musterhausen', typing)).toBe('Amt ')
        // Changed elsewhere (a draft, a pick): what the lead says wins.
        expect(shownDepartment('Stadt Musterhausen - Grünflächenamt', 'Stadt Musterhausen', typing)).toBe('Grünflächenamt')
        expect(shownDepartment('Freier Text', undefined, typing)).toBe('')
    })

    it('keeps a department only with the same organisation', () => {
        const current = { operatorOrg: 'musterhausen', department: 'Umweltamt' }
        expect(leadAfterPick(current, { name: 'Stadt Musterhausen', code: 'musterhausen' })).toEqual({ operator: 'Stadt Musterhausen - Umweltamt', operatorOrg: 'musterhausen' })
        expect(leadAfterPick(current, { name: 'Gemeinde Musterbach', code: 'musterbach' })).toEqual({ operator: 'Gemeinde Musterbach', operatorOrg: 'musterbach' })
        expect(leadAfterPick(current, { name: 'Freier Te', code: '' })).toEqual({ operator: 'Freier Te', operatorOrg: '' })
    })

    it('stays unticked by hand while empty, so a lead can be chosen before the Herausgeber', () => {
        const empty = { operator: '', operatorOrg: '' }
        expect(isFollowing(true, false, empty)).toBe(true)
        expect(isFollowing(true, true, empty)).toBe(false)
        expect(isFollowing(false, false, empty)).toBe(false)
        expect(isFollowing(true, false, { operator: 'Gemeinde Musterbach', operatorOrg: 'musterbach' })).toBe(false)
    })
})

describe('the organisation fields of the Steckbrief', () => {
    const options = (allowNew: boolean): OrganisationOptions => ({ listed: LISTED, proposals: [], allowNew, onPropose: () => {} })
    const field = (name: string, code = '', allowNew = true) =>
        renderToStaticMarkup(createElement(OrganisationField, { id: 'herausgeber', label: 'Herausgeber *', value: { name, code }, options: options(allowNew), required: true, onChange: () => {} }))

    it('offers the catalogue’s list, and a listed organisation needs nothing more', () => {
        const html = field('Stadt Musterhausen', 'musterhausen')
        expect(html).toContain('<option value="Stadt Musterhausen">musterhausen.example</option>')
        expect(text(html)).toContain('Aus der Liste des Katalogs wählen.')
        expect(text(html)).not.toContain('Neue Organisation vorschlagen')
    })

    it('asks „Meinst du …?“ for a near name, and offers to propose a new one where a share may', () => {
        expect(text(field('Musterhausen'))).toContain('Meinst du „Stadt Musterhausen“?')
        const fresh = text(field('Stadt Leipzig'))
        expect(fresh).toContain('„Stadt Leipzig“ ist noch nicht im Katalog.')
        expect(fresh).toContain('Neue Organisation vorschlagen')
        expect(field('Stadt Leipzig')).toContain('value="leipzig"')
        expect(text(field('Stadt Leipzig', '', false))).toContain('Bitte eine Organisation aus der Liste wählen.')
        expect(text(field('Stadt Leipzig', '', false))).not.toContain('Neue Organisation vorschlagen')
    })

    it('lets the lead organisation follow the Herausgeber in a share, and not in „Texte ändern“', () => {
        const lead = (follows: boolean, operator = '', operatorOrg = '') =>
            renderToStaticMarkup(createElement(LeadOrganisationField, { operator, operatorOrg, publisher: { name: 'Stadt Musterhausen', code: 'musterhausen' }, follows, options: options(follows), onChange: () => {} }))
        expect(lead(true)).toMatch(/<input type="checkbox" checked=""/)
        expect(text(lead(true))).toContain('Wie Herausgeber: Stadt Musterhausen')
        expect(text(lead(true))).not.toContain('Abteilung')
        const chosen = lead(true, 'Stadt Musterhausen - Umweltamt', 'musterhausen')
        expect(chosen).toContain('value="Umweltamt"')
        expect(lead(false)).not.toContain('type="checkbox"')
    })
})
