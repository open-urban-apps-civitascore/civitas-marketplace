import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ShareSteps } from '@/components/export/share-steps'
import { removalDeclineShown, type Decline } from '@/lib/export/declines'
import { BUSY_BLOCKER } from '@/lib/export/new-version'
import { shareProgress } from '@/lib/export/share-stages'
import type { BundleStatus, CatalogStatus } from '@/lib/export/status'

/**
 * „So geht es weiter“ after a "no" of the catalogue team (2026-10-22, S1,
 * S5, S8; U8), rendered as the wizard renders it after „Stand prüfen“.
 */

const WEB = 'https://gitlab.example/group/catalog/-/merge_requests'

/** What a reader meets: the text, without markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/** The stages as list items, each as its markup. */
const stages = (html: string) => [...html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)].map((match) => match[0])

const decline = (iid: number, extra: Partial<Decline> = {}): Decline => ({
    iid,
    mrUrl: `${WEB}/${iid}`,
    closedAt: '2026-10-21T10:00:00.000Z',
    closedBy: 'spaudanjo',
    reason: { kind: 'given', text: 'Die Datenquelle ist nicht öffentlich.' },
    ...extra,
})

const verified = { state: 'verified' as const }

/** The steps as the wizard renders them (`export-panel.tsx`): the removal's "no" by the rule it uses. */
function steps({ bundle, catalog, version = '1.0.0' }: { bundle?: BundleStatus; catalog?: CatalogStatus; version?: string }) {
    return renderToStaticMarkup(
        createElement(ShareSteps, {
            progress: shareProgress({ version, bundle, catalog }),
            busy: false,
            canCheck: true,
            bundleMrUrl: bundle?.mrUrl,
            catalogMrUrl: catalog?.mrUrl,
            removalMrUrl: bundle?.removal?.mrUrl,
            version,
            declines: { review: bundle?.declined, listing: catalog?.state === 'declined' ? catalog.declined : undefined },
            removalDeclined: removalDeclineShown(bundle, catalog),
            onPropose: () => {},
            onCheck: () => {},
            onCatalog: () => {},
        }),
    )
}

describe('„So geht es weiter“ after a "no"', () => {
    it('marks the package review turned down with the problem mark, says who and when, their words and the way on, and offers no button (S1)', () => {
        const html = steps({ bundle: { state: 'none', mrUrl: `${WEB}/14`, declined: decline(14) }, catalog: { state: 'none' } })
        const review = stages(html)[1]
        expect(review).toContain('aria-current="step"')
        // The warn triangle, never the ring of the person's next step (U8).
        expect(review).toMatch(/<svg[^>]*class="[^"]*lucide-triangle-alert[^"]*text-amber-600[^"]*" aria-hidden="true"/)
        expect(review).not.toContain('lucide-circle')
        // After their words the proposal, where a reason cut at 300 characters goes on (decision 4).
        expect(text(review)).toBe(
            'Paket-Prüfung Das Katalog-Team - nicht angenommen am 21.10. Grund (spaudanjo): „Die Datenquelle ist nicht öffentlich.“ Vorschlag ansehen ' +
                'Für die überarbeitete Fassung trag im Steckbrief eine höhere Version ein, zum Beispiel 1.0.1.',
        )
        expect(review).toContain(`href="${WEB}/14"`)
        // Nothing to submit and nothing to check: the version is used up.
        expect(html).not.toContain('bg-primary')
        expect(html).not.toContain('Stand prüfen')
        // Once per proposal: not also as „In GitLab ansehen“ at the stage that opened it.
        expect(stages(html)[0]).not.toContain(`href="${WEB}/14"`)
        expect(html.split(`href="${WEB}/14"`).length - 1).toBe(1)
    })

    it('tells the entry closed through the marketplace’s account as such, with no button for it again (S5, S10: !32)', () => {
        const html = steps({
            bundle: { state: 'on-base', verification: verified },
            catalog: { state: 'declined', mrUrl: `${WEB}/32`, declined: decline(32, { closedAt: '2026-10-22T09:41:28Z', closedBy: 'walkable.cities.2021', viaMarketplace: true, reason: { kind: 'none' } }) },
            version: '1.1.4',
        })
        const [, , catalog, listing] = stages(html)
        expect(text(listing)).toBe(
            'Eintrags-Prüfung Über das Marktplatz-Konto - nicht angenommen am 22.10. Ohne Begründung. Vorschlag ansehen ' +
                'Der Eintrag entsteht aus dem angenommenen Paket. Für einen anderen Eintrag trag im Steckbrief eine höhere Version ein, zum Beispiel 1.1.5 - sie wird wieder geprüft.',
        )
        expect(listing).toContain('lucide-triangle-alert')
        expect(text(html)).not.toContain('Das Katalog-Team - nicht angenommen')
        // Stage 3 is done; the proposal turned down is linked once, after the words at the stage that turned it down.
        expect(catalog).toContain('lucide-circle-check')
        expect(catalog).not.toContain(`href="${WEB}/32"`)
        expect(listing).toContain(`href="${WEB}/32"`)
        expect(html).not.toContain('bg-primary')
        expect(text(html)).not.toContain('Katalog-Eintrag vorschlagen Du bist dran')
    })

    it('says that the reason could not be read, never that there was none (U4)', () => {
        const html = steps({ bundle: { state: 'none', mrUrl: `${WEB}/14`, declined: decline(14, { reason: { kind: 'unreadable' } }) } })
        expect(text(stages(html)[1])).toContain('Der Grund ließ sich gerade nicht lesen.')
    })

    it('says above the stages that the removal was turned down, and offers the entry as a secondary button only (S8)', () => {
        const html = steps({
            bundle: { state: 'on-base', verification: verified, removal: { state: 'closed', mrUrl: `${WEB}/40`, declined: decline(40, { reason: { kind: 'given', text: 'Wird noch gebraucht.' } }) } },
            catalog: { state: 'none' },
        })
        // The team's words, then the proposal where the rest of them is, named as in „In Arbeit“ (decision 4).
        expect(text(html)).toContain(
            'Das Katalog-Team hat das Entfernen am 21.10. nicht angenommen - das Paket bleibt angenommen. Grund (spaudanjo): „Wird noch gebraucht.“ Vorschlag ansehen',
        )
        // Their words are a value: on a line of their own in the text colour, as in „In Arbeit“, not inside the muted notice.
        expect(html).toMatch(/<p class="[^"]*text-sm[^"]*text-foreground[^"]*">Grund \(spaudanjo\): „Wird noch gebraucht.“ <a /)
        expect(html).toContain(`href="${WEB}/40"`)
        expect(html).not.toContain('bg-primary')
        expect(text(stages(html)[2])).toContain('Katalog-Eintrag vorschlagen')
    })

    it('tells only the later of two "no"s: the entry turned down after its removal was, not the removal as news (S8, then S5)', () => {
        const html = steps({
            bundle: { state: 'on-base', verification: verified, removal: { state: 'closed', mrUrl: `${WEB}/40`, declined: decline(40, { closedAt: '2026-10-10T10:00:00.000Z' }) } },
            catalog: { state: 'declined', mrUrl: `${WEB}/8`, declined: decline(8, { closedAt: '2026-10-22T10:00:00.000Z' }) },
        })
        expect(text(html)).not.toContain('Das Entfernen')
        expect(stages(html)[3]).toContain('lucide-triangle-alert')
        expect(text(stages(html)[3])).toContain('Das Katalog-Team - nicht angenommen am 22.10.')
        // The other way round the removal is the news, above the steps.
        const later = steps({
            bundle: { state: 'on-base', verification: verified, removal: { state: 'closed', mrUrl: `${WEB}/40`, declined: decline(40, { closedAt: '2026-10-22T10:00:00.000Z' }) } },
            catalog: { state: 'declined', mrUrl: `${WEB}/8`, declined: decline(8, { closedAt: '2026-10-10T10:00:00.000Z' }) },
        })
        expect(text(later)).toContain('Das Katalog-Team hat das Entfernen am 22.10. nicht angenommen')
    })

    it('keeps the person’s next step as it was where nothing was turned down', () => {
        const html = steps({ bundle: { state: 'on-base', verification: verified }, catalog: { state: 'none' } })
        expect(stages(html)[2]).toContain('lucide-circle')
        expect(stages(html)[2]).toContain('bg-primary')
        expect(html).not.toContain('lucide-triangle-alert')
    })
})

describe('„So geht es weiter“ beside another proposal, and on leaving the page', () => {
    const render = (progress: ReturnType<typeof shareProgress>, extra: Record<string, unknown> = {}) =>
        renderToStaticMarkup(
            createElement(ShareSteps, {
                progress,
                busy: false,
                canCheck: true,
                version: '1.1.0',
                onPropose: () => {},
                onCheck: () => {},
                onCatalog: () => {},
                ...extra,
            }),
        )

    it('says in neutral, in place of the button, that submitting waits for the other proposal: an open one is no problem', () => {
        const html = render(shareProgress({ version: '1.1.0' }), { proposeBlocker: BUSY_BLOCKER, proposeWaits: true })
        const propose = stages(html)[0]
        expect(text(propose)).toContain('Einreichen geht erst, wenn über den anderen Vorschlag entschieden ist.')
        expect(propose).toContain('lucide-info')
        expect(propose).not.toContain('lucide-triangle-alert')
        expect(html).not.toContain('Zur Prüfung einreichen')
        // Any other reason it cannot be submitted stays a warning.
        expect(stages(render(shareProgress({ version: '1.1.0' }), { proposeBlocker: 'Die Vorschau hat Fehler.' }))[0]).toContain('lucide-triangle-alert')
    })

    it('says it goes on after the review only while a review is open; else where the package is, and no more', () => {
        const inReview = render(shareProgress({ version: '1.1.0', bundle: { state: 'mr-open', mrUrl: `${WEB}/5` } }))
        expect(text(inReview)).toContain('Du findest das Paket jederzeit unter „Teilen“ › „In Arbeit“ - dort geht es nach der Prüfung weiter.')
        const accepted = render(shareProgress({ version: '1.1.0', bundle: { state: 'on-base', verification: verified }, catalog: { state: 'none' } }))
        expect(text(accepted)).toContain('Du findest das Paket jederzeit unter „Teilen“ › „In Arbeit“.')
        expect(text(accepted)).not.toContain('nach der Prüfung')
    })

    it('explains a proposal without promising an answer the page does not show: a question is read at GitLab', () => {
        const html = render(shareProgress({ version: '1.1.0' }))
        expect(text(html)).toContain('Hat es vorher eine Frage, steht sie im Vorschlag bei GitLab - schau dort nach, wenn es länger dauert.')
        expect(text(html)).not.toContain('bist du wieder dran')
    })
})
