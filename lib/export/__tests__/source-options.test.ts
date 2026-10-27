import { describe, expect, it } from 'vitest'

import { inProgressHref } from '@/lib/export/in-progress-items'
import { metadataDraft } from '@/lib/export/metadata'
import type { ShareDraft } from '@/lib/export/share-drafts'
import type { ShareProposal, SharedPackageRow } from '@/lib/export/share-listing'
import { shareTabs } from '@/lib/export/share-tabs'
import { busyOptions, sourceOptions, type ListingState } from '@/lib/export/source-options'
import type { ExportSource } from '@/lib/export/sources'

const draft = (datasetId: string, facts: Partial<ShareDraft> = {}): ShareDraft => ({
    datasetId,
    datasetName: datasetId,
    savedAt: '2026-10-16T10:00:00.000Z',
    step: 2,
    basics: {},
    metadata: metadataDraft(),
    targetKey: 't',
    demoExcluded: [],
    ...facts,
})

describe('the choices of „Auswählen“', () => {
    it('names each dataset, then its status and where it came from, in German', () => {
        const sources: ExportSource[] = [
            { id: 'a', name: 'Baumkataster Mitte', status: 'AVAILABLE', installed: false },
            { id: 'b', name: 'Bodenfeuchte', status: 'DRAFT', installed: true, catalog: { id: 'urn:x:usecase:bodenfeuchte', displayName: 'Bodenfeuchte im Park', description: '', version: '1.0.0', maintainer: '', license: 'EUPL-1.2', keywords: [], metadata: {} } },
            { id: 'c', name: 'Regenmessnetz', status: 'READY', installed: false },
        ]
        expect(sourceOptions(sources, [])).toEqual([
            { value: 'a', label: 'Baumkataster Mitte', detail: 'Freigegeben · hier angelegt' },
            // The portal's name, not the catalogue's: it is the dataset being chosen.
            { value: 'b', label: 'Bodenfeuchte', detail: 'Entwurf · aus dem Katalog installiert' },
            { value: 'c', label: 'Regenmessnetz', detail: 'Bereit zur Freigabe · hier angelegt' },
        ])
    })

    it('sorts by name the German way, whatever order the portal lists them in', () => {
        const names = sourceOptions([
            { id: '1', name: 'Wasserstand' },
            { id: '2', name: 'Ärztehäuser' },
            { id: '3', name: 'baumpflege' },
            { id: '4', name: 'Abfall' },
        ], []).map((option) => option.label)
        expect(names).toEqual(['Abfall', 'Ärztehäuser', 'baumpflege', 'Wasserstand'])
    })

    it('leaves out what is not known rather than guessing it or showing a code word', () => {
        expect(sourceOptions([
            // Installations unreadable: no origin; a status the portal added later: not shown as such.
            { id: 'a', name: 'A', status: 'ARCHIVED' },
            { id: 'b', name: 'B', installed: true },
            { id: 'c', name: 'C' },
        ], [])).toEqual([
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B', detail: 'aus dem Katalog installiert' },
            { value: 'c', label: 'C' },
        ])
    })

    it('adds a second line for a share started in this browser, with the day it was started', () => {
        const options = sourceOptions([
            { id: 'a', name: 'A', status: 'AVAILABLE', installed: false },
            { id: 'b', name: 'B', status: 'AVAILABLE', installed: false },
            { id: 'c', name: 'C', status: 'AVAILABLE', installed: false },
        ], [
            draft('a', { startedAt: '2026-10-12T08:00:00.000Z', savedAt: '2026-10-16T08:00:00.000Z' }),
            // From before rc.5, without a start: its last save is the closest there is.
            draft('c', { savedAt: '2026-10-14T08:00:00.000Z' }),
            draft('gone'),
        ])
        expect(options.map((option) => option.hint)).toEqual(['Angefangen am 12.10.', undefined, 'Angefangen am 14.10.'])
        // Started or not, every dataset stays a choice (decision of 18.10.).
        expect(options).toHaveLength(3)
    })
})

describe('the choices once the share listing is read (rc.7, plan of 2026-10-18, section 3 b)', () => {
    const HERE = 'https://portal.hier.example'
    const WEB = 'https://gitlab.example/group/catalog/-/merge_requests'
    const NOW = Date.parse('2026-10-22T12:00:00Z')
    const proposal = (kind: ShareProposal['kind'], iid: number, state: string, extra: Partial<ShareProposal> = {}): ShareProposal => ({
        kind,
        iid,
        url: `${WEB}/${iid}`,
        state,
        source: { kind: 'dataset', id: `ds-${iid}`, instance: HERE },
        ...extra,
    })
    /** A version of package `slug`, shared from dataset `datasetId` here. */
    const shared = (slug: string, version: string, datasetId: string, facts: Partial<SharedPackageRow>): SharedPackageRow => ({
        key: `t#export/${slug}-${version}`,
        targetKey: 't',
        targetLabel: 'Ablage',
        slug,
        version,
        displayName: slug,
        bundleMr: { url: `${WEB}/1`, state: 'merged' },
        source: { kind: 'dataset', id: datasetId, instance: HERE },
        proposedBy: 'Ewa',
        ...facts,
    })
    const onBase = { state: 'on-base' as const, packageId: 'urn:x:usecase:a', verification: { state: 'verified' as const } }
    const rows = [
        // Baumkataster: in review. Regenmessnetz: accepted, no entry yet. Pegel: turned down. Wasserstand: listed.
        shared('baeume', '1.1.0', 'a', { bundleMr: { url: `${WEB}/31`, state: 'opened' }, proposals: [proposal('bundle', 31, 'opened')] }),
        shared('regen', '1.0.1', 'b', { bundle: onBase, catalog: { state: 'none' }, proposals: [proposal('bundle', 8, 'merged')] }),
        shared('pegel', '1.0.0', 'c', {
            bundleMr: { url: `${WEB}/14`, state: 'closed' },
            proposals: [proposal('bundle', 14, 'closed', { closedAt: '2026-10-21T10:00:00Z', closedBy: 'spaudanjo', reason: { kind: 'none' }, source: { kind: 'dataset', id: 'c', instance: HERE } })],
        }),
        shared('wasser', '1.0.2', 'd', { bundle: onBase, catalog: { state: 'listed' }, proposals: [proposal('bundle', 5, 'merged')] }),
    ]
    const read: ListingState = { state: 'read', rows, busy: shareTabs(rows, { instance: HERE, person: 'Ewa', now: NOW }).busy, instance: HERE }
    const sources: ExportSource[] = [
        { id: 'a', name: 'Baumkataster Mitte', status: 'AVAILABLE', installed: false },
        { id: 'b', name: 'Regenmessnetz', status: 'AVAILABLE', installed: false },
        { id: 'c', name: 'Pegel', status: 'AVAILABLE', installed: false },
        { id: 'd', name: 'Wasserstand', status: 'AVAILABLE', installed: false },
        { id: 'e', name: 'Zählstellen', status: 'AVAILABLE', installed: false },
    ]

    it('greys out what is in „In Arbeit“, with the version and why in the second line, and says what the others are', () => {
        const options = sourceOptions(sources, [], read)
        expect(options.map(({ label, hint, disabled }) => [label, hint, Boolean(disabled)])).toEqual([
            ['Baumkataster Mitte', 'In Arbeit (1.1.0) - nicht wählbar', true],
            ['Pegel', 'Version 1.0.0 nicht angenommen - du teilst eine neue Version', false],
            ['Regenmessnetz', 'In Arbeit (1.0.1) - nicht wählbar', true],
            ['Wasserstand', 'Im Katalog als 1.0.2 - du teilst eine neue Version', false],
            ['Zählstellen', undefined, false],
        ])
        // The sentence under the field names the greyed-out ones, each linked to its row in „In Arbeit“.
        expect(busyOptions(options).map((option) => [option.label, option.busy])).toEqual([
            ['Baumkataster Mitte', { versions: '1.1.0', href: inProgressHref(rows[0]) }],
            ['Regenmessnetz', { versions: '1.0.1', href: inProgressHref(rows[1]) }],
        ])
    })

    it('leaves the accepted one a choice where the address starts from it („Neue Version teilen“), never one with a proposal open', () => {
        const options = sourceOptions(sources, [], read, { datasetId: 'b', from: { version: '1.0.1', slug: 'regen' } })
        expect(options.find((option) => option.value === 'b')).toEqual({ value: 'b', label: 'Regenmessnetz', detail: 'Freigegeben · hier angelegt' })
        const fromReview = sourceOptions(sources, [], read, { datasetId: 'a', from: { version: '1.1.0', slug: 'baeume' } })
        expect(fromReview.find((option) => option.value === 'a')?.disabled).toBe(true)
    })

    it('tells a share started in this browser first, and greys it out only while a proposal of it is open', () => {
        const options = sourceOptions(sources, [draft('a', { startedAt: '2026-10-12T08:00:00.000Z' }), draft('b', { startedAt: '2026-10-13T08:00:00.000Z' }), draft('c', { startedAt: '2026-10-14T08:00:00.000Z' })], read)
        expect(options.slice(0, 3).map(({ label, hint, disabled }) => [label, hint, Boolean(disabled)])).toEqual([
            ['Baumkataster Mitte', 'In Arbeit (1.1.0) - nicht wählbar', true],
            ['Pegel', 'Angefangen am 14.10.', false],
            ['Regenmessnetz', 'Angefangen am 13.10.', false],
        ])
    })

    it('greys out nothing while the listing is asked, or when it could not be read - the server checks again on submit', () => {
        for (const listing of [{ state: 'loading' }, { state: 'failed' }] as ListingState[]) {
            const options = sourceOptions(sources, [draft('e', { startedAt: '2026-10-12T08:00:00.000Z' })], listing)
            expect(options.some((option) => option.disabled)).toBe(false)
            // Only what this browser knows: a share started here.
            expect(options.map((option) => option.hint)).toEqual([undefined, undefined, undefined, undefined, 'Angefangen am 12.10.'])
            expect(busyOptions(options)).toEqual([])
        }
    })
})
