import { describe, expect, it } from 'vitest'

import { artifactCounts, installSteps } from '@/lib/install-payload'

describe('artifactCounts', () => {
    it('counts the core kinds always and the map kinds only where there are some', () => {
        const counts = artifactCounts({
            artifacts: [
                { artifactType: 'DATA_STRUCTURE' },
                { artifactType: 'DATA_STRUCTURE' },
                { artifactType: 'DATA_SOURCE' },
                { artifactType: 'LAYER' },
            ],
        })
        expect(counts).toEqual([
            { count: 2, label: 'Strukturen' },
            { count: 1, label: 'Quelle' },
            { count: 0, label: 'Mappings' },
            { count: 0, label: 'Senken' },
            { count: 0, label: 'Pipelines' },
            { count: 1, label: 'Kartenebene' },
        ])
    })
})

describe('installSteps', () => {
    it('makes one step per remark and pulls a dashboard address out of the text', () => {
        const steps = installSteps(
            ' · Demo-Daten: 6 Stream(s) aktiv · Dashboard „Regen“: https://dashboard.example/superset/dashboard/regen-1/ (zeigt Daten, sobald die Freigabe abgeschlossen ist)',
        )
        expect(steps).toEqual([
            { ok: true, text: 'Demo-Daten: 6 Stream(s) aktiv' },
            {
                ok: true,
                text: 'Dashboard „Regen“ (zeigt Daten, sobald die Freigabe abgeschlossen ist)',
                link: { label: 'Öffnen', href: 'https://dashboard.example/superset/dashboard/regen-1/' },
            },
        ])
    })

    it('marks what did not work as a warning', () => {
        expect(installSteps(' · Dashboard start.dashboard.json NICHT eingespielt: fetch failed')[0].ok).toBe(false)
        expect(installSteps(' · Demo-Daten: 2 Stream(s) aktiv, fehlgeschlagen: station-b')[0].ok).toBe(false)
    })

    it('lets the caller decide where it knows better, and gives nothing for an empty remark', () => {
        expect(installSteps(' · Freigabe gestartet: die Plattform richtet Speicher und Pipeline ein', true)[0].ok).toBe(true)
        expect(installSteps('')).toEqual([])
    })
})
