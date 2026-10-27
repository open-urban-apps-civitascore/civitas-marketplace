import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The list reads the share pages' listing through the provider, which a static render of `Ended` never does.
vi.mock('@/lib/session', () => ({ getAccessToken: vi.fn(async () => 'test-token') }))
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}))

import { Ended, EndedRow } from '@/components/export/ended-shares'
import { ENDED_PAGE, endedAction, endedLine, endedRowId, type EndedLine } from '@/lib/export/ended-lines'
import { inProgressHref } from '@/lib/export/in-progress-items'
import type { ShareProposal, SharedPackageRow } from '@/lib/export/share-listing'
import { shareTabs, type EndedEntry } from '@/lib/export/share-tabs'

const HERE = 'https://portal.hier.example'
const WEB = 'https://gitlab.example/group/catalog/-/merge_requests'
/** When the tests read the listing: a "no" is measured against it. */
const NOW = Date.parse('2026-10-22T12:00:00.000Z')

/** What a reader meets: the text, without markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const render = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(element)

const proposal = (kind: ShareProposal['kind'], iid: number, state: string, extra: Partial<ShareProposal> = {}): ShareProposal => ({ kind, iid, url: `${WEB}/${iid}`, state, ...extra })
/** A proposal's own source line, naming this instance. */
const sourced = { source: { kind: 'dataset' as const, id: 'ds-baeume', instance: HERE } }

/** One version as the listing reads it; from this instance by Ewa unless said otherwise. */
const row = (version: string, facts: Partial<SharedPackageRow> = {}): SharedPackageRow => ({
    key: `t#export/baeume-${version}`,
    targetKey: 't',
    targetLabel: 'Ablage',
    slug: 'baeume',
    version,
    displayName: 'Bäume',
    bundleMr: { url: `${WEB}/1`, state: 'merged' },
    source: { kind: 'dataset', id: 'ds-baeume', instance: HERE },
    proposedBy: 'Ewa',
    proposals: [proposal('bundle', 1, facts.bundleMr?.state ?? 'merged', sourced)],
    ...facts,
})
const onBase = (extra: Record<string, unknown> = {}) => ({ state: 'on-base' as const, packageId: 'urn:stadt:usecase:baeume', verification: { state: 'verified' as const }, ...extra })

/** A package proposal closed by a reviewer, with their words. */
const turnedDown = (iid: number, closedAt: string, extra: Partial<ShareProposal> = {}) =>
    proposal('bundle', iid, 'closed', { closedAt, closedBy: 'spaudanjo', reason: { kind: 'given', text: 'Bitte die Lizenz ergänzen.' }, ...sourced, ...extra })
const withdrawnOne = (iid: number, kind: ShareProposal['kind'] = 'bundle') =>
    proposal(kind, iid, 'closed', { closedAt: '2026-10-12T09:00:00Z', closedByBot: true, closedBy: 'walkable.cities.2021', withdrawnBy: 'Ewa', ...sourced })

const declined = (version: string, closedAt: string) =>
    row(version, { bundleMr: { url: `${WEB}/5`, state: 'closed' }, proposals: [turnedDown(5, closedAt)] })
const withdrawn = (version: string) => row(version, { bundleMr: { url: `${WEB}/4`, state: 'closed' }, withdrawn: true, proposals: [withdrawnOne(4)] })

/** The lines of „Beendet“, as the page builds them from the listing. */
function linesOf(rows: SharedPackageRow[], now = NOW): EndedLine[] {
    const tabs = shareTabs(rows, { instance: HERE, person: 'Ewa', now })
    const context = { rows, inProgress: tabs.inProgress, instance: HERE }
    return tabs.ended.map((entry) => endedLine(entry, context))
}
const actionsOf = (rows: SharedPackageRow[], now = NOW) => linesOf(rows, now).map((line) => line.action)

const NEW_VERSION = (version: string) => ({ kind: 'new-version', href: `/export/new?source=dataset:ds-baeume&from=${version}&package=baeume` })
const RESUBMIT = (version: string) => ({ kind: 'resubmit', href: `/export/new?source=dataset:ds-baeume&from=${version}&package=baeume&again=1` })
const IN_PROGRESS = (version: string, extra: { declined?: 'package' | 'entry' } = {}) => ({ kind: 'in-progress', version, href: inProgressHref({ targetKey: 't', slug: 'baeume', version }), ...extra })

describe('a row of „Beendet“', () => {
    const single = row('1.1.0', { bundleMr: { url: `${WEB}/4`, state: 'closed' } })
    const entry = (extra: Partial<EndedEntry>): EndedEntry => ({ key: 'k', ending: 'withdrawn', what: 'bundle', row: single, version: '1.1.0', origin: 'this', ...extra })

    it('says what ended, how, when and through whom', () => {
        const line = endedLine(entry({ proposal: proposal('bundle', 4, 'closed', { withdrawnBy: 'Ewa', closedAt: '2026-10-12T09:00:00Z' }), at: '2026-10-12T09:00:00Z' }))
        // Without the listing around it, no action: what it can be depends on the package's other versions.
        expect(line).toEqual({ title: 'Bäume', version: '1.1.0', what: 'Paket', proposal: 4, ending: 'Zurückgezogen', when: '12.10.2026', who: 'von Ewa', url: `${WEB}/4` })
        const html = render(createElement('ul', null, createElement(EndedRow, { line })))
        expect(text(html)).toBe('Bäume Version 1.1.0 Paket · Zurückgezogen · Vorschlag !4 12.10.2026 · von Ewa In GitLab ansehen')
        expect(html).toContain(`href="${WEB}/4"`)
    })

    it('names reviewers by GitLab username, and the marketplace’s account as such', () => {
        expect(endedLine(entry({ ending: 'not-accepted', proposal: proposal('bundle', 4, 'closed', { closedBy: 'daniel' }) })).who).toBe('von daniel')
        expect(endedLine(entry({ ending: 'not-accepted', proposal: proposal('bundle', 4, 'closed', { closedBy: 'oua-bot', closedByBot: true }) })).who).toBe('über das Marktplatz-Konto')
    })

    it('names who proposed and who accepted a removal, and a removal by hand', () => {
        const removal = proposal('removal', 9, 'merged', { proposedBy: 'Ewa', mergedBy: 'daniel', mergedAt: '2026-10-14T12:00:00Z' })
        // What is gone is the package: „Entfernen · Entfernt“ would say it twice.
        expect(endedLine(entry({ ending: 'removed', what: 'removal', proposal: removal, at: removal.mergedAt }))).toMatchObject({
            what: 'Paket',
            ending: 'Entfernt',
            when: '14.10.2026',
            who: 'vorgeschlagen von Ewa, angenommen von daniel',
            url: `${WEB}/9`,
        })
        const byHand = endedLine(entry({ ending: 'removed', what: 'version', byHand: true }))
        expect(byHand).toMatchObject({ ending: 'Entfernt', when: 'Datum unbekannt', who: 'von Hand bei GitLab', url: `${WEB}/4` })
        expect(byHand.what).toBeUndefined()
        // A removal turned down stays what it was about.
        expect(endedLine(entry({ ending: 'not-accepted', what: 'removal', proposal: proposal('removal', 9, 'closed', { closedBy: 'daniel' }) })).what).toBe('Entfernen')
    })

    it('tells a change to an accepted version turned down as one, not as the package’s "no" (S4, bodenfeuchte !19 and !21)', () => {
        const merged = proposal('bundle', 19, 'merged', { createdAt: '2026-10-01T10:00:00Z', mergedAt: '2026-10-02T10:00:00Z', ...sourced })
        const change = turnedDown(21, '2026-10-21T10:00:00Z', { createdAt: '2026-10-15T10:00:00Z' })
        const bodenfeuchte = row('1.0.0', { bundleMr: { url: `${WEB}/19`, state: 'merged' }, bundle: onBase(), catalog: { state: 'none' }, proposals: [change, merged] })
        const [line] = linesOf([bodenfeuchte])
        expect(line).toMatchObject({ what: 'Änderung am Paket', ending: 'Nicht angenommen', proposal: 21 })
        expect(text(render(createElement(EndedRow, { line })))).toContain('Änderung am Paket · Nicht angenommen · Vorschlag !21')
        // Closed before the package was accepted, it was the package's own "no".
        const before = turnedDown(18, '2026-09-25T10:00:00Z', { createdAt: '2026-09-20T10:00:00Z' })
        expect(linesOf([row('1.0.0', { bundle: onBase(), catalog: { state: 'none' }, proposals: [merged, before] })])[0].what).toBe('Paket')
        // Removed later, the change stays a change, and what the removal took out is the package.
        const removal = proposal('removal', 30, 'merged', { createdAt: '2026-10-20T10:00:00Z', mergedAt: '2026-10-21T10:00:00Z', ...sourced })
        const removedLater = row('1.0.0', { bundleMr: { url: `${WEB}/19`, state: 'merged' }, bundle: { state: 'none', reason: 'no-package', removal: { state: 'merged', mrUrl: `${WEB}/30` } }, proposals: [removal, change, merged] })
        expect(linesOf([removedLater]).map((one) => `${one.what} · ${one.ending}`)).toEqual(['Paket · Entfernt', 'Änderung am Paket · Nicht angenommen'])
        // Proposed again after the removal and turned down, it is the package's "no" once more.
        const again = turnedDown(33, '2026-10-23T10:00:00Z', { createdAt: '2026-10-22T10:00:00Z' })
        const sharedAgain = row('1.0.0', { bundleMr: { url: `${WEB}/33`, state: 'closed' }, proposals: [again, removal, change, merged] })
        expect(linesOf([sharedAgain]).find((one) => one.proposal === 33)?.what).toBe('Paket')
    })

    it('says that the catalogue team took a version out, with their reason', () => {
        const line = endedLine(entry({ ending: 'taken-out', what: 'version', version: '1.0.2', reason: 'Doppelt eingetragen' }))
        // With one full stop, as „In Arbeit“ and „Auswählen“ tell the same reason; the catalogue's own one is not doubled.
        expect(line).toMatchObject({ version: '1.0.2', ending: 'Aus dem Katalog genommen', when: 'Datum unbekannt', who: 'Katalog-Team', reason: 'Grund: Doppelt eingetragen.' })
        expect(text(render(createElement(EndedRow, { line })))).toContain('Grund: Doppelt eingetragen.')
        expect(endedLine(entry({ ending: 'taken-out', what: 'version', reason: 'Doppelt eingetragen!' })).reason).toBe('Grund: Doppelt eingetragen!')
    })

    it('leaves out whom nobody can tell', () => {
        expect(endedLine(entry({ proposal: proposal('bundle', 4, 'closed') })).who).toBeUndefined()
        expect(text(render(createElement(EndedRow, { line: endedLine(entry({})) })))).toBe('Bäume Version 1.1.0 Paket · Zurückgezogen Datum unbekannt In GitLab ansehen')
    })
})

describe('the catalogue team’s words on a row of „Beendet“', () => {
    const reasonOf = (reason: ShareProposal['reason'], extra: Partial<ShareProposal> = {}) =>
        linesOf([row('1.0.0', { bundleMr: { url: `${WEB}/5`, state: 'closed' }, proposals: [turnedDown(5, '2026-09-01T10:00:00Z', { reason, ...extra })] })])[0]

    it('gives their words without the name the line above says, or that they gave none, or that they could not be read (U4)', () => {
        expect(reasonOf({ kind: 'given', text: 'Bitte die Lizenz ergänzen.' })).toMatchObject({ who: 'von spaudanjo', reason: 'Grund: „Bitte die Lizenz ergänzen.“' })
        expect(reasonOf({ kind: 'none' }).reason).toBe('Ohne Begründung.')
        expect(reasonOf({ kind: 'unreadable' }).reason).toBe('Der Grund ließ sich gerade nicht lesen.')
        // A reason never read counts as none, as everywhere else.
        expect(reasonOf(undefined).reason).toBe('Ohne Begründung.')
    })

    it('tells the entry closed twice through the marketplace’s account as such, never as the team’s decision (S5, S10: !31 and !32)', () => {
        const viaAccount = (iid: number, closedAt: string) =>
            proposal('catalog', iid, 'closed', { createdAt: closedAt, closedAt, closedByBot: true, closedBy: 'walkable.cities.2021', comments: 0, reason: { kind: 'none' }, ...sourced })
        const musterbach = row('1.1.4', {
            bundle: onBase(),
            catalog: { state: 'declined', mrUrl: `${WEB}/32`, declined: { iid: 32, mrUrl: `${WEB}/32`, closedAt: '2026-10-22T09:41:28Z', viaMarketplace: true, reason: { kind: 'none' } } },
            proposals: [viaAccount(32, '2026-10-22T09:41:28Z'), viaAccount(31, '2026-10-22T09:37:23Z'), proposal('bundle', 30, 'merged', sourced)],
        })
        const lines = linesOf([musterbach])
        expect(lines.map((line) => [line.url, line.what, line.ending, line.when, line.who, line.reason])).toEqual([
            [`${WEB}/32`, 'Katalog-Eintrag', 'Nicht angenommen', '22.10.2026', 'über das Marktplatz-Konto', 'Ohne Begründung.'],
            [`${WEB}/31`, 'Katalog-Eintrag', 'Nicht angenommen', '22.10.2026', 'über das Marktplatz-Konto', 'Ohne Begründung.'],
        ])
        // Two cards that would read the same, told apart by their proposals' numbers.
        const cards = lines.map((line) => text(render(createElement(EndedRow, { line }))))
        expect(cards[0]).toContain('Katalog-Eintrag · Nicht angenommen · Vorschlag !32')
        expect(cards[1]).toContain('Katalog-Eintrag · Nicht angenommen · Vorschlag !31')
        // The entry of 1.1.4 is used up: the way on is a new version, also while its row in „In Arbeit“ says so.
        expect(lines.map((line) => line.action)).toEqual([NEW_VERSION('1.1.4'), NEW_VERSION('1.1.4')])
        const html = render(createElement('ul', null, ...lines.map((line, index) => createElement(EndedRow, { key: index, line }))))
        expect(text(html)).not.toContain('Katalog-Team')
        expect(text(html)).not.toContain('Erneut einreichen')
    })
})

describe('the action of a row of „Beendet“ (decided 22.10.)', () => {
    it('offers „Erneut einreichen“ for a withdrawn package, which never reached the catalogue', () => {
        expect(actionsOf([withdrawn('1.1.0')])).toEqual([RESUBMIT('1.1.0')])
    })

    it('offers nothing of its own for a withdrawn entry: the accepted package goes on in „In Arbeit“, which it links to', () => {
        const accepted = row('1.1.0', { bundle: onBase(), catalog: { state: 'none' }, proposals: [withdrawnOne(8, 'catalog'), proposal('bundle', 1, 'merged', sourced)] })
        expect(actionsOf([accepted])).toEqual([IN_PROGRESS('1.1.0')])
    })

    it('offers „Neue Version teilen“ for a package not accepted, while its "no" is news and afterwards (S1)', () => {
        expect(actionsOf([declined('1.0.0', '2026-10-21T10:00:00Z')])).toEqual([NEW_VERSION('1.0.0')])
        expect(actionsOf([declined('1.0.0', '2026-09-01T10:00:00Z')])).toEqual([NEW_VERSION('1.0.0')])
    })

    it('offers „Neue Version teilen“ for a removal not accepted (S8)', () => {
        const regen = row('1.0.0', {
            bundle: onBase({ removal: { state: 'closed', mrUrl: `${WEB}/9`, declined: { iid: 9, mrUrl: `${WEB}/9`, reason: { kind: 'none' } } } }),
            catalog: { state: 'none' },
            proposals: [proposal('removal', 9, 'closed', { closedAt: '2026-10-21T10:00:00Z', closedBy: 'spaudanjo', reason: { kind: 'none' }, ...sourced }), proposal('bundle', 1, 'merged', sourced)],
        })
        expect(linesOf([regen]).map((line) => [line.what, line.ending, line.action])).toEqual([['Entfernen', 'Nicht angenommen', NEW_VERSION('1.0.0')]])
    })

    it('offers „Erneut einreichen“ for a version gone from the repository by hand before it reached the catalogue', () => {
        const gone = row('1.0.0', { bundle: { state: 'none', reason: 'no-package' } })
        expect(linesOf([gone]).map((line) => [line.ending, line.who, line.action])).toEqual([['Entfernt', 'von Hand bei GitLab', RESUBMIT('1.0.0')]])
    })

    it('offers „Erneut einreichen“ for a version removed before it reached the catalogue, else „Neue Version teilen“', () => {
        const removal = proposal('removal', 9, 'merged', { createdAt: '2026-10-15T10:00:00Z', mergedAt: '2026-10-16T10:00:00Z', proposedBy: 'Ewa', mergedBy: 'daniel', ...sourced })
        const bundle = proposal('bundle', 1, 'merged', { createdAt: '2026-10-01T10:00:00Z', mergedAt: '2026-10-02T10:00:00Z', ...sourced })
        const removed = (extra: ShareProposal[]) =>
            row('1.0.0', { bundle: { state: 'none', reason: 'no-package', removal: { state: 'merged', mrUrl: `${WEB}/9` } }, proposals: [removal, ...extra, bundle] })
        expect(actionsOf([removed([])])).toEqual([RESUBMIT('1.0.0')])
        // It was in the catalogue once: the number is used up.
        const listedOnce = proposal('catalog', 7, 'merged', { createdAt: '2026-10-03T10:00:00Z', mergedAt: '2026-10-04T10:00:00Z', ...sourced })
        expect(actionsOf([removed([listedOnce])])).toEqual([NEW_VERSION('1.0.0')])
    })

    it('offers „Neue Version teilen“ for a version the catalogue team took out', () => {
        const out = row('1.0.0', { bundle: onBase(), catalog: { state: 'withdrawn', takenOut: { version: '1.0.0', reason: 'Doppelt eingetragen' } } })
        expect(linesOf([out]).map((line) => [line.ending, line.reason, line.action])).toEqual([['Aus dem Katalog genommen', 'Grund: Doppelt eingetragen.', NEW_VERSION('1.0.0')]])
        // A newer version under way meanwhile is where the package goes on.
        const inReview = row('1.1.0', { bundleMr: { url: `${WEB}/6`, state: 'opened' }, proposals: [proposal('bundle', 6, 'opened', sourced)] })
        expect(linesOf([inReview, out]).map((line) => [line.ending, line.action])).toEqual([['Aus dem Katalog genommen', IN_PROGRESS('1.1.0')]])
    })

    it('links to a newer version in „In Arbeit“ instead, and offers nothing where a newer one was proposed and is done there', () => {
        const inReview = row('1.1.0', { bundleMr: { url: `${WEB}/6`, state: 'opened' }, proposals: [proposal('bundle', 6, 'opened', sourced)] })
        expect(actionsOf([inReview, withdrawn('1.0.0')])).toEqual([IN_PROGRESS('1.1.0')])
        expect(actionsOf([inReview, declined('1.0.0', '2026-09-01T10:00:00Z')])).toEqual([IN_PROGRESS('1.1.0')])
        // 1.1.0 is in the catalogue: its row in „Veröffentlicht“ offers the next version.
        const listed = row('1.1.0', { bundle: onBase(), catalog: { state: 'listed' } })
        expect(actionsOf([listed, declined('1.0.0', '2026-09-01T10:00:00Z')])).toEqual([undefined])
    })

    it('says where the newer version it links to was not accepted, rather than that it is in progress', () => {
        // 1.1.0 turned down two days ago: its "no" is in „In Arbeit“, where the way on is.
        const lines = linesOf([declined('1.1.0', '2026-10-20T10:00:00Z'), withdrawn('1.0.0')])
        const older = lines.find((line) => line.version === '1.0.0')
        expect(older?.action).toEqual(IN_PROGRESS('1.1.0', { declined: 'package' }))
        const said = text(render(createElement(EndedRow, { line: older as EndedLine })))
        expect(said).toContain('Version 1.1.0 nicht angenommen')
        expect(said).not.toContain('ist in Arbeit')
        // Where only its entry was turned down, the package stays accepted: said as the option in „Auswählen“ says it.
        const entryNo = row('1.1.0', {
            bundle: onBase(),
            catalog: { state: 'declined', mrUrl: `${WEB}/32`, declined: { iid: 32, mrUrl: `${WEB}/32`, closedAt: '2026-10-21T10:00:00Z', reason: { kind: 'none' } } },
            proposals: [proposal('catalog', 32, 'closed', { closedAt: '2026-10-21T10:00:00Z', closedBy: 'spaudanjo', reason: { kind: 'none' }, ...sourced }), proposal('bundle', 30, 'merged', sourced)],
        })
        const toEntry = linesOf([entryNo, withdrawn('1.0.0')]).find((line) => line.version === '1.0.0')
        expect(toEntry?.action).toEqual(IN_PROGRESS('1.1.0', { declined: 'entry' }))
        expect(text(render(createElement(EndedRow, { line: toEntry as EndedLine })))).toContain('Katalog-Eintrag für 1.1.0 nicht angenommen')
    })

    it('links to the same version in „In Arbeit“ where it is open there again, or where the ending offers nothing', () => {
        // Withdrawn, then submitted again on the same branch: in review now.
        const again = row('1.1.0', { bundleMr: { url: `${WEB}/6`, state: 'opened' }, proposals: [proposal('bundle', 6, 'opened', sourced), withdrawnOne(4)] })
        expect(actionsOf([again])).toEqual([IN_PROGRESS('1.1.0')])
        // The entry turned down, then the removal proposed: a new version would wait for that proposal.
        const removing = row('1.1.4', {
            bundle: onBase({ removal: { state: 'opened', mrUrl: `${WEB}/40` } }),
            catalog: { state: 'declined', mrUrl: `${WEB}/32`, declined: { iid: 32, mrUrl: `${WEB}/32`, reason: { kind: 'none' } } },
            proposals: [proposal('catalog', 32, 'closed', { closedAt: '2026-10-22T09:41:28Z', closedByBot: true, reason: { kind: 'none' }, ...sourced }), proposal('bundle', 30, 'merged', sourced)],
        })
        expect(actionsOf([removing])).toEqual([IN_PROGRESS('1.1.4')])
    })

    // !3 and !5 have no source line; whether they are this instance's is up to what their version's README names.
    const kiez = (source?: SharedPackageRow['source']) =>
        row('1.0.0', {
            slug: 'kiez-baumkataster',
            key: 't#export/kiez-baumkataster-1.0.0',
            displayName: 'Kiez-Baumkataster',
            bundleMr: { url: `${WEB}/3`, state: 'closed' },
            source,
            proposedBy: undefined,
            proposals: [proposal('bundle', 3, 'closed', { closedAt: '2026-10-11T10:00:00Z', closedByBot: true, closedBy: 'walkable.cities.2021', reason: { kind: 'none' } })],
        })

    it('offers nothing for an older share whose proposal and README name no instance, and says so (U1: !3 and !5)', () => {
        const [line] = linesOf([kiez()])
        expect(line).toMatchObject({ ending: 'Nicht angenommen', who: 'über das Marktplatz-Konto', reason: 'Ohne Begründung.', unknownInstance: true })
        expect(line.action).toBeUndefined()
        expect(text(render(createElement(EndedRow, { line })))).toContain('Instanz unbekannt')
    })

    it('takes such a share as this instance’s where its README names this instance, as „Veröffentlicht“ does', () => {
        const [line] = linesOf([kiez({ kind: 'dataset', id: 'ds-kiez', instance: HERE })])
        expect(line.unknownInstance).toBeUndefined()
        expect(line.action).toEqual({ kind: 'new-version', href: '/export/new?source=dataset:ds-kiez&from=1.0.0&package=kiez-baumkataster' })
    })

    it('flags nothing and keeps every way on where this instance has no name to tell shares by (no PORTAL_URL)', () => {
        const rows = [kiez(), withdrawn('1.1.0')]
        const tabs = shareTabs(rows, { person: 'Ewa', now: NOW })
        const lines = tabs.ended.map((entry) => endedLine(entry, { rows, inProgress: tabs.inProgress }))
        expect(lines.map((line) => [line.title, line.unknownInstance, line.action?.kind])).toEqual([
            ['Bäume', undefined, 'resubmit'],
            ['Kiez-Baumkataster', undefined, 'new-version'],
        ])
        expect(lines.map((line) => text(render(createElement(EndedRow, { line })))).join(' ')).not.toContain('Instanz unbekannt')
    })

    it('reads what other instances shared into the same package for the version numbers, but only this instance’s for "done here"', () => {
        const theirs = row('1.1.0', { source: { kind: 'dataset', id: 'ds-x', instance: 'https://portal.dev.example' }, bundle: onBase(), catalog: { state: 'listed' } })
        // Another instance's newer version is counted, not listed here: nothing on the page would offer the way on.
        expect(actionsOf([theirs, declined('1.0.0', '2026-09-01T10:00:00Z')])).toEqual([NEW_VERSION('1.0.0')])
        // But its number counts for the package: 1.0.0 withdrawn below a listed 1.1.0 is not submitted again. Nothing on the
        // page lists 1.1.0, so the row offers a new version above it - not nothing.
        const tabs = shareTabs([theirs, withdrawn('1.0.0')], { instance: HERE, now: NOW })
        expect(endedAction(tabs.ended[0], { rows: [theirs, withdrawn('1.0.0')], inProgress: tabs.inProgress, instance: HERE })).toEqual(NEW_VERSION('1.0.0'))
        expect(tabs.inProgress).toEqual([])
        expect(tabs.published).toEqual([])
    })

    it('offers nothing for a withdrawal of a version that was proposed again from here since: that proposal’s row carries the way on', () => {
        // Withdrawn as !4, submitted again as !6 and turned down long ago: the version is used up, and !6 offers a new one.
        const again = row('1.0.0', { bundleMr: { url: `${WEB}/6`, state: 'closed' }, proposals: [turnedDown(6, '2026-09-02T10:00:00Z'), { ...withdrawnOne(4), closedAt: '2026-09-01T10:00:00Z' }] })
        expect(linesOf([again]).map((line) => [line.proposal, line.ending, line.action])).toEqual([
            [6, 'Nicht angenommen', NEW_VERSION('1.0.0')],
            [4, 'Zurückgezogen', undefined],
        ])
    })
})

describe('the list „Beendet“', () => {
    const line = (index: number): { key: string; line: EndedLine } => ({
        key: `k${index}`,
        line: { title: `Paket ${index}`, version: '1.0.0', what: 'Paket', ending: 'Zurückgezogen', when: '12.10.2026', url: `${WEB}/${index + 1}` },
    })
    const list = (props: Partial<Parameters<typeof Ended>[0]>) => render(createElement(Ended, { lines: [], ...props }))

    const OLDER = `${WEB}?scope=all&state=all&author_username=walkable.cities.2021`

    it('shows the newest 30 rows, then „Ältere anzeigen“, and „Ältere in GitLab ansehen“ only once all it read are shown', () => {
        expect(ENDED_PAGE).toBe(30)
        const many = list({ lines: Array.from({ length: 31 }, (_, index) => line(index)), older: OLDER })
        expect(many.match(/<li /g)).toHaveLength(30)
        expect(text(many)).toContain('Paket 29')
        expect(text(many)).not.toContain('Paket 30 ')
        expect(text(many)).toContain('Ältere anzeigen')
        expect(text(many)).not.toContain('Ältere in GitLab ansehen')
        // Each row can take the focus by its id; „Ältere anzeigen“ moves it to the first row it adds, the one after these 30.
        const ids = [...many.matchAll(/<li id="([^"]+)" tabindex="-1"/g)].map((match) => match[1])
        expect(ids).toEqual(Array.from({ length: ENDED_PAGE }, (_, index) => endedRowId(index)))
        expect(endedRowId(ENDED_PAGE)).toBe('beendet-31')
        expect(ids).not.toContain(endedRowId(ENDED_PAGE))

        const few = list({ lines: [line(0), line(1)], older: OLDER })
        expect(text(few)).not.toContain('Ältere anzeigen')
        expect(text(few)).toContain('Ältere in GitLab ansehen')
        expect(few).toContain(`href="${OLDER.replace(/&/g, '&amp;')}"`)
    })

    it('leads to GitLab for older ones only where the listing stopped before the oldest: otherwise there are none', () => {
        expect(text(list({ lines: [line(0), line(1)] }))).not.toContain('Ältere in GitLab ansehen')
        expect(text(list({ lines: Array.from({ length: 31 }, (_, index) => line(index)) }))).not.toContain('Ältere in GitLab ansehen')
    })

    it('counts what other instances ended, and says when nothing ended or GitLab could not be read', () => {
        expect(text(list({ lines: [line(0)], elsewhere: 2 }))).toContain('2 weitere Einträge stammen von anderen Instanzen.')
        expect(text(list({}))).toBe('Noch nichts beendet.')
        const failed = text(list({ error: 'GitLab-Fehler (500)' }))
        expect(failed).toBe('Was beendet ist, ließ sich gerade nicht abfragen (GitLab-Fehler (500)).')
    })

    it('makes each row a card with the team’s words before at most one action, a secondary button into the wizard', () => {
        const [declinedLine] = linesOf([declined('1.0.0', '2026-09-01T10:00:00Z')])
        const html = render(createElement('ul', null, createElement(EndedRow, { line: declinedLine })))
        expect(text(html)).toBe('Bäume Version 1.0.0 Paket · Nicht angenommen · Vorschlag !5 01.09.2026 · von spaudanjo Grund: „Bitte die Lizenz ergänzen.“ In GitLab ansehen Neue Version teilen')
        expect(html).toContain('href="/export/new?source=dataset:ds-baeume&amp;from=1.0.0&amp;package=baeume"')
        // Secondary, never the page's primary; one card per row, stacked at phone width.
        expect(html).toMatch(/<a href="\/export\/new[^"]*" class="[^"]*border px-3/)
        expect(html).not.toContain('bg-primary')
        expect(html).toContain('grid-cols-1')
        expect(html.match(/rounded-lg border bg-card p-5/g)).toHaveLength(1)
    })

    it('links a row to the version in „In Arbeit“ where the package goes on', () => {
        const inReview = row('1.1.0', { bundleMr: { url: `${WEB}/6`, state: 'opened' }, proposals: [proposal('bundle', 6, 'opened', sourced)] })
        const [withdrawnLine] = linesOf([inReview, withdrawn('1.0.0')])
        const html = render(createElement(EndedRow, { line: withdrawnLine }))
        expect(text(html)).toContain('Version 1.1.0 ist in Arbeit')
        expect(html).toContain(`href="${inProgressHref({ targetKey: 't', slug: 'baeume', version: '1.1.0' })}"`)
        expect(text(html)).not.toMatch(/Erneut einreichen|Neue Version teilen/)
    })
})
