import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ requireSession: vi.fn(async () => ({ user: { name: 'Test' } })), getAccessToken: vi.fn(async () => 'test-token') }))
vi.mock('@/lib/export/portal-reader', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/lib/export/portal-reader')>(),
    readUseCase: vi.fn(async () => ({ dataset: { id: 'local', name: 'Bäume' }, structures: [], sources: [], sinks: [], mappings: [], pipelines: [], warnings: [] })),
}))
vi.mock('@/lib/simulator/client', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/lib/simulator/client')>(),
    listSimulations: vi.fn(async () => []),
    getSimulation: vi.fn(async () => undefined),
    fetchSample: vi.fn(async () => [{ sensorId: 'BF-001', feuchte: { value: 41.5 } }]),
    registerSimulation: vi.fn(async () => {}),
    deleteSimulation: vi.fn(async () => {}),
}))
import { adjustDemoInSimulator, exportAction, inspectExportSource } from '@/lib/export-actions'
import { readUseCase, type InstanceSnapshot } from '@/lib/export/portal-reader'
import { generatedId } from '@/lib/export/simulations'
import { deleteSimulation, fetchSample, getSimulation, listSimulations, registerSimulation, SimulatorError, type SimulationDetail } from '@/lib/simulator/client'

function form(metadata: unknown, intent = 'preview') {
    const data = new FormData()
    for (const [key, value] of Object.entries({ datasetId: 'local', publisher: 'stadt', slug: 'baeume', version: '1.0.0', domain: 'environment', displayName: 'Bäume', description: 'Stadtbäume', maintainer: 'Stadt', license: 'EUPL-1.2', catalogMetadata: JSON.stringify(metadata), intent })) data.set(key, value)
    return data
}
afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
})
describe('export action schema boundary', () => {
    it.each(['preview', 'bundle', 'catalog', 'status'])('validates metadata before %s can read or write', async (intent) => {
        const result = await exportAction(null, form({ curation: { tier: 'verified' } }, intent))
        expect(result.status).toBe('invalid')
        expect(readUseCase).not.toHaveBeenCalled()
    })
    it('carries accepted metadata into the package manifest used by preview and bundle', async () => {
        const metadata = { themes: ['umwelt-klima'], contact: { email: 'amt@stadt.example' }, implementation: { collaboration: { wanted: false } } }
        const result = await exportAction(null, form(metadata))
        expect(readUseCase).toHaveBeenCalledWith('test-token', 'local')
        expect(result.preview?.manifest).toMatchObject(metadata)
    })
    it('keeps the export warnings on a refused preview, as the panel shows them as its reason', async () => {
        vi.mocked(readUseCase).mockResolvedValueOnce({ dataset: { id: 'local', name: 'Bäume' }, structures: [], mappings: [], pipelines: [], sinks: [], warnings: [],
            sources: [{ id: 'source', name: 'Kataster', connectorType: 'SQL', configuration: {} }] })
        const result = await exportAction(null, form({}))
        expect(result.status).toBe('invalid')
        expect(result.preview?.errors).toContain('usecase entry needs at least one dataStructures member')
        expect(result.preview?.warnings.some((warning) => warning.includes('die Quelle nennt keine Struktur'))).toBe(true)
    })
    it('returns only artifact names in the selection inventory', async () => {
        vi.mocked(readUseCase).mockResolvedValueOnce({ dataset: { id: 'local', name: 'Bäume' }, structures: [], mappings: [], pipelines: [], sinks: [], warnings: [],
            sources: [{ id: 'source', name: 'Kataster', connectorType: 'SQL', configuration: { password: 'must-not-leak' } }] })
        const inventory = await inspectExportSource('local')
        expect(inventory.artifacts).toEqual([{ type: 'source', kind: 'Datenquelle', name: 'Kataster' }])
        expect(JSON.stringify(inventory)).not.toContain('must-not-leak')
    })
    it('types a structure, as the export panel decides its missing-structure hint on the type', async () => {
        vi.mocked(readUseCase).mockResolvedValueOnce({ dataset: { id: 'local', name: 'Bäume' }, mappings: [], pipelines: [], sinks: [], sources: [], warnings: [],
            structures: [{ versionId: 'version', dataStructureId: 'structure', name: 'Baum', modelUrn: 'urn:stadt:model:baum:1.0.0', model: {} }] })
        const inventory = await inspectExportSource('local')
        expect(inventory.artifacts).toEqual([{ type: 'structure', kind: 'Datenstruktur', name: 'Baum' }])
    })
    it('names artifacts as the package will and flags the names the portal did not have', async () => {
        vi.mocked(readUseCase).mockResolvedValueOnce({ dataset: { id: 'local', name: 'Bäume' }, structures: [], warnings: [],
            sources: [],
            mappings: [{ urn: 'urn:local:mapping:a', document: { title: 'Messung zu Wert' } }, { urn: 'urn:local:mapping:b', document: {} }],
            sinks: [{ id: 'sink', name: 'Senke 1', dataSinkType: 'POSTGIS', configuration: {}, unnamed: true }],
            pipelines: [
                { id: 'p1', name: 'Untitled Pipeline', model: {}, dataSourceIds: [], dataSinkIds: [] },
                { id: 'p2', name: 'Pipeline ohne Namen', model: {}, dataSourceIds: [], dataSinkIds: [] },
                { id: 'p3', name: 'Import', model: {}, dataSourceIds: [], dataSinkIds: [] },
            ] })
        const inventory = await inspectExportSource('local')
        expect(inventory.artifacts.map(({ type, name, unnamed }) => [type, name, !!unnamed])).toEqual([
            ['mapping', 'Messung zu Wert', false],
            // Never the instance's URN: the package names it by its position.
            ['mapping', 'Mapping 2', true],
            ['sink', 'Senke 1', true],
            ['pipeline', 'Untitled Pipeline', true],
            ['pipeline', 'Pipeline ohne Namen', true],
            ['pipeline', 'Import', false],
        ])
    })
    it('links a source without a Topic to its portal page, so the author can add one', async () => {
        vi.stubEnv('PORTAL_URL', 'https://portal.example.org')
        vi.mocked(readUseCase).mockResolvedValueOnce({ dataset: { id: 'local', name: 'Bäume' }, structures: [], mappings: [], pipelines: [], sinks: [], warnings: [],
            sources: [
                { id: 'feed', name: 'Feed', connectorType: 'MQTT', configuration: { topics: [] } },
                { id: 'sensor', name: 'Sensor', connectorType: 'MQTT', configuration: { topics: ['stadt/+'] } },
            ] })
        const inventory = await inspectExportSource('local')
        expect(inventory.demo?.sources.map(({ id, problem, portalHref }) => ({ id, problem, portalHref }))).toEqual([
            { id: 'feed', problem: 'no-topic', portalHref: 'https://portal.example.org/datasources/feed' },
            { id: 'sensor', problem: undefined, portalHref: undefined },
        ])
    })
})

/** A dataset whose MQTT feed the simulator has nothing for. */
const UNSIMULATED: InstanceSnapshot = {
    dataset: { id: 'local', name: 'Bodenfeuchte' }, mappings: [], pipelines: [], sinks: [], warnings: [],
    structures: [{
        versionId: 'v', dataStructureId: 's', name: 'Messung', modelUrn: 'urn:core:instance:stadt:datastructure:default:messung:aaaaaaaaaa:1.0.0',
        model: { title: 'Messung', type: 'object', required: ['sensorId', 'feuchte'], properties: { sensorId: { type: 'string' }, feuchte: { type: 'number' } } },
    }],
    sources: [{ id: 'feed', name: 'Feed', connectorType: 'MQTT', structureVersionId: 'v', configuration: { urls: ['tcp://broker:1883'], topics: ['stadt/feuchte/+'] } }],
}

describe('demo data drafted from the structure', () => {
    afterEach(() => vi.mocked(readUseCase).mockReset())

    it('is offered with a sample where the simulator answers, and without one where none is set up', async () => {
        vi.mocked(readUseCase).mockResolvedValue(UNSIMULATED)
        const without = await inspectExportSource('local')
        expect(without.demo?.problem).toBe('Der Simulator ist an diese Instanz nicht angebunden.')
        expect(without.demo?.sources[0]?.generated).toMatchObject({ id: generatedId('feed') })
        expect(without.demo?.sources[0]?.sample).toBeUndefined()
        expect(fetchSample).not.toHaveBeenCalled()

        vi.stubEnv('SIMULATOR_API_URL', 'http://simulator:4300')
        const sampled = await inspectExportSource('local')
        expect(sampled.demo?.sources[0]?.sample).toEqual([{ sensorId: 'BF-001', feuchte: { value: 41.5 } }])
        // A preview that fails, however, costs the preview, not the draft.
        vi.mocked(fetchSample).mockRejectedValueOnce(new SyntaxError('Unexpected token < in JSON'))
        const unsampled = await inspectExportSource('local')
        expect(unsampled.demo?.sources[0]?.generated).toMatchObject({ id: generatedId('feed') })
        expect(unsampled.demo?.sources[0]?.sample).toBeUndefined()
    })

    it('gives a source with streams the first messages of its first stream, once adjusted too', async () => {
        vi.mocked(readUseCase).mockResolvedValue(UNSIMULATED)
        vi.stubEnv('SIMULATOR_API_URL', 'http://simulator:4300')
        const scenario = { intervalSeconds: 10, fields: { sensorId: { kind: 'constant' as const, value: 'F-001' } } }
        vi.mocked(listSimulations).mockResolvedValueOnce([{ id: 'share--feed--feed-1' } as SimulationDetail])
        vi.mocked(getSimulation).mockResolvedValueOnce({
            id: 'share--feed--feed-1', name: 'Bodenfeuchte · Feed 1', origin: { dataSource: { name: 'Feed', id: 'feed' } },
            input: { name: 'Bodenfeuchte · Feed 1', transport: { kind: 'mqtt', url: 'tcp://broker:1883', topic: 'stadt/feuchte/feed-1' }, scenario, enabled: false },
        } as unknown as SimulationDetail)
        const inventory = await inspectExportSource('local')
        expect(inventory.demo?.sources[0]).toMatchObject({ streams: [{ id: 'share--feed--feed-1', label: 'Feed 1' }], sample: [{ sensorId: 'BF-001', feuchte: { value: 41.5 } }] })
        expect(fetchSample).toHaveBeenCalledWith(scenario, 3)
    })

    it('is not offered while the simulator does not answer: its streams are unknown, not none', async () => {
        vi.mocked(readUseCase).mockResolvedValue(UNSIMULATED)
        vi.stubEnv('SIMULATOR_API_URL', 'http://simulator:4300')
        vi.mocked(listSimulations).mockRejectedValueOnce(new SimulatorError('Simulator nicht erreichbar: ECONNREFUSED', 0))
        const inventory = await inspectExportSource('local')
        expect(inventory.demo).toEqual({ sources: [], problem: 'Der Simulator antwortet nicht: Simulator nicht erreichbar: ECONNREFUSED' })
    })

    it('goes into the package without asking the simulator, so its absence costs nothing', async () => {
        vi.mocked(readUseCase).mockResolvedValue(UNSIMULATED)
        const data = form({})
        data.set('demoStreams', JSON.stringify([generatedId('feed')]))
        const result = await exportAction(null, data)
        expect(result.preview?.demo).toEqual({ scenarios: 1, streams: 3 })
        expect(result.preview?.warnings.some((warning) => warning.includes('Demo-Daten fehlen'))).toBe(false)
        expect(listSimulations).not.toHaveBeenCalled()
    })

    it('is put into the simulator switched off on „Im Simulator anpassen“, and opened at its first stream', async () => {
        vi.mocked(readUseCase).mockResolvedValue(UNSIMULATED)
        expect(await adjustDemoInSimulator('local', 'feed')).toEqual({ error: 'Der Simulator ist an diese Instanz nicht angebunden.' })

        vi.stubEnv('SIMULATOR_API_URL', 'http://simulator:4300')
        vi.stubEnv('SIMULATOR_UI_URL', 'https://simulator.example/')
        vi.stubEnv('SIMULATOR_BROKER_URL', 'tcp://localhost:1883')
        expect(await adjustDemoInSimulator('local', 'feed')).toEqual({ href: 'https://simulator.example/simulations/share--feed--feed-1/edit' })
        expect(vi.mocked(registerSimulation).mock.calls.map(([id, input]) => [id, input.enabled, input.transport])).toEqual([1, 2, 3].map((n) => [
            `share--feed--feed-${n}`, false, { kind: 'mqtt', url: 'tcp://localhost:1883', topic: `stadt/feuchte/feed-${n}` },
        ]))

        // All streams or none: the ones made before a refusal are taken back.
        vi.mocked(registerSimulation).mockClear()
        vi.mocked(registerSimulation).mockResolvedValueOnce().mockResolvedValueOnce().mockRejectedValueOnce(new SimulatorError('Simulator antwortet mit 403', 403))
        expect(await adjustDemoInSimulator('local', 'feed')).toEqual({ error: 'Nicht im Simulator angelegt: Simulator antwortet mit 403' })
        expect(vi.mocked(deleteSimulation).mock.calls.map(([id]) => id)).toEqual(['share--feed--feed-1', 'share--feed--feed-2'])
        expect(await adjustDemoInSimulator('local', 'gone')).toEqual({ error: 'Nicht im Simulator angelegt: die Datenquelle gehört nicht (mehr) zu diesem Datensatz.' })
    })
})
