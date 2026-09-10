import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
    deleteDashboard,
    importDashboard,
    isSupersetConfigured,
    rebindSupersetZip,
    supersetConfig,
} from '../client'
import { createZip, readZip } from '../zip'

describe('Superset client', () => {
    const originalEnv = process.env

    beforeEach(() => {
        process.env = { ...originalEnv }
        delete process.env.SUPERSET_API_URL
        delete process.env.SUPERSET_PUBLIC_URL
    })

    afterEach(() => {
        process.env = originalEnv
        vi.restoreAllMocks()
    })

    describe('configuration', () => {
        it('reports not configured when SUPERSET_API_URL is unset', () => {
            expect(isSupersetConfigured()).toBe(false)
            expect(supersetConfig()).toBeUndefined()
        })

        it('reads configuration when SUPERSET_API_URL is set', () => {
            process.env.SUPERSET_API_URL = 'http://localhost:8098'
            expect(isSupersetConfigured()).toBe(true)
            const config = supersetConfig()
            expect(config?.apiUrl).toBe('http://localhost:8098')
            expect(config?.publicUrl).toBe('http://localhost:8098')
            expect(config?.username).toBe('admin')
        })

        it('supports a distinct SUPERSET_PUBLIC_URL', () => {
            process.env.SUPERSET_API_URL = 'http://superset.internal:8088'
            process.env.SUPERSET_PUBLIC_URL = 'https://dashboard.example.com'
            const config = supersetConfig()
            expect(config?.apiUrl).toBe('http://superset.internal:8088')
            expect(config?.publicUrl).toBe('https://dashboard.example.com')
        })
    })

    describe('rebindSupersetZip', () => {
        it('rebinds dataset schema to the instance dataset UUID pattern', () => {
            const initialFiles: Record<string, string> = {
                'metadata.yaml': 'version: 1.0.0\ntype: Dashboard\n',
                'dashboards/verkehr.yaml': 'dashboard_title: Verkehrsfluss\nslug: verkehrsfluss-live\n',
                'datasets/payload_data/verkehrsmessung.yaml':
                    'table_name: verkehrsmessung\nschema: ds_template\ncolumns:\n  - column_name: speed\n',
            }
            const initialZip = createZip(initialFiles)

            const { zipBuffer, dashboardSlug, dashboardTitle } = rebindSupersetZip(initialZip, {
                datasetId: '1584f547-d122-4a19-98e1-21905f6447fd',
            })

            expect(dashboardSlug).toBe('verkehrsfluss-live')
            expect(dashboardTitle).toBe('Verkehrsfluss')

            const reboundFiles = readZip(zipBuffer)
            const datasetYaml = parseYaml(
                reboundFiles['datasets/payload_data/verkehrsmessung.yaml'].toString('utf-8'),
            ) as Record<string, unknown>

            expect(datasetYaml.schema).toBe('ds_1584f547_d122_4a19_98e1_21905f6447fd')
            expect(datasetYaml.table_name).toBe('verkehrsmessung')
        })

        it('supports explicit schema and table bindings', () => {
            const initialZip = createZip({
                'dashboards/custom.yaml': 'dashboard_title: Custom\nslug: custom-view\n',
                'datasets/payload_data/table.yaml': 'table_name: old_table\nschema: old_schema\n',
            })

            const { zipBuffer } = rebindSupersetZip(initialZip, {
                schema: 'ds_${datasetId}',
                table: 'new_table',
                datasetId: 'abc-123',
            })

            const reboundFiles = readZip(zipBuffer)
            const datasetYaml = parseYaml(
                reboundFiles['datasets/payload_data/table.yaml'].toString('utf-8'),
            ) as Record<string, unknown>

            expect(datasetYaml.schema).toBe('ds_abc_123')
            expect(datasetYaml.table_name).toBe('new_table')
        })
    })

    describe('importDashboard', () => {
        it('authenticates, submits multipart upload, and returns dashboard URL', async () => {
            process.env.SUPERSET_API_URL = 'http://localhost:8098'
            const initialZip = createZip({
                'dashboards/verkehr.yaml': 'dashboard_title: Verkehrsfluss\nslug: verkehrsfluss-live\n',
            })

            const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
                if (url.endsWith('/api/v1/security/login')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ access_token: 'test-jwt-token' }),
                    })
                }
                if (url.endsWith('/api/v1/security/csrf_token/')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ result: 'test-csrf-token' }),
                    })
                }
                if (url.endsWith('/api/v1/dashboard/import/')) {
                    expect(init?.method).toBe('POST')
                    expect((init?.headers as Record<string, string>)?.Authorization).toBe(
                        'Bearer test-jwt-token',
                    )
                    expect((init?.headers as Record<string, string>)?.['X-CSRFToken']).toBe(
                        'test-csrf-token',
                    )
                    expect(init?.body).toBeInstanceOf(FormData)
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ message: 'OK' }),
                    })
                }
                return Promise.reject(new Error(`Unexpected URL: ${url}`))
            })

            global.fetch = fetchMock

            const res = await importDashboard(initialZip, {
                datasetId: '1584f547-d122-4a19-98e1-21905f6447fd',
            })

            expect(res.ok).toBe(true)
            expect(res.dashboardTitle).toBe('Verkehrsfluss')
            expect(res.dashboardUrl).toBe('http://localhost:8098/superset/dashboard/verkehrsfluss-live/')
        })

        it('handles import errors gracefully', async () => {
            process.env.SUPERSET_API_URL = 'http://localhost:8098'
            const initialZip = createZip({
                'dashboards/test.yaml': 'dashboard_title: Test\nslug: test\n',
            })

            global.fetch = vi.fn().mockImplementation((url: string) => {
                if (url.endsWith('/api/v1/security/login')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ access_token: 'test-jwt-token' }),
                    })
                }
                if (url.endsWith('/api/v1/security/csrf_token/')) {
                    return Promise.resolve({ ok: false })
                }
                if (url.endsWith('/api/v1/dashboard/import/')) {
                    return Promise.resolve({
                        ok: false,
                        status: 400,
                        statusText: 'Bad Request',
                        text: () => Promise.resolve('Database already exists with different UUID'),
                    })
                }
                return Promise.reject(new Error(`Unexpected URL: ${url}`))
            })

            const res = await importDashboard(initialZip)
            expect(res.ok).toBe(false)
            expect(res.error).toContain('Database already exists')
        })
    })

    describe('deleteDashboard', () => {
        it('calls DELETE /api/v1/dashboard/:id', async () => {
            process.env.SUPERSET_API_URL = 'http://localhost:8098'

            global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
                if (url.endsWith('/api/v1/security/login')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ access_token: 'token' }),
                    })
                }
                if (url.endsWith('/api/v1/dashboard/42')) {
                    expect(init?.method).toBe('DELETE')
                    return Promise.resolve({ ok: true, status: 200 })
                }
                return Promise.reject(new Error(`Unexpected URL: ${url}`))
            })

            const res = await deleteDashboard(42)
            expect(res.ok).toBe(true)
        })
    })
})
