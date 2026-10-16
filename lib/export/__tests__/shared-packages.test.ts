import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ requireSession: vi.fn(async () => ({ user: { name: 'Test' } })), getAccessToken: vi.fn(async () => 't') }))

import { listSharedPackages } from '@/lib/export-actions'
import { SHARE_READS } from '@/lib/export/share-cache'

const HEAD = 'f'.repeat(40)
const MERGED_NEW = 'c'.repeat(40)
const MERGED_OLD = 'a'.repeat(40)
const WEB = 'https://gitlab.example/group/catalog'

/** The bot's merge requests, newest first, as GitLab lists them. */
const BOT_MRS = [
    { iid: 4, state: 'opened', source_branch: 'export/pegel-1.0.0', web_url: `${WEB}/-/merge_requests/4`, title: 'Export use case: Pegelkarte 1.0.0' },
    { iid: 3, state: 'merged', source_branch: 'export/baeume-1.1.0', sha: MERGED_NEW, web_url: `${WEB}/-/merge_requests/3`, title: 'Export use case: Bäume 1.1.0' },
    { iid: 2, state: 'merged', source_branch: 'catalog/baeume-1.0.0', web_url: `${WEB}/-/merge_requests/2` },
    { iid: 1, state: 'merged', source_branch: 'export/baeume-1.0.0', sha: MERGED_OLD, web_url: `${WEB}/-/merge_requests/1`, title: 'Export use case: Bäume 1.0.0' },
]

const OPEN_MRS = [{ iid: 9, state: 'opened', source_branch: 'catalog/baeume-1.1.0', web_url: `${WEB}/-/merge_requests/9` }]

/** Folder listings by `<ref>|<path>`. */
const TREES: Record<string, unknown[]> = {
    [`${HEAD}|packages`]: [{ id: 'T1', name: 'baeume', type: 'tree' }],
    [`${MERGED_NEW}|packages`]: [{ id: 'T1', name: 'baeume', type: 'tree' }],
}

/** Files by `<ref>|<path>`. */
const FILES: Record<string, string> = {
    [`${HEAD}|packages/baeume/core-ir/manifest.json`]: JSON.stringify({ id: 'urn:stadt:usecase:baeume', version: '1.1.0' }),
    'main|index.json': JSON.stringify({ version: '1.0.0', useCases: [] }),
}

/** A GitLab that knows one project, answers from the tables above and writes down every request. */
function fakeGitLab(failing: string[] = []) {
    const calls: string[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
        const url = new URL(String(input))
        const path = url.pathname.replace(/^\/api\/v4/, '')
        const query = url.searchParams
        calls.push(`${path}${url.search}`)
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
        if (failing.some((part) => `${path}${url.search}`.includes(part))) return json({ message: 'boom' }, 500)

        if (path === '/projects/group%2Fcatalog') return json({ id: 7, path_with_namespace: 'group/catalog', web_url: WEB, default_branch: 'main' })
        if (path === '/user') return json({ id: 42, username: 'bot' })
        if (path === '/projects/7/merge_requests' && query.get('author_id') === '42') return json(BOT_MRS)
        if (path === '/projects/7/merge_requests' && query.get('state') === 'opened') return json(OPEN_MRS)
        if (path === '/projects/7/repository/branches/main') return json({ commit: { id: HEAD } })
        if (path === '/projects/7/repository/tree') {
            const listing = TREES[`${query.get('ref')}|${query.get('path') ?? ''}`]
            return listing ? json(listing) : json({ message: '404 Tree Not Found' }, 404)
        }
        if (path.startsWith('/projects/7/repository/files/')) {
            const file = decodeURIComponent(path.slice('/projects/7/repository/files/'.length).replace(/\/raw$/, ''))
            const content = FILES[`${query.get('ref')}|${file}`]
            return content === undefined ? new Response('', { status: 404 }) : new Response(content, { status: 200 })
        }
        if (path === '/projects/7/merge_requests/3/commits') return json([{ id: MERGED_NEW }])
        return json({ message: `404 ${path}` }, 404)
    }) as typeof fetch
    return { fetchImpl, calls }
}

const count = (calls: string[], part: string) => calls.filter((call) => call.includes(part)).length

beforeEach(() => {
    vi.stubEnv('EXPORT_TARGET_REPOS', JSON.stringify([{ label: 'Katalog-Repo', url: WEB, baseBranch: 'main', pathPrefix: 'packages' }]))
    vi.stubEnv('EXPORT_REPO_TOKEN', 'token')
    vi.stubEnv('REPO_LIST_URL', `${WEB}/-/raw/main/index.json`)
    vi.stubEnv('CATALOG_REPO_URL', '')
    SHARE_READS.clear()
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('listSharedPackages', () => {
    it('reports every shared package, newest first, with its state', async () => {
        vi.stubGlobal('fetch', fakeGitLab().fetchImpl)
        const { rows, error } = await listSharedPackages()
        expect(error).toBeUndefined()
        expect(rows.map((row) => `${row.slug} ${row.version}`)).toEqual(['pegel 1.0.0', 'baeume 1.1.0', 'baeume 1.0.0'])

        const [open, current, older] = rows
        expect(open.bundleMr.state).toBe('opened')
        expect(open.bundle).toBeUndefined()
        expect(current.displayName).toBe('Bäume')
        expect(current.bundle).toMatchObject({ state: 'on-base', sha: HEAD, packageId: 'urn:stadt:usecase:baeume', verification: { state: 'verified' } })
        expect(current.catalog).toEqual({ state: 'mr-open', mrUrl: `${WEB}/-/merge_requests/9` })
        // The base branch carries 1.1.0, so the older version is no longer there.
        expect(older.bundle?.state).toBe('none')
        expect(older.bundle?.detail).toContain('1.1.0')
    })

    it('asks what all packages share once per visit, and no question per branch', async () => {
        const gitlab = fakeGitLab()
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        await listSharedPackages()
        const { calls } = gitlab
        // Target and catalogue are the same repository: one lookup.
        expect(count(calls, '/projects/group%2Fcatalog')).toBe(1)
        expect(count(calls, '/repository/branches/main')).toBe(1)
        expect(count(calls, `ref=${HEAD}&path=packages`)).toBe(1)
        expect(count(calls, 'files/index.json')).toBe(1)
        expect(count(calls, 'state=opened')).toBe(1)
        // Both versions of "baeume" read the same manifest at the same commit: once.
        expect(count(calls, 'manifest.json')).toBe(1)
        expect(count(calls, 'source_branch=')).toBe(0)
        expect(calls).toHaveLength(10)
    })

    it('on a second visit asks only what can have changed', async () => {
        const gitlab = fakeGitLab()
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const first = await listSharedPackages()
        gitlab.calls.length = 0
        const second = await listSharedPackages()

        expect(second).toEqual(first)
        // Kept: what the base head, a merged commit and a merged request hold.
        expect(count(gitlab.calls, 'manifest.json')).toBe(0)
        expect(count(gitlab.calls, '/repository/tree')).toBe(0)
        expect(count(gitlab.calls, '/commits')).toBe(0)
        // Asked again: the requests, the base head, the open requests and the index.
        expect(count(gitlab.calls, 'author_id=42')).toBe(1)
        expect(count(gitlab.calls, '/repository/branches/main')).toBe(1)
        expect(count(gitlab.calls, 'files/index.json')).toBe(1)
        expect(gitlab.calls).toHaveLength(6)
    })

    it('keeps the list when one package cannot be read, and says so on that row', async () => {
        vi.stubGlobal('fetch', fakeGitLab([`ref=${MERGED_NEW}&path=packages`]).fetchImpl)
        const { rows, error } = await listSharedPackages()
        expect(error).toBeUndefined()
        expect(rows).toHaveLength(3)
        expect(rows[1].problem).toContain('500')
        expect(rows[1].bundle).toBeUndefined()
        expect(rows[0].problem).toBeUndefined()
        expect(rows[2].problem).toBeUndefined()
    })

    it('still fails as a whole when the list itself cannot be read', async () => {
        vi.stubGlobal('fetch', fakeGitLab(['author_id=42']).fetchImpl)
        const { rows, error } = await listSharedPackages()
        expect(rows).toEqual([])
        expect(error).toContain('500')
    })
})
