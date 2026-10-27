import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}))

import { BusySentence, ListingLine, StageNoticeView } from '@/components/export/source-picker'
import { sourceOptions, busyOptions } from '@/lib/export/source-options'

/** What a reader meets: the text, without markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/ ([.,)])/g, '$1').replace(/\( /g, '(').trim()

describe('what „Auswählen“ says around its dropdown (plan of 2026-10-18, section 3 b/c)', () => {
    it('says next to the field that the listing is asked, or could not be read - and nothing once it is', () => {
        expect(text(renderToStaticMarkup(createElement(ListingLine, { listing: { state: 'loading' } })))).toBe('Stand wird abgefragt …')
        expect(text(renderToStaticMarkup(createElement(ListingLine, { listing: { state: 'failed' } })))).toBe(
            'Ob schon etwas in Arbeit ist, ließ sich gerade nicht abfragen - beim Einreichen wird es noch einmal geprüft.',
        )
        expect(renderToStaticMarkup(createElement(ListingLine, { listing: { state: 'read', rows: [], busy: new Map() } }))).toBe('')
    })

    it('names the greyed-out datasets under the field, each linked to its row in „In Arbeit“', () => {
        const options = [
            { value: 'a', label: 'Baumkataster Mitte', disabled: true, busy: { versions: '1.1.0', href: '/export#in-arbeit-baeume-1.1.0-x' } },
            { value: 'b', label: 'Pegel' },
            { value: 'c', label: 'Regenmessnetz', disabled: true, busy: { versions: '1.0.1', href: '/export#in-arbeit-regen-1.0.1-x' } },
        ]
        const html = renderToStaticMarkup(createElement(BusySentence, { options: busyOptions(options) }))
        expect(text(html)).toBe('Nicht wählbar, weil gerade in Arbeit: Baumkataster Mitte (1.1.0), Regenmessnetz (1.0.1). Weiter geht es unter „In Arbeit“.')
        expect([...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])).toEqual(['/export#in-arbeit-baeume-1.1.0-x', '/export#in-arbeit-regen-1.0.1-x', '/export'])
        // Nothing while nothing is greyed out.
        expect(renderToStaticMarkup(createElement(BusySentence, { options: busyOptions(sourceOptions([{ id: 'b', name: 'Pegel' }], [])) }))).toBe('')
    })

    it('shows the chosen dataset’s stage as a neutral notice, with the one link it leads to', () => {
        const html = renderToStaticMarkup(
            createElement(StageNoticeView, {
                notice: { text: 'Für „Baumkataster Mitte“ läuft schon ein Vorschlag (Version 1.1.0, Paket-Prüfung). Weiter geht es unter „In Arbeit“.', link: { label: 'Zu „In Arbeit“', href: '/export#x' } },
            }),
        )
        expect(text(html)).toBe('Für „Baumkataster Mitte“ läuft schon ein Vorschlag (Version 1.1.0, Paket-Prüfung). Weiter geht es unter „In Arbeit“. Zu „In Arbeit“')
        expect(html).toContain('href="/export#x"')
        // A fact, not a warning, and no button of its own: one primary per surface.
        expect(html).not.toMatch(/warn|error|bg-primary/)
    })
})
