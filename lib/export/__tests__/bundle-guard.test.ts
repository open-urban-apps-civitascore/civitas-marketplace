import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ requireSession: vi.fn(async () => ({ user: { name: 'Test' } })), getAccessToken: vi.fn(async () => 'test-token') }))
vi.mock('@/lib/export/share-permission', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/export/share-permission')>()),
    fetchShareRight: vi.fn(async () => 'allowed'),
}))
vi.mock('@/lib/export/status', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/export/status')>()),
    readBundleStatus: vi.fn(),
}))
vi.mock('@/lib/export/portal-reader', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/export/portal-reader')>()),
    readUseCase: vi.fn(),
}))
vi.mock('@/lib/export/gitlab', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/export/gitlab')>()),
    openMergeRequest: vi.fn(),
}))
// The package's own check has tests of its own; here it only has to let a package through.
vi.mock('@/lib/export/package-check', () => ({ checkPackage: vi.fn(() => []) }))

import { exportAction } from '@/lib/export-actions'
import { openMergeRequest } from '@/lib/export/gitlab'
import { readUseCase } from '@/lib/export/portal-reader'
import { readBundleStatus } from '@/lib/export/status'

const TARGET = 'https://gitlab.example/group/catalog'
const ID = 'urn:stadt:usecase:baeume'
const DIR = 'packages/baeume'

function bundleForm(version = '1.1.0') {
    const data = new FormData()
    const fields = {
        datasetId: 'local', publisher: 'stadt', slug: 'baeume', version, domain: 'environment', displayName: 'Bäume',
        description: 'Stadtbäume', maintainer: 'Stadt', license: 'EUPL-1.2', catalogMetadata: '{}', targetKey: TARGET, intent: 'bundle',
    }
    for (const [key, value] of Object.entries(fields)) data.set(key, value)
    return data
}

interface Catalogue {
    /** `index.json` on the catalogue's base branch. */
    index: string
    /** Merge requests from `catalog/…` branches, any state; the bot's own list holds them too. */
    requests: unknown[]
    /** Files under the package folder on the base branch. */
    folder: string[]
}

/** Target and catalogue in one project (7), as on the demo; reads only - the writes are mocked. */
function fakeGitLab({ index, requests, folder }: Catalogue) {
    const calls: string[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
        const url = new URL(String(input))
        const path = url.pathname.replace(/^\/api\/v4/, '')
        const query = url.searchParams
        calls.push(`${path}${url.search}`)
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
        if (path === '/projects/group%2Fcatalog') return json({ id: 7, path_with_namespace: 'group/catalog', web_url: TARGET, default_branch: 'main' })
        if (path === '/user') return json({ id: 42, username: 'bot' })
        if (path === '/projects/7/merge_requests') {
            const branch = query.get('source_branch')
            return json(branch ? requests.filter((mr) => (mr as { source_branch: string }).source_branch === branch) : requests)
        }
        if (path === '/projects/7/repository/files/index.json/raw') return new Response(index, { status: 200 })
        if (path === '/projects/7/repository/tree' && query.get('path') === DIR) return json(folder.map((file) => ({ id: file, path: file, type: 'blob' })))
        return json({ message: `404 ${path}` }, 404)
    }) as typeof fetch
    return { fetchImpl, calls }
}

const indexOf = (useCases: unknown[] = []) => JSON.stringify({ version: '1.0.0', useCases })

/** A catalogue proposal the bot's merge brought in: the version was listed once. */
const listedOnce = (version: string) => ({
    iid: 8,
    state: 'merged',
    source_branch: `catalog/baeume-${version}`,
    web_url: `${TARGET}/-/merge_requests/8`,
    author: { id: 42 },
    description: `Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\nAdds \`${ID}\` in \`useCases\`, pinned to ...`,
})

/** The base branch holds this package at another version (`readBundleStatus` for a version not proposed yet). */
const holds = (version: string, id = ID) => ({ state: 'none' as const, reason: 'other-version' as const, onBase: { id, version }, detail: `Auf main liegt ${id} ${version}` })

const EMPTY_SNAPSHOT = { dataset: { id: 'local', name: 'Bäume' }, structures: [], sources: [], sinks: [], mappings: [], pipelines: [], warnings: [] }

beforeEach(() => {
    vi.stubEnv('EXPORT_TARGET_REPOS', JSON.stringify([{ label: 'Katalog', url: TARGET, baseBranch: 'main', pathPrefix: 'packages' }]))
    vi.stubEnv('EXPORT_REPO_TOKEN', 'token')
    vi.stubEnv('REPO_LIST_URL', '')
    vi.stubEnv('CATALOG_REPO_URL', '')
    vi.mocked(readUseCase).mockResolvedValue(EMPTY_SNAPSHOT)
    vi.mocked(openMergeRequest).mockResolvedValue({ status: 'created', url: `${TARGET}/-/merge_requests/31`, iid: 31 })
})
afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe('proposing a version that GitLab already has', () => {
    it('does not open a second merge request for a version already on the base branch', async () => {
        vi.mocked(readBundleStatus).mockResolvedValue({ state: 'on-base', sha: 'f'.repeat(40), packageId: 'urn:stadt:usecase:baeume', verification: { state: 'verified' } })
        const result = await exportAction(null, bundleForm())
        expect(result.status).toBe('unchanged')
        expect(result.bundle?.state).toBe('on-base')
        expect(result.detail).toContain('schon angenommen')
        expect(openMergeRequest).not.toHaveBeenCalled()
        // Nothing is built for it either: the platform is not read.
        expect(readUseCase).not.toHaveBeenCalled()
    })

    it('points at the merge request that is already open', async () => {
        vi.mocked(readBundleStatus).mockResolvedValue({ state: 'mr-open', mrUrl: `${TARGET}/-/merge_requests/12` })
        const result = await exportAction(null, bundleForm())
        expect(result.status).toBe('already-open')
        expect(result.mrUrl).toBe(`${TARGET}/-/merge_requests/12`)
        expect(openMergeRequest).not.toHaveBeenCalled()
    })
})

describe('the version rule', () => {
    it('refuses a version that is not newer than the one accepted for the package folder', async () => {
        vi.mocked(readBundleStatus).mockResolvedValue(holds('1.2.0'))
        for (const version of ['1.1.0', '1.2.0']) {
            const result = await exportAction(null, bundleForm(version))
            expect(result.status).toBe('invalid')
            expect(result.detail).toBe('Angenommen ist schon Version 1.2.0. Eine neue Version muss höher sein, zum Beispiel 1.2.1.')
        }
        expect(readUseCase).not.toHaveBeenCalled()
        expect(openMergeRequest).not.toHaveBeenCalled()
    })

    it('refuses a folder that holds another publisher’s package, and asks for another Kurzname', async () => {
        vi.mocked(readBundleStatus).mockResolvedValue(holds('1.0.0', 'urn:andere:usecase:baeume'))
        const result = await exportAction(null, bundleForm('2.0.0'))
        expect(result.status).toBe('invalid')
        expect(result.detail).toContain('anderes Paket')
        expect(result.detail).toContain('anderen Kurznamen')
        expect(openMergeRequest).not.toHaveBeenCalled()
    })

    it('refuses a version the catalogue lists already, or lower than the listed one', async () => {
        vi.stubEnv('REPO_LIST_URL', `${TARGET}/-/raw/main/index.json`)
        vi.mocked(readBundleStatus).mockResolvedValue({ state: 'none', reason: 'no-package' })
        vi.stubGlobal('fetch', fakeGitLab({ index: indexOf([{ id: ID, version: '1.1.0' }]), requests: [], folder: [] }).fetchImpl)
        const same = await exportAction(null, bundleForm('1.1.0'))
        expect(same).toMatchObject({ status: 'invalid', catalog: { state: 'listed' } })
        expect(same.detail).toBe('Version 1.1.0 steht schon im Katalog. Eine neue Version muss höher sein als 1.1.0, zum Beispiel 1.1.1.')
        const lower = await exportAction(null, bundleForm('1.0.5'))
        expect(lower.detail).toBe('Im Katalog steht schon Version 1.1.0. Eine neue Version muss höher sein als 1.1.0, zum Beispiel 1.1.1.')
        expect(openMergeRequest).not.toHaveBeenCalled()
    })

    it('counts a version the catalogue team took out as used up, but lets a higher one through with what happened', async () => {
        vi.stubEnv('REPO_LIST_URL', `${TARGET}/-/raw/main/index.json`)
        vi.mocked(readBundleStatus).mockResolvedValue({ state: 'none', reason: 'no-package' })
        vi.stubGlobal('fetch', fakeGitLab({ index: indexOf(), requests: [listedOnce('1.1.0')], folder: [] }).fetchImpl)
        const again = await exportAction(null, bundleForm('1.1.0'))
        expect(again).toMatchObject({ status: 'invalid', catalog: { state: 'withdrawn', takenOut: { version: '1.1.0' } } })
        expect(again.detail).toBe('Version 1.1.0 war schon im Katalog. Eine neue Version muss höher sein als 1.1.0, zum Beispiel 1.1.1.')
        expect(openMergeRequest).not.toHaveBeenCalled()

        const higher = await exportAction(null, bundleForm('1.2.0'))
        expect(higher).toMatchObject({ status: 'ok', catalog: { state: 'none', takenOut: { version: '1.1.0' } } })
        expect(openMergeRequest).toHaveBeenCalledTimes(1)
    })

    it('lets the same version of a package that never reached the catalogue be proposed again', async () => {
        // Its first proposal was withdrawn: nothing on the base branch, nothing in the catalogue.
        vi.stubEnv('REPO_LIST_URL', `${TARGET}/-/raw/main/index.json`)
        vi.mocked(readBundleStatus).mockResolvedValue({ state: 'none', reason: 'no-package' })
        vi.stubGlobal('fetch', fakeGitLab({ index: indexOf(), requests: [], folder: [] }).fetchImpl)
        const result = await exportAction(null, bundleForm('1.1.0'))
        expect(result.status).toBe('ok')
        expect(openMergeRequest).toHaveBeenCalledTimes(1)
        expect(vi.mocked(openMergeRequest).mock.calls[0][1].deletedPaths).toBeUndefined()
    })
})

describe('a new version in an existing folder', () => {
    it('deletes what the new version no longer has below core-ir/, and nothing else', async () => {
        vi.mocked(readBundleStatus).mockResolvedValue(holds('1.0.0'))
        const folder = [
            `${DIR}/README.md`,
            `${DIR}/ci/validate-bundle.py`,
            `${DIR}/core-ir/manifest.json`,
            `${DIR}/core-ir/structures/alter-baum.json`,
            // Put there by a reviewer, outside what the export writes.
            `${DIR}/docs/hinweise.md`,
        ]
        vi.stubGlobal('fetch', fakeGitLab({ index: indexOf(), requests: [], folder }).fetchImpl)
        const result = await exportAction(null, bundleForm('1.1.0'))
        expect(result.status).toBe('ok')

        const input = vi.mocked(openMergeRequest).mock.calls[0][1]
        expect(input.deletedPaths).toEqual([`${DIR}/core-ir/structures/alter-baum.json`])
        // Written again as updates, so kept.
        expect(input.existingPaths.has(`${DIR}/README.md`)).toBe(true)
        expect(Object.keys(input.files)).toContain(`${DIR}/README.md`)
        expect(input.description).toContain(`removes 1 file below \`core-ir/\` that version 1.1.0 no longer contains: \`${DIR}/core-ir/structures/alter-baum.json\``)
    })
})
