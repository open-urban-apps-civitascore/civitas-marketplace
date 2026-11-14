import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveCatalogEntry } from '@/lib/catalog/source'
import { isDataStructureEntry, type BundledDashboard } from '@/lib/catalog/types'
import { dashboardCreation, dashboardLinks, fetchInstalledDashboards } from '@/lib/installed-dashboards'
import { DashboardDocumentError } from '@/lib/superset/bundle'

const TRAFFIC = 'urn:openurbanapps:usecase:verkehrszaehlung'
const DATASET = '6f1c1a52-8f0e-4a4b-9a43-2d0c3f0c9b11'

/** A dashboard as `GET /v1/datasets/{id}/visualizations` lists it. */
const row = { visualizationType: 'DASHBOARD', id: 'a1', name: 'Luftqualität', released: true, active: true }

async function trafficDashboard(): Promise<BundledDashboard> {
    const entry = await resolveCatalogEntry(TRAFFIC)
    const dashboard = entry && !isDataStructureEntry(entry) ? entry.bundle.dashboards?.[0] : undefined
    if (!dashboard) throw new Error('the Verkehrszählung fixture has no dashboard')
    return dashboard
}

beforeEach(() => {
    // The bundled fixtures: the Verkehrszählung fixture carries a real Superset export.
    vi.stubEnv('MOCK_CATALOG', '1')
    vi.stubEnv('API_BASE_URL', 'http://apisix')
    vi.stubEnv('API_PORT', '9080')
    vi.stubEnv('SUPERSET_PUBLIC_URL', 'http://localhost:8092/')
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('dashboardCreation', () => {
    it('hands the export to the platform unchanged, named by its dashboard title', async () => {
        const dashboard = await trafficDashboard()
        expect(dashboardCreation(dashboard, true)).toEqual({
            visualizationType: 'DASHBOARD',
            name: 'Verkehrszählung',
            released: true,
            supersetBundle: dashboard.content.files,
        })
    })

    it('carries the release choice of the install', async () => {
        expect(dashboardCreation(await trafficDashboard(), false).released).toBe(false)
    })

    it('refuses a member that is no dashboard export, before anything is sent', () => {
        expect(() => dashboardCreation({ file: 'kaputt.dashboard.json', content: { tool: 'superset' }, dataSet: 'test' }, true)).toThrow(
            DashboardDocumentError,
        )
    })
})

describe('dashboardLinks', () => {
    it('links a dashboard by the id Superset gave it', () => {
        expect(dashboardLinks([{ ...row, externalDashboardId: '7' }], 'http://localhost:8092')).toEqual([
            {
                id: 'a1',
                title: 'Luftqualität',
                released: true,
                externalId: '7',
                url: 'http://localhost:8092/superset/dashboard/7/',
            },
        ])
    })

    it('lists a dashboard Superset does not have yet, without a link', () => {
        expect(dashboardLinks([{ ...row, externalDashboardId: null }], 'http://localhost:8092')).toEqual([
            { id: 'a1', title: 'Luftqualität', released: true },
        ])
    })

    it('drops the link of a dashboard Superset no longer serves', () => {
        const [dashboard] = dashboardLinks([{ ...row, externalDashboardId: '7', active: false }], 'http://localhost:8092')
        expect(dashboard.url).toBeUndefined()
        expect(dashboard.externalId).toBeUndefined()
    })

    it('keeps the Superset id without a public address', () => {
        expect(dashboardLinks([{ ...row, externalDashboardId: '7' }], undefined)).toEqual([
            { id: 'a1', title: 'Luftqualität', released: true, externalId: '7' },
        ])
    })

    it('marks a draft', () => {
        expect(dashboardLinks([{ ...row, released: false }], undefined)[0].released).toBe(false)
    })

    it('skips what is no dashboard', () => {
        expect(dashboardLinks([{ ...row, visualizationType: 'MAP' }, 'kaputt', null, { ...row, id: '' }], 'http://x')).toEqual([])
    })
})

describe('fetchInstalledDashboards', () => {
    it('reads the visualizations of the dataset with the user token', async () => {
        const fetchMock = vi.fn(
            async (_url: string, _init?: RequestInit) =>
                new Response(JSON.stringify({ content: [{ ...row, externalDashboardId: '7' }] }), { status: 200 }),
        )
        vi.stubGlobal('fetch', fetchMock)

        expect(await fetchInstalledDashboards(DATASET, 'token-1')).toEqual([
            {
                id: 'a1',
                title: 'Luftqualität',
                released: true,
                externalId: '7',
                url: 'http://localhost:8092/superset/dashboard/7/',
            },
        ])
        expect(fetchMock).toHaveBeenCalledWith(
            `http://apisix:9080/v1/datasets/${DATASET}/visualizations?size=100`,
            expect.objectContaining({ headers: { Authorization: 'Bearer token-1' } }),
        )
    })

    it('is empty when the platform refuses', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('permission_denied', { status: 403 })))
        expect(await fetchInstalledDashboards(DATASET, 'token-1')).toEqual([])
    })

    it('is empty without a dataset, and asks nobody', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        expect(await fetchInstalledDashboards(undefined, 'token-1')).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
