import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/export-actions', () => ({ adjustDemoInSimulator: vi.fn() }))
import { DemoGroup, type DemoAdjust } from '@/components/export/package-contents'
import type { DemoInventory } from '@/lib/export-actions'
import { generatedId, type DemoSource } from '@/lib/export/simulations'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const FEED: DemoSource = {
    id: 'src-feed',
    name: 'Bodenfeuchte-Feed',
    transport: 'mqtt',
    structureUrn: 'urn:core:platform:civitas:datastructure:environment:bodenfeuchtemessung:abc1234567',
    streams: [],
    generated: { id: generatedId('src-feed'), summary: '3 Datenströme mit je 3 Feldern, eine Nachricht alle 10 Sekunden' },
    sample: [
        { sensorId: 'BF-001', timestamp: '2026-11-01T14:05:10Z', feuchte: { value: 42.125 } },
        { sensorId: 'BF-001', timestamp: '2026-11-01T14:05:20Z', feuchte: { value: 43.5 } },
    ],
}

const UI = 'https://simulator.example'

function render(demo: DemoInventory, { excluded = [], adjust }: { excluded?: string[]; adjust?: DemoAdjust } = {}): string {
    return renderToStaticMarkup(
        createElement(DemoGroup, { demo, excluded: new Set(excluded), onToggle: () => {}, onReload: () => {}, adjust: adjust ?? { onAdjust: () => {} } }),
    )
}

describe('drafted demo data in „Was kommt ins Paket?“', () => {
    it('is ticked by default, says what it makes, and shows the first messages', () => {
        const html = render({ sources: [FEED], simulatorUi: UI })
        const said = text(html)
        expect(html).toMatch(/<input type="checkbox"[^>]*checked=""/)
        expect(said).toContain('1 von 1 ausgewählt')
        expect(said).toContain('Erzeugte Demo-Daten für Datenquelle „Bodenfeuchte-Feed“ · MQTT · 3 Datenströme mit je 3 Feldern, eine Nachricht alle 10 Sekunden')
        expect(said).toContain('Aus der Datenstruktur vorgeschlagen - so sehen die ersten Nachrichten aus:')
        // Nested fields as the structure names them, numbers the German way.
        expect(said).toContain('sensorId timestamp feuchte.value')
        expect(said).toContain('42,13')
        // Rows are told apart by spacing, not by rules (design system).
        expect(html).not.toMatch(/<tr class/)
        expect(said).toContain('Im Simulator anpassen Legt sie dort ausgeschaltet an. Was du dort änderst, kommt beim Einreichen ins Paket.')
    })

    it('can be unticked like a stream, and then is not offered for adjusting', () => {
        const html = render({ sources: [FEED], simulatorUi: UI }, { excluded: [generatedId('src-feed')] })
        expect(html).not.toMatch(/checked=""/)
        expect(text(html)).toContain('0 von 1 ausgewählt')
        expect(text(html)).not.toContain('Im Simulator anpassen')
    })

    it('still goes into the package without a simulator, only without a preview or adjusting', () => {
        const said = text(render({ sources: [{ ...FEED, sample: undefined }], problem: 'Der Simulator ist an diese Instanz nicht angebunden.' }))
        expect(said).toContain('Der Simulator ist an diese Instanz nicht angebunden. Die erzeugten Demo-Daten kommen trotzdem ins Paket, nur ohne Vorschau.')
        expect(said).toContain('Aus der Datenstruktur vorgeschlagen.')
        expect(said).not.toContain('Im Simulator anpassen')
        expect(said).toContain('1 von 1 ausgewählt')
    })

    it('stays in view once adjusted: the streams show their first messages and lead back into the simulator', () => {
        const adjusted: DemoSource = {
            ...FEED,
            generated: undefined,
            streams: [1, 2].map((n) => ({ id: `share--src-feed--bodenfeuchte-feed-${n}`, label: `Bodenfeuchte-Feed ${n}`, matchedBy: 'origin' as const })),
        }
        const html = render({ sources: [adjusted], simulatorUi: UI })
        const said = text(html)
        expect(said).toContain('So sehen die ersten Nachrichten von „Bodenfeuchte-Feed 1“ aus:')
        expect(said).toContain('sensorId timestamp feuchte.value')
        expect(said).toContain('Im Simulator bearbeiten: Bodenfeuchte-Feed 1 · Bodenfeuchte-Feed 2')
        expect(html).toContain(`href="${UI}/simulations/share--src-feed--bodenfeuchte-feed-2/edit"`)
        // Without a simulator page to go to, only the messages.
        expect(text(render({ sources: [adjusted] }))).not.toContain('Im Simulator bearbeiten')
    })

    it('says why there is none, with the way into the simulator', () => {
        const keyless: DemoSource = { ...FEED, generated: undefined, notGenerated: 'keine Spalte erkennbar, die jede Zeile eindeutig kennzeichnet (zum Beispiel baum_id)' }
        const html = render({ sources: [keyless], simulatorUi: UI })
        expect(text(html)).toContain('Für „Bodenfeuchte-Feed“ gibt es noch keine Demo-Daten, und erzeugen lassen sie sich nicht: keine Spalte erkennbar, die jede Zeile eindeutig kennzeichnet (zum Beispiel baum_id). Im Simulator anlegen')
        expect(html).toContain(`${UI}/simulations/new?from=`)
    })

    it('tells what came of „Im Simulator anpassen“', () => {
        const failed = text(render({ sources: [FEED], simulatorUi: UI }, { adjust: { onAdjust: () => {}, notice: { sourceId: 'src-feed', message: 'Nicht im Simulator angelegt: Simulator antwortet mit 503' } } }))
        expect(failed).toContain('Nicht im Simulator angelegt: Simulator antwortet mit 503')
        const blocked = render({ sources: [FEED], simulatorUi: UI }, {
            adjust: { onAdjust: () => {}, notice: { sourceId: 'src-feed', message: 'Im Simulator angelegt - dein Browser hat das neue Fenster blockiert.', href: `${UI}/simulations/x/edit` } },
        })
        expect(text(blocked)).toContain('dein Browser hat das neue Fenster blockiert. Im Simulator öffnen')
        expect(blocked).toContain(`href="${UI}/simulations/x/edit"`)
    })
})
