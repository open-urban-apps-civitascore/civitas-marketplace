import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    checkSharedDashboard,
    collectSharedDashboards,
    fetchDashboardExport,
    MAX_DASHBOARD_BYTES,
    neutralizeDashboard,
} from '@/lib/export/dashboards'
import type { InstanceSnapshot } from '@/lib/export/portal-reader'
import { transformSnapshot, type ExportOptions } from '@/lib/export/transform'
import fixture from '@/lib/mock-catalog/luftqualitaet-sta/luftmessung.dashboard.json'
import type { SupersetDashboardDocument } from '@/lib/superset/bundle'

const DATASET = '6f1c1a52-8f0e-4a4b-9a43-2d0c3f0c9b11'

/** The Luftqualität export: one chart on the FROST view `observations_scoped`, a masked Trino address. */
const exported = (): SupersetDashboardDocument => structuredClone(fixture) as unknown as SupersetDashboardDocument

const pathOf = (document: SupersetDashboardDocument, folder: string) => {
    const path = Object.keys(document.files).find((candidate) => candidate.startsWith(folder))
    if (!path) throw new Error(`the fixture has no ${folder} file`)
    return path
}

function refusalOf(document: unknown): string {
    const checked = checkSharedDashboard(document)
    if (!('refusal' in checked)) throw new Error('expected a refusal')
    return checked.refusal
}

beforeEach(() => {
    vi.stubEnv('API_BASE_URL', 'http://apisix')
    vi.stubEnv('API_PORT', '9080')
    vi.stubEnv('SUPERSET_PUBLIC_URL', 'http://localhost:8092')
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('checkSharedDashboard', () => {
    it('takes a dashboard on the platform FROST view, named by its title', () => {
        const checked = checkSharedDashboard(exported())
        expect(checked).toEqual({ dashboard: { title: 'Testdashboard-1', document: exported() } })
    })

    it('refuses an export format it does not know, so new fields are looked at first', () => {
        const document = exported()
        document.files['metadata.yaml'] = { ...document.files['metadata.yaml'], version: '2.0.0' }
        expect(refusalOf(document)).toMatch(/Exportformat "2.0.0" ist unbekannt/)
    })

    it('refuses free SQL, whose query would come from the package', () => {
        const document = exported()
        const path = pathOf(document, 'datasets/')
        document.files[path] = { ...document.files[path], extra: {} }
        expect(refusalOf(document)).toMatch(/eigenen SQL-Abfrage/)
    })

    it('refuses a password outside the database file', () => {
        const document = exported()
        const path = pathOf(document, 'charts/')
        document.files[path] = { ...document.files[path], password: 'geheim' }
        expect(refusalOf(document)).toContain(`'${path}' enthält Zugangsdaten (password)`)
    })

    it('finds an address with a password inside the JSON a chart keeps as text', () => {
        const document = exported()
        const path = pathOf(document, 'charts/')
        document.files[path] = { ...document.files[path], query_context: JSON.stringify({ source: 'postgres://user:pw@db:5432/x' }) }
        expect(refusalOf(document)).toContain('enthält Zugangsdaten (query_context.source)')
    })

    it('lets a masked value pass', () => {
        const document = exported()
        const path = pathOf(document, 'charts/')
        document.files[path] = { ...document.files[path], token: 'XXXXXXXXXX' }
        expect(checkSharedDashboard(document)).toHaveProperty('dashboard')
    })

    it('refuses a second database', () => {
        const document = exported()
        document.files['databases/other.yaml'] = { database_name: 'other', uuid: 'u-2', version: '1.0.0' }
        expect(refusalOf(document)).toMatch(/liest 2 Datenbanken/)
    })

    it('refuses an export above the size limit', () => {
        const document = exported()
        document.files['charts/huge.yaml'] = { uuid: 'u-huge', blob: 'x'.repeat(MAX_DASHBOARD_BYTES) }
        expect(refusalOf(document)).toMatch(/größer als 512 KB/)
    })

    it('refuses what is no dashboard export', () => {
        expect(refusalOf({ tool: 'superset', files: {} })).toMatch(/metadata.yaml does not describe a dashboard export/)
    })
})

describe('neutralizeDashboard', () => {
    it('keeps only the name, id and version of the database, and no address', () => {
        const document = exported()
        const path = pathOf(document, 'databases/')
        const { document: neutral, credentialRemoved } = neutralizeDashboard(document)
        expect(neutral.files[path]).toEqual({
            database_name: document.files[path].database_name,
            uuid: document.files[path].uuid,
            version: document.files[path].version,
            sqlalchemy_uri: 'trino://',
        })
        expect(credentialRemoved).toBe(true)
        expect(neutral.files[pathOf(document, 'charts/')]).toEqual(document.files[pathOf(document, 'charts/')])
    })
})

describe('fetchDashboardExport', () => {
    it('asks the platform with the user token', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(exported()), { status: 200 }))
        vi.stubGlobal('fetch', fetchMock)
        expect(await fetchDashboardExport('token-1', DATASET, 'a1')).toEqual({ ok: true, document: exported() })
        expect(fetchMock).toHaveBeenCalledWith(
            `http://apisix:9080/v1/datasets/${DATASET}/visualizations/a1/export`,
            expect.objectContaining({ headers: { Authorization: 'Bearer token-1' } }),
        )
    })

    it.each([
        [409, 'Superset hat das Dashboard noch nicht angelegt'],
        [404, 'die Plattform bietet den Export noch nicht an'],
        [403, 'keine Berechtigung'],
        [504, 'nicht rechtzeitig'],
    ])('says why there is no export for %i', async (status, reason) => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })))
        const result = await fetchDashboardExport('token-1', DATASET, 'a1')
        expect(result.ok).toBe(false)
        expect(!result.ok && result.reason).toContain(reason)
    })

    it('passes on the reason the platform gives for a refusal', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'free SQL' }), { status: 422 })))
        expect(await fetchDashboardExport('token-1', DATASET, 'a1')).toEqual({ ok: false, reason: '422: free SQL' })
    })

    it('asks nobody for an id that is no dashboard id', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        expect(await fetchDashboardExport('token-1', DATASET, '../datapools')).toEqual({ ok: false, reason: 'ungültige Kennung' })
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

describe('collectSharedDashboards', () => {
    const listed = {
        content: [
            { visualizationType: 'DASHBOARD', id: 'a1', name: 'Testdashboard-1', externalDashboardId: '4', active: true, released: true },
        ],
    }

    function platform(exportStatus: number) {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) =>
                url.endsWith('/export')
                    ? new Response(exportStatus === 200 ? JSON.stringify(exported()) : '', { status: exportStatus })
                    : new Response(JSON.stringify(listed), { status: 200 }),
            ),
        )
    }

    it('takes a chosen dashboard of the dataset that passes the check', async () => {
        platform(200)
        const result = await collectSharedDashboards('token-1', DATASET, ['a1'])
        expect(result.warnings).toEqual([])
        expect(result.dashboards.map((dashboard) => dashboard.title)).toEqual(['Testdashboard-1'])
    })

    it('leaves out a dashboard the platform cannot export, with a warning', async () => {
        platform(409)
        const result = await collectSharedDashboards('token-1', DATASET, ['a1'])
        expect(result.dashboards).toEqual([])
        expect(result.warnings).toEqual([
            'Dashboard „Testdashboard-1“ fehlt im Paket: Superset hat das Dashboard noch nicht angelegt. Erst nach der Freigabe teilbar.',
        ])
    })

    it('skips an id the dataset does not list', async () => {
        platform(200)
        const result = await collectSharedDashboards('token-1', DATASET, ['other'])
        expect(result.dashboards).toEqual([])
        expect(result.warnings).toHaveLength(1)
    })

    it('asks nothing when no dashboard is chosen', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        expect(await collectSharedDashboards('token-1', DATASET, [])).toEqual({ dashboards: [], warnings: [] })
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

describe('the package with a dashboard', () => {
    const STRUCTURE = 'urn:core:instance:musterstadt:datastructure:default:luftmessung:q1w2e3r4t5:1.0.0'
    const snapshot: InstanceSnapshot = {
        dataset: { id: DATASET, name: 'Luftqualität' },
        structures: [
            {
                versionId: 'v-1',
                dataStructureId: 's-1',
                name: 'Luftmessung',
                modelUrn: STRUCTURE,
                model: { $id: STRUCTURE, type: 'object', properties: { pm25: { type: 'number' } } },
            },
        ],
        sources: [],
        sinks: [],
        mappings: [],
        pipelines: [],
        warnings: [],
    }
    const options: ExportOptions = {
        publisher: 'openurbanapps',
        slug: 'luftqualitaet',
        version: '1.0.0',
        displayName: 'Luftqualität',
        description: 'Feinstaub an drei Stationen.',
        maintainer: 'Open Urban Apps',
        license: 'EUPL-1.2',
        keywords: [],
        domain: 'environment',
        dashboards: [{ title: 'Testdashboard-1', document: exported() }],
        provenance: { datasetId: DATASET, datasetName: 'Luftqualität', exportedAt: '2026-11-10' },
    }

    it('carries the dashboard as a member, its database without address, and says what it removed', () => {
        const pkg = transformSnapshot(snapshot, options)
        expect(pkg.manifest.members.dashboards).toEqual([{ file: 'testdashboard-1.dashboard.json' }])
        const member = JSON.parse(pkg.files['core-ir/testdashboard-1.dashboard.json']) as SupersetDashboardDocument
        expect(member.files[pathOf(member, 'databases/')].sqlalchemy_uri).toBe('trino://')
        expect(pkg.stripped).toContainEqual({
            file: 'testdashboard-1.dashboard.json',
            field: 'databases: sqlalchemy_uri',
            reason: 'credential-in-url',
        })
    })

    it('keeps the manifest list empty without dashboards', () => {
        expect(transformSnapshot(snapshot, { ...options, dashboards: [] }).manifest.members.dashboards).toEqual([])
    })
})
