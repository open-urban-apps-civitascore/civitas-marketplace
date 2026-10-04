import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'

import {
    findDatabaseUuid,
    installDashboard,
    missingSupersetSettings,
    openSession,
    supersetConfig,
    type SupersetConfig,
} from '@/lib/superset/client'
import { readZip } from '@/lib/superset/zip'

import { sampleDocument } from './fixtures'

const INSTANCE_DATABASE = '99999999-9999-4999-8999-999999999999'

const config: SupersetConfig = {
    apiUrl: 'http://superset:8088',
    publicUrl: 'https://superset.example.org',
    databaseName: 'PostgreSQL geoserver',
    username: 'marketplace',
    password: 'secret',
}

const SETTINGS = [
    'SUPERSET_API_URL',
    'SUPERSET_PUBLIC_URL',
    'SUPERSET_DATABASE_NAME',
    'SUPERSET_USERNAME',
    'SUPERSET_PASSWORD',
    'SUPERSET_TOKEN',
]

function answer(body: unknown, options: { status?: number; headers?: [string, string][] } = {}) {
    const status = options.status ?? 200
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        headers: new Headers(options.headers ?? []),
        json: async () => body,
        text: async () => JSON.stringify(body),
    }
}

/** A stand-in Superset: answers the endpoints an import uses and records every request. */
function fakeSuperset(options: { uuidInList?: boolean; importStatus?: number } = {}) {
    const requests: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
            requests.push({ url, init })
            if (url.endsWith('/api/v1/security/login')) return answer({ access_token: 'jwt' })
            if (url.endsWith('/api/v1/security/csrf_token/')) {
                return answer({ result: 'csrf' }, { headers: [['set-cookie', 'session=abc; HttpOnly; Path=/']] })
            }
            if (url.includes('/api/v1/database/?q=')) {
                return answer({
                    result: [
                        { id: 3, database_name: 'PostgreSQL geoserver (alt)', uuid: 'not-this-one' },
                        {
                            id: 1,
                            database_name: 'PostgreSQL geoserver',
                            ...(options.uuidInList === false ? {} : { uuid: INSTANCE_DATABASE }),
                        },
                    ],
                })
            }
            if (url.endsWith('/api/v1/database/1')) return answer({ result: { id: 1, uuid: INSTANCE_DATABASE } })
            if (url.endsWith('/api/v1/dashboard/import/')) {
                return options.importStatus
                    ? answer({ errors: [{ message: 'Error importing dashboard' }] }, { status: options.importStatus })
                    : answer({ message: 'OK' })
            }
            throw new Error(`unexpected request ${url}`)
        }),
    )
    return requests
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
})

describe('configuration', () => {
    const clearSettings = () => SETTINGS.forEach((name) => vi.stubEnv(name, ''))

    it('names every missing setting', () => {
        clearSettings()
        expect(missingSupersetSettings()).toEqual([
            'SUPERSET_API_URL',
            'SUPERSET_DATABASE_NAME',
            'SUPERSET_USERNAME/SUPERSET_PASSWORD',
        ])
        expect(supersetConfig()).toBeUndefined()
    })

    it('has no built-in account: user and password, or a token, must be set', () => {
        clearSettings()
        vi.stubEnv('SUPERSET_API_URL', 'http://superset:8088/')
        vi.stubEnv('SUPERSET_DATABASE_NAME', 'PostgreSQL geoserver')
        expect(supersetConfig()).toBeUndefined()

        vi.stubEnv('SUPERSET_TOKEN', 'jwt')
        expect(supersetConfig()).toMatchObject({
            apiUrl: 'http://superset:8088',
            publicUrl: 'http://superset:8088',
            databaseName: 'PostgreSQL geoserver',
            token: 'jwt',
        })
    })
})

describe('openSession', () => {
    it('logs in and carries token, CSRF token and session cookie together', async () => {
        const requests = fakeSuperset()
        const session = await openSession(config)

        expect(session.headers).toMatchObject({
            Authorization: 'Bearer jwt',
            'X-CSRFToken': 'csrf',
            Cookie: 'session=abc',
            Referer: 'http://superset:8088/',
        })
        expect(JSON.parse(String(requests[0].init?.body))).toMatchObject({ provider: 'db', username: 'marketplace' })
    })

    it('skips the login when a token is configured', async () => {
        const requests = fakeSuperset()
        await openSession({ ...config, token: 'preset' })
        expect(requests.map((request) => request.url)).toEqual(['http://superset:8088/api/v1/security/csrf_token/'])
    })
})

describe('findDatabaseUuid', () => {
    it('picks the connection with exactly this name', async () => {
        fakeSuperset()
        const session = await openSession(config)
        expect(await findDatabaseUuid(config, session, 'PostgreSQL geoserver')).toBe(INSTANCE_DATABASE)
    })

    it('reads the UUID from the detail answer when the list leaves it out', async () => {
        fakeSuperset({ uuidInList: false })
        const session = await openSession(config)
        expect(await findDatabaseUuid(config, session, 'PostgreSQL geoserver')).toBe(INSTANCE_DATABASE)
    })

    it('says so when no connection has the name', async () => {
        fakeSuperset()
        const session = await openSession(config)
        await expect(findDatabaseUuid(config, session, 'payload_data')).rejects.toThrow(/payload_data/)
    })
})

describe('installDashboard', () => {
    const ids = {
        installationId: '7f3c2a10-5b6d-4e8f-9a1b-2c3d4e5f6a7b',
        datasetId: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
    }

    it('uploads the bound bundle with the session and links to the new dashboard', async () => {
        const requests = fakeSuperset()
        const result = await installDashboard(sampleDocument(), ids, config)

        const upload = requests.find((request) => request.url.endsWith('/api/v1/dashboard/import/'))!
        expect(upload.init?.method).toBe('POST')
        expect(upload.init?.headers).toMatchObject({ 'X-CSRFToken': 'csrf', Cookie: 'session=abc' })

        const form = upload.init?.body as FormData
        expect(form.get('overwrite')).toBe('true')
        const zip = readZip(Buffer.from(await (form.get('formData') as Blob).arrayBuffer()))
        const dataset = parseYaml(
            zip['dashboard_export/datasets/PostgreSQL_geoserver/verkehrsmessung.yaml'].toString('utf-8'),
        ) as Record<string, unknown>
        expect(dataset.schema).toBe('ds_0a1b2c3d_4e5f_4a6b_8c7d_8e9f0a1b2c3d')
        expect(dataset.database_uuid).toBe(INSTANCE_DATABASE)

        expect(result.title).toBe('Verkehrszählung Live-Monitoring')
        expect(result.url).toBe('https://superset.example.org/superset/dashboard/verkehrszaehlung-live-7f3c2a10/')
    })

    it("passes Superset's own error message on", async () => {
        fakeSuperset({ importStatus: 422 })
        await expect(installDashboard(sampleDocument(), ids, config)).rejects.toThrow(
            'Superset import: 422 Error importing dashboard',
        )
    })

    it('refuses a malformed document before it talks to Superset', async () => {
        const requests = fakeSuperset()
        await expect(installDashboard({ tool: 'superset', assets: {} }, ids, config)).rejects.toThrow(/files/)
        expect(requests).toHaveLength(0)
    })
})
