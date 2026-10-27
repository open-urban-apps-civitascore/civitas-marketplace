import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ShareSteps } from '@/components/export/share-steps'
import { removalDeclineShown, type Decline } from '@/lib/export/declines'
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
        expect(text(review)).toBe(
            'Paket-Prüfung Das Katalog-Team - nicht angenommen am 21.10. Grund (spaudanjo): „Die Datenquelle ist nicht öffentlich.“ ' +
                'Für die überarbeitete Fassung trag im Steckbrief eine höhere Version ein, zum Beispiel 1.0.1.',
        )
        // Nothing to submit and nothing to check: the version is used up.
        expect(html).not.toContain('bg-primary')
        expect(html).not.toContain('Stand prüfen')
        // The proposal stays linked where it was opened.
        expect(stages(html)[0]).toContain(`href="${WEB}/14"`)
    })

    it('tells the entry closed through the marketplace’s account as such, with no button for it again (S5, S10: !32)', () => {
        const html = steps({
            bundle: { state: 'on-base', verification: verified },
            catalog: { state: 'declined', mrUrl: `${WEB}/32`, declined: decline(32, { closedAt: '2026-10-22T09:41:28Z', closedBy: 'walkable.cities.2021', viaMarketplace: true, reason: { kind: 'none' } }) },
            version: '1.1.4',
        })
        const [, , catalog, listing] = stages(html)
        expect(text(listing)).toBe(
            'Eintrags-Prüfung Über das Marktplatz-Konto geschlossen am 22.10. - gilt als nicht angenommen Ohne Begründung. ' +
                'Der Eintrag entsteht aus dem angenommenen Paket. Für einen anderen Eintrag teilst du eine neue Version, die wieder geprüft wird.',
        )
        expect(listing).toContain('lucide-triangle-alert')
        expect(text(html)).not.toContain('Das Katalog-Team - nicht angenommen')
        // Stage 3 is done, with the proposal turned down to look at.
        expect(catalog).toContain('lucide-circle-check')
        expect(catalog).toContain(`href="${WEB}/32"`)
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
