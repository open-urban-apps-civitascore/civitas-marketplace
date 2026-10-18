import { describe, expect, it } from 'vitest'

import { metadataDraft } from '@/lib/export/metadata'
import type { ShareDraft } from '@/lib/export/share-drafts'
import { sourceOptions } from '@/lib/export/source-options'
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
