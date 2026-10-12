import { describe, expect, it } from 'vitest'

import { boundingBoxOf, buildUseCaseMap, type MapField } from '@/lib/assistant/map'
import { assembleStoredPackage } from '@/lib/assistant/store'
import { buildUseCasePackage, type UseCaseProposal } from '@/lib/assistant/usecase'
import { buildInstallationRequest } from '@/lib/install-payload'

const FIELDS: MapField[] = [
    { key: 'stationId', generator: { kind: 'station' } },
    { key: 'zeitstempel', generator: { kind: 'now' } },
    { key: 'breitengrad', generator: { kind: 'stationLat' } },
    { key: 'laengengrad', generator: { kind: 'stationLon' } },
    { key: 'niederschlag', generator: { kind: 'randomWalk' } },
]

const STATIONS = [
    { lat: 50.94, lon: 6.95 },
    { lat: 50.96, lon: 6.98 },
]

describe('buildUseCaseMap', () => {
    it('builds nothing without coordinates', () => {
        const withoutCoordinates = FIELDS.filter((field) => !field.generator.kind.startsWith('station') || field.key === 'stationId')
        expect(buildUseCaseMap({ title: 'Regen', sinkTitle: 'Regen-Tabelle', fields: withoutCoordinates, stations: STATIONS })).toBeUndefined()
    })

    it('builds the point from the coordinate fields', () => {
        const map = buildUseCaseMap({ title: 'Regen', sinkTitle: 'Regen-Tabelle', fields: FIELDS, stations: STATIONS })
        expect(map?.positionMapping).toEqual({ op: 'geoPoint', lon: '$.laengengrad', lat: '$.breitengrad' })
        expect(map?.positionProperty.$ref).toBe('https://geojson.org/schema/Point.json')
    })

    it('opens the map around the stations', () => {
        const box = boundingBoxOf(STATIONS)
        expect(box.minX).toBeLessThan(6.95)
        expect(box.maxX).toBeGreaterThan(6.98)
        expect(box.minY).toBeLessThan(50.94)
        expect(box.maxY).toBeGreaterThan(50.96)
    })

    it('gives a single station a box of its own', () => {
        const box = boundingBoxOf([STATIONS[0]])
        expect(box.maxX - box.minX).toBeGreaterThan(0)
        expect(box.maxY - box.minY).toBeGreaterThan(0)
    })

    it('names its sink by title and its style by name, and lists the geometry among the attributes', () => {
        const map = buildUseCaseMap({ title: 'Regen', sinkTitle: 'Regen-Tabelle', fields: FIELDS, stations: STATIONS })!
        const layer = map.files['stationen.layer.json']
        expect(layer.sinkRef).toBe('Regen-Tabelle')
        expect(layer.defaultStyleRef).toBe(map.files['stationen.style.json'].name)
        expect(layer.attribute).toContain(layer.geometryColumnRef)
    })
})

const PROPOSAL: UseCaseProposal = {
    title: 'Regenmessnetz Köln',
    description: 'Niederschlag an Schulen in Köln.',
    domain: 'environment',
    messageName: 'Messung',
    fields: [
        { name: 'stationId', type: 'string', description: 'Kennung', generator: { kind: 'station' } },
        { name: 'zeitstempel', type: 'string', dateTime: true, description: 'Zeitpunkt', generator: { kind: 'now' } },
        { name: 'breitengrad', type: 'number', description: 'Breitengrad', generator: { kind: 'stationLat' } },
        { name: 'laengengrad', type: 'number', description: 'Längengrad', generator: { kind: 'stationLon' } },
        {
            name: 'niederschlag',
            type: 'number',
            description: 'Niederschlag im Intervall in mm',
            aggregate: 'sum',
            generator: { kind: 'randomWalk', min: 0, max: 0.2 },
        },
    ],
    stations: [
        { name: 'Schule Nord', id: 'KOE-001', lat: 50.96, lon: 6.95 },
        { name: 'Schule Süd', id: 'KOE-002', lat: 50.92, lon: 6.96 },
    ],
}

describe('buildUseCasePackage with a map', () => {
    const pkg = buildUseCasePackage(PROPOSAL, 0)

    it('adds the geometry to the target format only', () => {
        const target = pkg.files['zielformat.datastructure.json'] as { $defs: Record<string, { properties: Record<string, unknown> }> }
        const raw = pkg.files['rohformat.datastructure.json'] as { $defs: Record<string, { properties: Record<string, unknown> }> }
        expect(target.$defs.Messung.properties.position).toBeDefined()
        expect(raw.$defs.Messung.properties.position).toBeUndefined()
    })

    it('carries API, style and layer as members and a map step in the plan', () => {
        const members = pkg.manifest.members as Record<string, unknown[]>
        expect(members.apis).toHaveLength(1)
        expect(members.styles).toHaveLength(1)
        expect(members.layers).toHaveLength(1)
        expect(pkg.steps.some((step) => step.kind === 'Karte')).toBe(true)
    })

    it('becomes an install request whose layer references resolve', () => {
        const entry = assembleStoredPackage({ manifest: pkg.manifest, files: pkg.files }, 'assistant:test')
        const request = buildInstallationRequest(entry)
        expect(JSON.stringify(request)).toContain('"sinkRef":"urn:')
        expect(JSON.stringify(request)).toContain('"defaultStyleRef":"urn:')
    })
})
