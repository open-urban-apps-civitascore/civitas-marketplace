import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchInstalledDashboards } from '@/lib/installed-dashboards'

const TRAFFIC = 'urn:openurbanapps:usecase:verkehrszaehlung'
const INSTALLATION = '2833c08c-1ed3-42b7-a58d-ac9cc499e0f5'

beforeEach(() => {
    // The bundled fixtures: the Verkehrszählung fixture carries a real Superset export.
    vi.stubEnv('MOCK_CATALOG', '1')
    vi.stubEnv('SUPERSET_API_URL', 'http://superset:8088')
    vi.stubEnv('SUPERSET_PUBLIC_URL', 'http://localhost:8098/')
})

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('fetchInstalledDashboards', () => {
    it('links the dashboard of an installation by the slug the import gave it', async () => {
        expect(await fetchInstalledDashboards(TRAFFIC, INSTALLATION)).toEqual([
            {
                title: 'Verkehrszählung',
                url: 'http://localhost:8098/superset/dashboard/verkehrszaehlung-2833c08c/',
            },
        ])
    })

    it('falls back to the API address when no public address is set', async () => {
        vi.stubEnv('SUPERSET_PUBLIC_URL', '')
        const [dashboard] = await fetchInstalledDashboards(TRAFFIC, INSTALLATION)
        expect(dashboard.url).toBe('http://superset:8088/superset/dashboard/verkehrszaehlung-2833c08c/')
    })

    it('is empty without any Superset address', async () => {
        vi.stubEnv('SUPERSET_API_URL', '')
        vi.stubEnv('SUPERSET_PUBLIC_URL', '')
        expect(await fetchInstalledDashboards(TRAFFIC, INSTALLATION)).toEqual([])
    })

    it('is empty for an unknown entry', async () => {
        expect(await fetchInstalledDashboards('urn:openurbanapps:usecase:does-not-exist', INSTALLATION)).toEqual([])
    })
})
