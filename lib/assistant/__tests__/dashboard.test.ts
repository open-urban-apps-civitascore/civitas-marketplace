import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildStarterDashboard, type DashboardField } from '@/lib/assistant/dashboard'
import {
    assembleStoredPackage,
    loadAssistantEntryByPackageId,
    saveStoredPackage,
} from '@/lib/assistant/store'
import { buildUseCasePackage, type UseCaseProposal } from '@/lib/assistant/usecase'
import { isDataStructureEntry } from '@/lib/catalog/types'
import { readDashboardDocument } from '@/lib/superset/bundle'
import { bindToInstallation, datasetSchema } from '@/lib/superset/rebind'

const FIELDS: DashboardField[] = [
    { key: 'stationId', type: 'string', description: 'Kennung der Station', generator: { kind: 'station' } },
    { key: 'observedAt', type: 'string', dateTime: true, description: 'Zeitpunkt', generator: { kind: 'now' } },
    { key: 'pm10', type: 'number', description: 'Feinstaub PM10 in µg/m³', generator: { kind: 'randomWalk' } },
    { key: 'passanten', type: 'integer', description: 'Gezählte Passanten', generator: { kind: 'dailyProfile' } },
    { key: 'lat', type: 'number', description: 'Breitengrad', generator: { kind: 'stationLat' } },
    { key: 'zustand', type: 'string', description: 'Zustand des Sensors', generator: { kind: 'enum' } },
]

const INPUT = { seed: 'urn:test:package', title: 'Luft an Schulen', tableName: 'luft_an_schulen', fields: FIELDS, now: 0 }

function chartsOf(files: Record<string, Record<string, unknown>>) {
    return Object.entries(files)
        .filter(([file]) => file.startsWith('charts/'))
        .map(([, chart]) => chart as { slice_name: string; params: { metrics: Record<string, unknown>[]; groupby: string[] } })
}

describe('buildStarterDashboard', () => {
    it('builds a document the package checks accept', () => {
        const dashboard = buildStarterDashboard(INPUT)
        expect(dashboard).toBeDefined()
        expect(() => readDashboardDocument(dashboard?.document)).not.toThrow()
    })

    it('counts the messages and charts each measured value, a line per station', () => {
        const charts = chartsOf(buildStarterDashboard(INPUT)!.document.files)
        expect(charts.map((chart) => chart.slice_name)).toEqual([
            'Nachrichten pro Minute je Station',
            'Feinstaub PM10 in µg/m³ (Durchschnitt pro Minute je Station)',
            'Gezählte Passanten (Summe pro Minute je Station)',
        ])
        expect(charts.every((chart) => chart.params.groupby[0] === 'stationId')).toBe(true)
    })

    it('sums counts and averages readings', () => {
        const metrics = chartsOf(buildStarterDashboard(INPUT)!.document.files).map((chart) => chart.params.metrics[0])
        expect(metrics.find((metric) => metric.label === 'Durchschnitt pm10')?.aggregate).toBe('AVG')
        expect(metrics.find((metric) => metric.label === 'Summe passanten')?.aggregate).toBe('SUM')
    })

    it('charts at most four measured values', () => {
        const many: DashboardField[] = [
            FIELDS[1],
            ...Array.from({ length: 6 }, (_, index) => ({
                key: `wert${index}`,
                type: 'number' as const,
                description: `Wert ${index}`,
                generator: { kind: 'randomWalk' },
            })),
        ]
        expect(chartsOf(buildStarterDashboard({ ...INPUT, fields: many })!.document.files)).toHaveLength(5)
    })

    it('builds nothing without a time field', () => {
        expect(buildStarterDashboard({ ...INPUT, fields: FIELDS.filter((field) => !field.dateTime) })).toBeUndefined()
    })

    it('binds to an installation like a catalogue dashboard', () => {
        const instanceDatabase = '99999999-9999-4999-8999-999999999999'
        const datasetId = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d'
        const bound = bindToInstallation(buildStarterDashboard(INPUT)!.document, {
            installationId: '7f3c2a10-5b6d-4e8f-9a1b-2c3d4e5f6a7b',
            datasetId,
            databaseUuid: instanceDatabase,
        })
        const dataset = Object.entries(bound.files).find(([file]) => file.startsWith('datasets/'))?.[1]
        expect(dataset?.schema).toBe(datasetSchema(datasetId))
        expect(dataset?.database_uuid).toBe(instanceDatabase)
        expect(bound.slug).toMatch(/^luft-an-schulen-/)
    })
})

const PROPOSAL: UseCaseProposal = {
    title: 'Luft an Schulen',
    description: 'Feinstaub und Passanten vor Schulen.',
    domain: 'environment',
    messageName: 'Messung',
    fields: [
        { name: 'stationId', type: 'string', description: 'Kennung', generator: { kind: 'station' } },
        { name: 'observedAt', type: 'string', dateTime: true, description: 'Zeitpunkt', generator: { kind: 'now' } },
        { name: 'pm10', type: 'number', description: 'Feinstaub PM10 in µg/m³', generator: { kind: 'randomWalk', min: 5, max: 60 } },
    ],
    stations: [{ name: 'Grundschule Nord', id: 'S-001' }],
}

describe('buildUseCasePackage with a starter dashboard', () => {
    it('carries the dashboard as a member and as a plan step', () => {
        const pkg = buildUseCasePackage(PROPOSAL, 0)
        const entry = assembleStoredPackage({ manifest: pkg.manifest, files: pkg.files }, 'assistant:test')
        expect(isDataStructureEntry(entry)).toBe(false)
        expect(isDataStructureEntry(entry) ? [] : entry.bundle.dashboards).toHaveLength(1)
        expect(pkg.steps[pkg.steps.length - 1].kind).toBe('Dashboard')
    })
})

describe('the store, by package id', () => {
    let directory: string

    beforeEach(async () => {
        directory = await mkdtemp(path.join(tmpdir(), 'assistant-store-'))
        vi.stubEnv('ASSISTANT_STORE_DIR', directory)
    })

    afterEach(async () => {
        vi.unstubAllEnvs()
        await rm(directory, { recursive: true, force: true })
    })

    it('finds a stored package by the id the journal records', async () => {
        const pkg = buildUseCasePackage(PROPOSAL, 0)
        await saveStoredPackage('abc123', { manifest: pkg.manifest, files: pkg.files })
        const entry = await loadAssistantEntryByPackageId(pkg.manifest.id as string)
        expect(entry?.manifest.id).toBe(pkg.manifest.id)
    })

    it('answers undefined for an unknown id and for a store not yet created', async () => {
        expect(await loadAssistantEntryByPackageId('urn:openurbanapps:usecase:assistent-unbekannt')).toBeUndefined()
        vi.stubEnv('ASSISTANT_STORE_DIR', path.join(directory, 'gibt-es-nicht'))
        expect(await loadAssistantEntryByPackageId('urn:openurbanapps:usecase:assistent-unbekannt')).toBeUndefined()
    })
})
