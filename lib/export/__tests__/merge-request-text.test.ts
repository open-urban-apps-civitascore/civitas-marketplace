import { describe, expect, it } from 'vitest'

import type { MergeRequestNote } from '@/lib/export/gitlab'
import {
    catalogPinOf,
    declineReasonOf,
    displayNameOf,
    domainOf,
    isMarketplaceLine,
    proposedByOther,
    proposerOf,
    readmeSourceOf,
    REASON_MAX,
    shareSourceLine,
    shareSourceOf,
    withdrawalMark,
    withdrawalMarkIn,
    withdrawalNoteIn,
    withdrawerOf,
} from '@/lib/export/merge-request-text'

const BODY = (line: string) => ['Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.', '', '## Bäume 1.1.0', '', '---', 'Branch `export/baeume-1.1.0` · exported via the marketplace export', '', line].join('\n')

describe('the source line', () => {
    it('reads back what it writes, at the end of a description, without touching the first line', () => {
        const source = { kind: 'dataset' as const, id: '3f2c-ds', instance: 'https://portal.demo.example' }
        const line = shareSourceLine(source)
        expect(line).toBe('<!-- oua-share {"kind":"dataset","id":"3f2c-ds","instance":"https://portal.demo.example"} -->')
        expect(shareSourceOf(BODY(line))).toEqual(source)
        expect(proposerOf(BODY(line))).toBe('Ewa')
    })

    it('leaves out what is unknown, and reads it back as unknown', () => {
        expect(shareSourceLine({ kind: 'dataset', id: 'ds' })).toBe('<!-- oua-share {"kind":"dataset","id":"ds"} -->')
        expect(shareSourceOf(BODY(shareSourceLine({ kind: 'dataset', instance: 'https://x.example' })))).toEqual({ kind: 'dataset', instance: 'https://x.example' })
    })

    it('cannot be ended early by a value', () => {
        const source = { kind: 'dataset' as const, id: 'a --> <b>', instance: 'https://x.example/?q=<!--' }
        const line = shareSourceLine(source)
        expect(line.match(/-->/g)).toHaveLength(1)
        expect(line).not.toContain('<b>')
        expect(shareSourceOf(BODY(line))).toEqual(source)
    })

    it('finds nothing in a proposal without one, or with a garbled or foreign one', () => {
        expect(shareSourceOf(undefined)).toBeUndefined()
        expect(shareSourceOf(null)).toBeUndefined()
        expect(shareSourceOf(BODY(''))).toBeUndefined()
        expect(shareSourceOf(BODY('<!-- oua-share {"kind":"dataset", -->'))).toBeUndefined()
        expect(shareSourceOf(BODY('<!-- oua-share {"kind":"structure","id":"x"} -->'))).toBeUndefined()
        // Only a line of its own counts, not one quoted inside a sentence.
        expect(shareSourceOf('See <!-- oua-share {"kind":"dataset","id":"x"} --> here')).toBeUndefined()
        expect(shareSourceOf(BODY('<!-- oua-share {"kind":"dataset","id":"  "} -->'))).toEqual({ kind: 'dataset' })
    })
})

describe('readmeSourceOf', () => {
    const readme = (provenance: string) => `# Bäume — CORE-IR Use-Case Package\n\nStadtbäume\n\nExported from a running CIVITAS/CORE instance through the Open Urban Apps\nmarketplace on 2026-10-01 by Ewa\n${provenance}\nVersion 1.1.0 · EUPL-1.2 · maintained by Stadt.\n`

    it('reads the dataset and the instance an older package names', () => {
        expect(readmeSourceOf(readme('(dataset `Bäume (Mitte)`, id `ds-1`, instance https://portal.demo.example).'))).toEqual({
            kind: 'dataset',
            id: 'ds-1',
            instance: 'https://portal.demo.example',
        })
    })

    it('reads only the dataset where the exporting instance had no address set', () => {
        expect(readmeSourceOf(readme('(dataset `Bäume`, id `ds-1`).'))).toEqual({ kind: 'dataset', id: 'ds-1' })
    })

    it('guesses nothing from a README changed beyond recognition, or none at all', () => {
        expect(readmeSourceOf(readme('From dataset Bäume.'))).toBeUndefined()
        expect(readmeSourceOf(undefined)).toBeUndefined()
    })
})

describe('catalogPinOf', () => {
    it('reads the repository and folder a catalogue proposal pins', () => {
        const description = `Proposed by …\n\nAdds \`urn:stadt:usecase:baeume\` in \`useCases\`, pinned to\n\`${'f'.repeat(40)}\` of https://gitlab.example/group/catalog (path \`packages/baeume\`).`
        expect(catalogPinOf(description)).toEqual({ repo: 'https://gitlab.example/group/catalog', path: 'packages/baeume' })
        expect(catalogPinOf('Adds `x` in `useCases`.')).toBeUndefined()
    })
})

describe('domainOf', () => {
    it('reads the domain a package proposal gave its parts, from the line under it, so a new version keeps their ids', () => {
        const description = 'Proposed by …\n\n---\nBranch `export/baeume-1.1.0` · exported via the marketplace export\nPublisher `stadt`, domain `environment`\n'
        expect(domainOf(description)).toBe('environment')
        // Only that line, whole: not a word in the person's text, not a domain the form would refuse.
        expect(domainOf('What changed: Publisher `stadt`, domain `environment`')).toBeUndefined()
        expect(domainOf('Publisher `stadt`, domain `Umwelt`')).toBeUndefined()
        expect(domainOf(undefined)).toBeUndefined()
    })
})

describe('displayNameOf', () => {
    it('reads the name behind a draft mark a reviewer set, in any of GitLab’s forms (problem 16 of 2026-10-22)', () => {
        for (const title of ['Export use case: Bäume Mitte 1.1.0', 'Draft: Export use case: Bäume Mitte 1.1.0', '[Draft] Export use case: Bäume Mitte 1.1.0', '(draft) Export use case: Bäume Mitte 1.1.0']) {
            expect(displayNameOf(title, '1.1.0'), title).toBe('Bäume Mitte')
        }
        expect(displayNameOf('Export use case: Bäume 1.1.0', '1.2.0')).toBeUndefined()
        expect(displayNameOf('Bäume, überarbeitet', '1.1.0')).toBeUndefined()
    })
})

/** Ten o'clock on the day of !31 and !32, and some seconds or minutes around it. */
const at = (time: string) => `2026-10-22T${time}Z`

describe('the withdrawal mark', () => {
    it('is written with whom and when, and read back only within two minutes of the close it came with', () => {
        const mark = withdrawalMark('Ewa Flis', new Date(at('10:00:00.000')))
        expect(mark).toBe('Withdrawn through the Open Urban Apps marketplace on behalf of **Ewa Flis** at 2026-10-22T10:00:00.000Z.')
        const description = `${BODY(shareSourceLine({ kind: 'dataset', id: 'ds' }))}\n\n${mark}`
        expect(withdrawalMarkIn(description, at('10:00:01'))).toBe('Ewa Flis')
        expect(withdrawalMarkIn(description, at('10:02:00'))).toBe('Ewa Flis')
        // Reopened and closed again later by someone else: the old mark is no withdrawal of that close.
        expect(withdrawalMarkIn(description, at('10:02:01'))).toBeUndefined()
        expect(withdrawalMarkIn(description, null)).toBeUndefined()
        expect(withdrawalMarkIn(BODY(''), at('10:00:01'))).toBeUndefined()
        // The note reader of the time before does not take a mark for a note, nor the other way round.
        expect(withdrawerOf(mark)).toBeUndefined()
        expect(withdrawalMarkIn('Withdrawn through the Open Urban Apps marketplace on behalf of **Ewa**.', at('10:00:00'))).toBeUndefined()
    })

    it('counts the mark that belongs to the last close, of several, and one GitLab stored with Windows line ends', () => {
        const twice = [BODY(''), withdrawalMark('Ewa', new Date(at('09:00:00'))), withdrawalMark('Kim', new Date(at('10:00:00')))].join('\r\n\r\n')
        expect(withdrawalMarkIn(twice, at('10:00:30'))).toBe('Kim')
        expect(withdrawalMarkIn(twice, at('09:00:30'))).toBe('Ewa')
    })
})

describe('the withdrawal note of the time before the mark', () => {
    const NOTE = 'Withdrawn through the Open Urban Apps marketplace on behalf of **Ewa**. Sharing the use case again opens a new merge request.'
    const closedAt = at('10:00:00')
    const note = (body: string, createdAt: string, extra: Partial<MergeRequestNote> = {}): MergeRequestNote => ({ body, created_at: createdAt, author: { id: 42 }, ...extra })

    it('counts within ten minutes of the close', () => {
        expect(withdrawalNoteIn({ closed_at: closedAt }, [note(NOTE, at('10:00:02'))])).toBe('Ewa')
        expect(withdrawalNoteIn({ closed_at: closedAt }, [note(NOTE, at('10:10:00'))])).toBe('Ewa')
        expect(withdrawalNoteIn({ closed_at: closedAt }, [note(NOTE, at('10:10:01'))])).toBeUndefined()
        expect(withdrawalNoteIn({ closed_at: undefined }, [note(NOTE, at('10:00:02'))])).toBeUndefined()
        expect(withdrawalNoteIn({ closed_at: closedAt }, [note(NOTE, at('10:00:02'), { system: true })])).toBeUndefined()
    })

    it('does not make a close after a reopen a withdrawal (problem 8)', () => {
        // Withdrawn at 9:55, reopened by the team at 9:58, closed by them at 10:00.
        const notes = [note('reopened', at('09:58:00'), { system: true }), note(NOTE, at('09:55:01')), note('closed', at('09:55:00'), { system: true })]
        expect(withdrawalNoteIn({ created_at: at('09:00:00'), closed_at: closedAt }, notes)).toBeUndefined()
    })
})

describe('the catalogue team’s reason', () => {
    const kurator = { id: 99, username: 'spaudanjo' }
    const mr = { created_at: at('09:00:00'), closed_at: at('10:00:00'), closed_by: kurator }
    const said = (body: string, createdAt: string, author: MergeRequestNote['author'] = kurator, system = false): MergeRequestNote => ({ body, created_at: createdAt, author, system })

    it('is the newest comment of whoever closed it, written while it was open or just after the close', () => {
        const notes = [
            said('Noch eine Frage von mir.', at('10:05:00'), { id: 7, username: 'kim' }),
            said('closed', at('10:00:00'), kurator, true),
            said('Die Datenquelle ist nicht öffentlich - so nehmen wir es nicht auf.', at('09:59:30')),
            said('Schaue ich mir an.', at('09:30:00')),
        ]
        expect(declineReasonOf(mr, notes)).toEqual({ kind: 'given', text: 'Die Datenquelle ist nicht öffentlich - so nehmen wir es nicht auf.' })
        // Comment & close in one go writes the comment a moment later.
        expect(declineReasonOf(mr, [said('Doppelt, siehe !12.', at('10:09:59'))])).toEqual({ kind: 'given', text: 'Doppelt, siehe !12.' })
    })

    it('is none for a comment long after the close, before the proposal was last opened, or by someone else', () => {
        expect(declineReasonOf(mr, [said('Später noch: schade.', at('10:10:01'))])).toEqual({ kind: 'none' })
        const reopened = [said('reopened', at('09:40:00'), kurator, true), said('Erste Runde: nein.', at('09:20:00'))]
        expect(declineReasonOf(mr, reopened)).toEqual({ kind: 'none' })
        expect(declineReasonOf(mr, [said('Ich finde es gut.', at('09:59:00'), { id: 7, username: 'kim' })])).toEqual({ kind: 'none' })
        expect(declineReasonOf({ ...mr, closed_by: null }, [said('Nein.', at('09:59:00'))])).toEqual({ kind: 'none' })
        expect(declineReasonOf(mr, [])).toEqual({ kind: 'none' })
    })

    it('skips what the marketplace itself wrote, also when the marketplace’s account closed it by hand (S10)', () => {
        const bot = { id: 42, username: 'walkable.cities.2021' }
        const byHand = { ...mr, closed_by: bot }
        const notes = [
            said('Withdrawn through the Open Urban Apps marketplace on behalf of **Ewa**. The package stays in the repository as it is.', at('09:59:50'), bot),
            said('Test, bitte ignorieren.', at('09:59:40'), bot),
        ]
        expect(declineReasonOf(byHand, notes)).toEqual({ kind: 'given', text: 'Test, bitte ignorieren.' })
        expect(declineReasonOf(byHand, notes.slice(0, 1))).toEqual({ kind: 'none' })
        expect(isMarketplaceLine('Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.')).toBe(true)
        expect(isMarketplaceLine('Vom Marktplatz vorgeschlagen, aber zu früh.')).toBe(false)
    })

    it('tells the author by username where GitLab names no id', () => {
        // Not GitLab's usual answer, which has both; the username alone still names the same person.
        const nameOnly = { username: 'spaudanjo' } as { id: number; username: string }
        expect(declineReasonOf({ ...mr, closed_by: nameOnly }, [said('Nein, danke.', at('09:59:00'), nameOnly)])).toEqual({ kind: 'given', text: 'Nein, danke.' })
        expect(declineReasonOf({ ...mr, closed_by: nameOnly }, [said('Nein, danke.', at('09:59:00'), { username: 'kim' } as { id: number; username: string })])).toEqual({ kind: 'none' })
    })

    it('is plain text of one line, at most 300 characters', () => {
        expect(declineReasonOf(mr, [said('  Zwei\n\nAbsätze  ', at('09:59:00'))])).toEqual({ kind: 'given', text: 'Zwei Absätze' })
        const long = `${'ä'.repeat(REASON_MAX)} und mehr`
        const reason = declineReasonOf(mr, [said(long, at('09:59:00'))])
        expect(reason.kind === 'given' && Array.from(reason.text)).toHaveLength(REASON_MAX)
        expect(reason.kind === 'given' && reason.text.endsWith('ä…')).toBe(true)
        expect(declineReasonOf(mr, [said('ü'.repeat(REASON_MAX), at('09:59:00'))])).toEqual({ kind: 'given', text: 'ü'.repeat(REASON_MAX) })
    })
})

describe('proposedByOther', () => {
    it('is true only where both are named and differ, case and spaces aside', () => {
        expect(proposedByOther('Ewa', 'Kim')).toBe(true)
        expect(proposedByOther('Ewa', ' ewa ')).toBe(false)
        expect(proposedByOther(undefined, 'Kim')).toBe(false)
        expect(proposedByOther('Ewa', undefined)).toBe(false)
    })
})
