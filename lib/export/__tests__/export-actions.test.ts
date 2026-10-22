import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ requireSession: vi.fn(async () => ({ user: { name: 'Test' } })), getAccessToken: vi.fn(async () => 'test-token') }))
vi.mock('@/lib/export/portal-reader', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/lib/export/portal-reader')>(),
    readUseCase: vi.fn(async () => ({ dataset: { id: 'local', name: 'Bäume' }, structures: [], sources: [], sinks: [], mappings: [], pipelines: [], warnings: [] })),
}))
import { exportAction, inspectExportSource } from '@/lib/export-actions'
import { readUseCase } from '@/lib/export/portal-reader'

function form(metadata: unknown, intent = 'preview') {
    const data = new FormData()
    for (const [key, value] of Object.entries({ datasetId: 'local', publisher: 'stadt', slug: 'baeume', version: '1.0.0', domain: 'environment', displayName: 'Bäume', description: 'Stadtbäume', maintainer: 'Stadt', license: 'EUPL-1.2', catalogMetadata: JSON.stringify(metadata), intent })) data.set(key, value)
    return data
}
afterEach(() => vi.clearAllMocks())
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
})
