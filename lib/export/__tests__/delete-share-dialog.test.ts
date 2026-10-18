import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The dialog asks the server only after it is shown, which a static render never does.
vi.mock('@/lib/export-actions', () => ({ deleteShare: vi.fn(), planShareDeletion: vi.fn() }))

import { confirmLabel, DeletionView, DiscardDraftDialog, INSTANCE_STAYS, type DeletionReading } from '@/components/export/delete-share-dialog'
import type { DeletionPlan } from '@/lib/export/share-deletion'

/** The dialog as a reader meets it: its text, without markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const WEB = 'https://gitlab.example/group/catalog/-/merge_requests'
const catalogClose = { what: 'catalog' as const, ref: '!9', url: `${WEB}/9` }

/** The two plans of a merged version with its catalogue proposal still open, as `readDeletion` reads them. */
const choice: DeletionReading = {
    plan: { kind: 'withdraw', closes: [catalogClose], accepted: true, scope: 'proposal', fingerprint: 'a' },
    alternative: {
        kind: 'remove',
        closes: [catalogClose],
        scope: 'version',
        removal: { folder: 'packages/baeume', previous: false, files: 2, mergedUrl: `${WEB}/3` },
        fingerprint: 'b',
    },
}

const view = (reading: DeletionReading, scope: 'proposal' | 'version' = 'proposal') =>
    renderToStaticMarkup(createElement(DeletionView, { reading, scope, onScope: () => {} }))

describe('„Verwerfen“ for a started share', () => {
    const html = renderToStaticMarkup(
        createElement(DiscardDraftDialog, {
            title: 'Bäume',
            draft: { savedAt: '2026-10-16T12:00:00Z', startedAt: '2026-10-12T10:00:00Z' },
            onCancel: () => {},
            onConfirm: () => {},
        }),
    )

    it('asks first, names the day it was started and says what stays', () => {
        const plain = text(html)
        expect(plain).toContain('„Bäume“ verwerfen?')
        expect(plain).toContain('Deine Angaben seit dem 12.10. werden verworfen')
        expect(plain).toContain(INSTANCE_STAYS)
        expect(plain).not.toContain('Löschen')
        expect(plain).not.toContain('Use Case')
    })

    it('offers „Behalten“ before the red „Verwerfen“', () => {
        expect(text(html)).toMatch(/Behalten Verwerfen$/)
        expect(html.indexOf('>Behalten<')).toBeLessThan(html.indexOf('>Verwerfen<'))
    })
})

describe('„Zurückziehen“ with a proposal open on an accepted package', () => {
    it('lets the person choose, with only the open proposal preselected', () => {
        const html = view(choice)
        const plain = text(html)
        expect(plain).toContain('Was soll zurückgezogen werden?')
        expect(plain).toContain('Nur den offenen Vorschlag zurückziehen - das angenommene Paket bleibt')
        expect(plain).toContain('Auch das angenommene Paket entfernen lassen - das Katalog-Team entscheidet')
        const checked = (html.match(/<input[^>]*>/g) ?? []).filter((input) => input.includes('checked=""'))
        expect(checked).toHaveLength(1)
        expect(checked[0]).toContain('value="proposal"')
        expect(plain).toContain('Das angenommene Paket, so wie es ist.')
        expect(plain).not.toContain('Ein neuer Vorschlag bittet')
    })

    it('names the deed on the button, following the choice', () => {
        expect(confirmLabel(choice, 'proposal')).toBe('Vorschlag zurückziehen')
        expect(confirmLabel(choice, 'version')).toBe('Zurückziehen und Entfernen vorschlagen')
        expect(text(view(choice, 'version'))).toContain('Ein neuer Vorschlag bittet das Katalog-Team, den Ordner packages/baeume zu entfernen (2 Dateien).')
    })

    it('speaks of proposals in the plural when two are open', () => {
        const bundleClose = { what: 'bundle' as const, ref: '!21', url: `${WEB}/21` }
        const two: DeletionReading = {
            plan: { ...choice.plan, closes: [bundleClose, catalogClose] },
            alternative: { ...(choice.alternative as DeletionPlan), closes: [bundleClose, catalogClose] },
        }
        expect(text(view(two))).toContain('Nur die offenen Vorschläge zurückziehen - das angenommene Paket bleibt')
        expect(confirmLabel(two, 'proposal')).toBe('Vorschläge zurückziehen')
    })
})

describe('„Zurückziehen“ without a choice', () => {
    it('proposes the removal of an accepted package with nothing open, and says who decides', () => {
        const reading: DeletionReading = { plan: { ...(choice.alternative as DeletionPlan), closes: [], scope: undefined } }
        const plain = text(view(reading))
        expect(plain).toContain('Zurückziehen heißt hier: du schlägst vor, es bei GitLab wieder herauszunehmen - das Katalog-Team entscheidet.')
        expect(plain).not.toContain('Was soll zurückgezogen werden?')
        expect(confirmLabel(reading, 'proposal')).toBe('Entfernen vorschlagen')
    })

    it('withdraws a proposal nothing was accepted from', () => {
        const reading: DeletionReading = { plan: { kind: 'withdraw', closes: [{ what: 'bundle', ref: '!4', url: `${WEB}/4` }], fingerprint: 'c' } }
        expect(text(view(reading))).toContain('Der Vorschlag !4 wird geschlossen.')
        expect(confirmLabel(reading, 'proposal')).toBe('Vorschlag zurückziehen')
    })

    it('only explains when there is nothing to withdraw', () => {
        const reading: DeletionReading = { plan: { kind: 'none', closes: [], reason: 'Version 1.1.0 steht im Katalog.', fingerprint: 'd' } }
        expect(text(view(reading))).toContain('Version 1.1.0 steht im Katalog.')
        expect(confirmLabel(reading, 'proposal')).toBeUndefined()
    })
})
