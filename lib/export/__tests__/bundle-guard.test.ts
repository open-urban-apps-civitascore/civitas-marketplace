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
import { proposerOf, readmeSourceOf, shareSourceOf, withdrawalMark } from '@/lib/export/merge-request-text'
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
    /** Comments per merge request, newest first. */
    notes?: Record<number, unknown[]>
}

/** Target and catalogue in one project (7), as on the demo; reads only - the writes are mocked. */
function fakeGitLab({ index, requests, folder, notes = {} }: Catalogue) {
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
        const notesOf = path.match(/^\/projects\/7\/merge_requests\/(\d+)\/notes$/)?.[1]
        if (notesOf) return json(notes[Number(notesOf)] ?? [])
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

describe('a version whose package the catalogue team turned down (R1, 2026-10-22)', () => {
    const declined = {
        iid: 31,
        mrUrl: `${TARGET}/-/merge_requests/31`,
        closedAt: '2026-10-22T10:00:00Z',
        closedBy: 'spaudanjo',
        reason: { kind: 'given' as const, text: 'Die Datenquelle ist nicht öffentlich.' },
    }

    it('is not proposed again, and the refusal names a higher version and carries the reading', async () => {
        vi.stubEnv('REPO_LIST_URL', `${TARGET}/-/raw/main/index.json`)
        vi.mocked(readBundleStatus).mockResolvedValue({ state: 'none', reason: 'no-package', declined, mrUrl: declined.mrUrl })
        vi.stubGlobal('fetch', fakeGitLab({ index: indexOf(), requests: [], folder: [] }).fetchImpl)
        const result = await exportAction(null, bundleForm('1.1.0'))
        expect(result).toMatchObject({ intent: 'bundle', status: 'invalid', mrUrl: declined.mrUrl, bundle: { declined }, catalog: { state: 'none' } })
        expect(result.detail).toBe('Nicht eingereicht: Version 1.1.0 hat das Katalog-Team am 22.10. nicht angenommen. Nimm eine höhere Version, zum Beispiel 1.1.1.')
        // Nothing is built for it: the platform is not read.
        expect(readUseCase).not.toHaveBeenCalled()
        expect(openMergeRequest).not.toHaveBeenCalled()
    })

    it('lets the higher version through', async () => {
        vi.mocked(readBundleStatus).mockResolvedValue({ state: 'none', reason: 'no-package' })
        vi.stubGlobal('fetch', fakeGitLab({ index: indexOf(), requests: [], folder: [] }).fetchImpl)
        expect((await exportAction(null, bundleForm('1.1.1'))).status).toBe('ok')
        expect(openMergeRequest).toHaveBeenCalledTimes(1)
    })

    it('says first what is used up anyway: an accepted or a listed higher version', async () => {
        vi.mocked(readBundleStatus).mockResolvedValue({ ...holds('1.2.0'), declined })
        expect((await exportAction(null, bundleForm('1.1.0'))).detail).toBe('Angenommen ist schon Version 1.2.0. Eine neue Version muss höher sein, zum Beispiel 1.2.1.')
    })

    it('tells a close through the marketplace’s account as such, not as the catalogue team’s decision (S10)', async () => {
        vi.mocked(readBundleStatus).mockResolvedValue({ state: 'none', reason: 'no-package', declined: { ...declined, closedBy: 'walkable.cities.2021', viaMarketplace: true } })
        vi.stubGlobal('fetch', fakeGitLab({ index: indexOf(), requests: [], folder: [] }).fetchImpl)
        expect((await exportAction(null, bundleForm('1.1.0'))).detail).toBe(
            'Nicht eingereicht: Version 1.1.0 wurde am 22.10. nicht angenommen (über das Marktplatz-Konto geschlossen). Nimm eine höhere Version, zum Beispiel 1.1.1.',
        )
    })

    it('tells the "no" in the line „Stand prüfen“ answers with, as a fact and not as good news', async () => {
        vi.stubEnv('REPO_LIST_URL', `${TARGET}/-/raw/main/index.json`)
        vi.mocked(readBundleStatus).mockResolvedValue({ state: 'none', reason: 'no-package', declined, mrUrl: declined.mrUrl })
        vi.stubGlobal('fetch', fakeGitLab({ index: indexOf(), requests: [], folder: [] }).fetchImpl)
        const data = bundleForm('1.1.0')
        data.set('intent', 'status')
        const result = await exportAction(null, data)
        expect(result).toMatchObject({ intent: 'status', status: 'declined', bundle: { declined } })
        expect(result.detail).toBe('Paket nicht angenommen (Vorschlag !31). Noch nicht im Katalog.')
    })

    it('tells a removal turned down in that line, while it is the news (S8)', async () => {
        vi.stubEnv('REPO_LIST_URL', `${TARGET}/-/raw/main/index.json`)
        const accepted = { state: 'on-base' as const, sha: 'f'.repeat(40), packageId: ID, verification: { state: 'verified' as const } }
        vi.mocked(readBundleStatus).mockResolvedValue({ ...accepted, removal: { state: 'closed', mrUrl: `${TARGET}/-/merge_requests/12`, declined: { ...declined, iid: 12 } } })
        const data = bundleForm('1.1.0')
        data.set('intent', 'status')
        vi.stubGlobal('fetch', fakeGitLab({ index: indexOf(), requests: [], folder: [] }).fetchImpl)
        const result = await exportAction(null, data)
        expect(result).toMatchObject({ status: 'declined', detail: 'Paket angenommen. Entfernen nicht angenommen (Vorschlag !12). Noch nicht im Katalog.' })
        // Listed since, the "no" to removing it is no news: the version is in the catalogue.
        vi.stubGlobal('fetch', fakeGitLab({ index: indexOf([{ id: ID, version: '1.1.0' }]), requests: [], folder: [] }).fetchImpl)
        expect(await exportAction(null, data)).toMatchObject({ status: 'ok', detail: 'Paket angenommen. Im Katalog.' })
    })
})

describe('a "no" read from GitLab itself, for the same version (R1, R8)', () => {
    const own = { id: 42 }
    /** The version's first proposal, merged on 2.10., and the removal merged on 11.10. that took it out again. */
    const accepted = { iid: 3, state: 'merged', source_branch: 'export/baeume-1.1.0', web_url: `${TARGET}/-/merge_requests/3`, author: own, created_at: '2026-10-01T10:00:00Z', merged_at: '2026-10-02T10:00:00Z' }
    const removed = { iid: 6, state: 'merged', source_branch: 'remove/baeume-1.1.0', web_url: `${TARGET}/-/merge_requests/6`, author: own, created_at: '2026-10-10T10:00:00Z', merged_at: '2026-10-11T10:00:00Z' }
    const closedAgain = (extra: Record<string, unknown> = {}) => ({
        iid: 9,
        state: 'closed',
        source_branch: 'export/baeume-1.1.0',
        web_url: `${TARGET}/-/merge_requests/9`,
        author: own,
        description: 'Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.',
        created_at: '2026-10-15T10:00:00Z',
        closed_at: '2026-10-16T10:00:00Z',
        updated_at: '2026-10-16T10:00:00Z',
        closed_by: { id: 99, username: 'kurator' },
        user_notes_count: 0,
        ...extra,
    })

    beforeEach(async () => {
        const actual = await vi.importActual<typeof import('@/lib/export/status')>('@/lib/export/status')
        vi.mocked(readBundleStatus).mockImplementation(actual.readBundleStatus)
    })

    it('proposes the same version again after a withdrawal, by its mark or by the note of the time before (R8)', async () => {
        const marked = closedAgain({
            closed_by: own,
            description: `Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\n${withdrawalMark('Ewa', new Date('2026-10-16T10:00:00Z'))}`,
        })
        const noted = closedAgain({ closed_by: own, user_notes_count: 1 })
        const note = { body: 'Withdrawn through the Open Urban Apps marketplace on behalf of **Ewa**.', author: own, created_at: '2026-10-16T10:00:02Z' }
        for (const withdrawn of [marked, noted]) {
            vi.mocked(openMergeRequest).mockClear()
            vi.stubGlobal('fetch', fakeGitLab({ index: indexOf(), requests: [withdrawn], folder: [], notes: { 9: [note] } }).fetchImpl)
            const result = await exportAction(null, bundleForm('1.1.0'))
            expect(result.status).toBe('ok')
            expect(openMergeRequest).toHaveBeenCalledTimes(1)
        }
    })

    it('refuses a "no" to the version shared again after its removal: the old merge no longer beats it', async () => {
        vi.stubGlobal('fetch', fakeGitLab({ index: indexOf(), requests: [closedAgain(), removed, accepted], folder: [] }).fetchImpl)
        const result = await exportAction(null, bundleForm('1.1.0'))
        expect(result).toMatchObject({ status: 'invalid', mrUrl: `${TARGET}/-/merge_requests/9`, bundle: { declined: { iid: 9, closedBy: 'kurator' } } })
        expect(openMergeRequest).not.toHaveBeenCalled()
    })

    it('lets the version be shared again after its removal where the "no" came before it, to a change of the old acceptance', async () => {
        const changeTurnedDown = closedAgain({ created_at: '2026-10-05T10:00:00Z', closed_at: '2026-10-06T10:00:00Z' })
        vi.stubGlobal('fetch', fakeGitLab({ index: indexOf(), requests: [removed, changeTurnedDown, accepted], folder: [] }).fetchImpl)
        expect((await exportAction(null, bundleForm('1.1.0'))).status).toBe('ok')
    })

    it('fails rather than refuses where a close by the account cannot be told from a withdrawal, as its comments cannot be read', async () => {
        const noted = closedAgain({ closed_by: own, user_notes_count: 1 })
        const fake = fakeGitLab({ index: indexOf(), requests: [noted], folder: [] })
        vi.stubGlobal('fetch', (async (input: string | URL | Request, init?: RequestInit) =>
            String(input).includes('/notes') ? new Response(JSON.stringify({ message: 'boom' }), { status: 500 }) : fake.fetchImpl(input, init)) as typeof fetch)
        const result = await exportAction(null, bundleForm('1.1.0'))
        expect(result.status).toBe('error')
        expect(openMergeRequest).not.toHaveBeenCalled()
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

describe('the source line of a package proposal', () => {
    it('names the dataset and this instance, hidden at the end, as the README names them', async () => {
        vi.stubEnv('PORTAL_URL', 'https://portal.example.org/')
        vi.mocked(readBundleStatus).mockResolvedValue({ state: 'none', reason: 'no-package' })
        vi.stubGlobal('fetch', fakeGitLab({ index: indexOf(), requests: [], folder: [] }).fetchImpl)
        expect((await exportAction(null, bundleForm('1.0.0'))).status).toBe('ok')

        const input = vi.mocked(openMergeRequest).mock.calls[0][1]
        // The instance without its trailing slash, the same in both places.
        expect(shareSourceOf(input.description)).toEqual({ kind: 'dataset', id: 'local', instance: 'https://portal.example.org' })
        expect(input.description.trimEnd().split('\n').at(-1)).toMatch(/^<!-- oua-share \{.*\} -->$/)
        expect(readmeSourceOf(input.files[`${DIR}/README.md`])).toEqual(shareSourceOf(input.description))
        // The first line, which the listing reads the proposer from, is untouched.
        expect(proposerOf(input.description)).toBe('Test')
        expect(input.title).toBe('Export use case: Bäume 1.0.0')
    })

    it('names no instance where none is set', async () => {
        vi.stubEnv('PORTAL_URL', '')
        vi.mocked(readBundleStatus).mockResolvedValue({ state: 'none', reason: 'no-package' })
        vi.stubGlobal('fetch', fakeGitLab({ index: indexOf(), requests: [], folder: [] }).fetchImpl)
        await exportAction(null, bundleForm('1.0.0'))
        expect(shareSourceOf(vi.mocked(openMergeRequest).mock.calls[0][1].description)).toEqual({ kind: 'dataset', id: 'local' })
    })
})
