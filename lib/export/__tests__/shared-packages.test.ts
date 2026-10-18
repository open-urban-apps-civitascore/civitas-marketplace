import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ requireSession: vi.fn(async () => ({ user: { name: 'Test' } })), getAccessToken: vi.fn(async () => 't') }))

import { listSharedPackages } from '@/lib/export-actions'
import { inProgressItems, rowProgress } from '@/lib/export/in-progress-items'
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

/** What the fake GitLab holds beyond the tables above; each part replaces its table. */
interface World {
    botMrs: unknown[]
    openMrs: unknown[]
    files: Record<string, string>
    /** Comments per merge request, newest first. */
    notes: Record<number, { body: string }[]>
    /** The catalogue in a project of its own (8): the bot's requests there, its open requests and its index. */
    catalogue?: { botMrs: unknown[]; openMrs: unknown[]; index: string }
}

/** A GitLab that knows one project, answers from the tables above and writes down every request. */
function fakeGitLab(failing: string[] = [], world: Partial<World> = {}) {
    const { botMrs = BOT_MRS, openMrs = OPEN_MRS, files = FILES, notes = {}, catalogue } = world
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
        if (path === '/projects/7/merge_requests' && query.get('author_id') === '42') return json(botMrs)
        if (path === '/projects/7/merge_requests' && query.get('state') === 'opened') return json(openMrs)
        const notesOf = path.match(/^\/projects\/7\/merge_requests\/(\d+)\/notes$/)?.[1]
        if (notesOf) return json(notes[Number(notesOf)] ?? [])
        if (catalogue) {
            if (path === '/projects/group%2Findex') return json({ id: 8, path_with_namespace: 'group/index', web_url: CATALOGUE_WEB, default_branch: 'main' })
            if (path === '/projects/8/merge_requests' && query.get('author_id') === '42') return json(catalogue.botMrs)
            if (path === '/projects/8/merge_requests' && query.get('state') === 'opened') return json(catalogue.openMrs)
            if (path === '/projects/8/repository/files/index.json/raw') return new Response(catalogue.index, { status: 200 })
        }
        if (path === '/projects/7/repository/branches/main') return json({ commit: { id: HEAD } })
        if (path === '/projects/7/repository/tree') {
            const listing = TREES[`${query.get('ref')}|${query.get('path') ?? ''}`]
            return listing ? json(listing) : json({ message: '404 Tree Not Found' }, 404)
        }
        if (path.startsWith('/projects/7/repository/files/')) {
            const file = decodeURIComponent(path.slice('/projects/7/repository/files/'.length).replace(/\/raw$/, ''))
            const content = files[`${query.get('ref')}|${file}`]
            return content === undefined ? new Response('', { status: 404 }) : new Response(content, { status: 200 })
        }
        if (path === '/projects/7/merge_requests/3/commits') return json([{ id: MERGED_NEW }])
        return json({ message: `404 ${path}` }, 404)
    }) as typeof fetch
    return { fetchImpl, calls }
}

const count = (calls: string[], part: string) => calls.filter((call) => call.includes(part)).length

const CATALOGUE_WEB = 'https://gitlab.example/group/index'

/** A catalogue proposal the bot's merge brought in, as `proposeCatalog` writes it: the description names the package id. */
const listedOnce = (iid: number, version: string) => ({
    iid,
    state: 'merged',
    source_branch: `catalog/baeume-${version}`,
    web_url: `${WEB}/-/merge_requests/${iid}`,
    description: `Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\nAdds \`urn:stadt:usecase:baeume\` in \`useCases\`, pinned to ...`,
})

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
        expect(older.bundle).toMatchObject({ reason: 'other-version', onBase: { id: 'urn:stadt:usecase:baeume', version: '1.1.0' } })
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

    it('takes a version the catalogue team took out for finished, without asking GitLab more', async () => {
        // Listed once through !2, then deleted from the index by hand (cb4d433 on the demo).
        const botMrs = [BOT_MRS[1], listedOnce(2, '1.1.0'), BOT_MRS[3]]
        const gitlab = fakeGitLab([], { botMrs, openMrs: [] })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { rows } = await listSharedPackages()
        const current = rows.find((row) => row.version === '1.1.0')
        expect(current?.catalog).toEqual({ state: 'withdrawn', takenOut: { version: '1.1.0' } })
        expect(rowProgress(current!)).toMatchObject({ finished: true, summary: 'Aus dem Katalog genommen' })
        expect(inProgressItems([], new Set(), rows)).toEqual([])
        // The bot's requests on the catalogue are the ones the target already read: same project, same visit.
        expect(count(gitlab.calls, 'author_id=42')).toBe(1)
        expect(count(gitlab.calls, '/user')).toBe(1)
    })

    it('keeps an open proposal that would bring a taken-out version back in "In Arbeit", as the person’s move', async () => {
        const botMrs = [BOT_MRS[1], listedOnce(2, '1.1.0'), BOT_MRS[3]]
        vi.stubGlobal('fetch', fakeGitLab([], { botMrs }).fetchImpl)
        const { rows } = await listSharedPackages()
        const current = rows.find((row) => row.version === '1.1.0')
        expect(current?.catalog).toEqual({ state: 'mr-open', mrUrl: `${WEB}/-/merge_requests/9`, takenOut: { version: '1.1.0' }, bringsBack: true })
        const [item] = inProgressItems([], new Set(), rows)
        expect(item).toMatchObject({ kind: 'shared', key: current?.key, progress: { turn: 'you', active: 'listing' } })
    })

    it('reads the withdrawal from a catalogue of its own, asking the bot’s account once', async () => {
        vi.stubEnv('REPO_LIST_URL', '')
        vi.stubEnv('CATALOG_REPO_URL', CATALOGUE_WEB)
        const index = JSON.stringify({ version: '1.0.0', useCases: [{ id: 'urn:stadt:usecase:baeume', version: '1.1.0', revoked: true, revokedReason: 'Datenquelle abgeschaltet' }] })
        const gitlab = fakeGitLab([], { catalogue: { botMrs: [], openMrs: [], index } })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { rows } = await listSharedPackages()
        expect(rows.find((row) => row.version === '1.1.0')?.catalog).toEqual({
            state: 'withdrawn',
            takenOut: { version: '1.1.0', reason: 'Datenquelle abgeschaltet' },
        })
        expect(count(gitlab.calls, '/user')).toBe(1)
        expect(count(gitlab.calls, '/projects/8/merge_requests?author_id=42')).toBe(1)
    })

    it('names a closed request withdrawn only with the marketplace’s note, and reads each closed request’s notes once', async () => {
        const closed = (iid: number, slug: string, closedBy: number) => ({
            iid,
            state: 'closed',
            source_branch: `export/${slug}-1.0.0`,
            web_url: `${WEB}/-/merge_requests/${iid}`,
            title: `Export use case: ${slug} 1.0.0`,
            closed_by: { id: closedBy },
            updated_at: '2026-10-17T10:00:00Z',
        })
        const botMrs = [closed(14, 'pegel', 42), closed(13, 'wind', 42), closed(12, 'regen', 99)]
        const notes = {
            14: [{ body: 'Withdrawn through the Open Urban Apps marketplace on behalf of **Ewa**. Sharing the use case again opens a new merge request.' }, { body: 'closed' }],
            // Closed by hand through the bot's account (!3, !5 on the demo): GitLab's own note only.
            13: [{ body: 'closed' }],
        }
        const gitlab = fakeGitLab([], { botMrs, notes })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { rows } = await listSharedPackages()
        const bySlug = Object.fromEntries(rows.map((row) => [row.slug, row]))
        expect(bySlug.pegel.withdrawn).toBe(true)
        expect(rowProgress(bySlug.pegel).summary).toBe('Zurückgezogen')
        expect(bySlug.wind.withdrawn).toBeUndefined()
        expect(rowProgress(bySlug.wind).summary).toBe('Nicht angenommen')
        expect(bySlug.regen.withdrawn).toBeUndefined()
        // Only what the bot closed is read; a reviewer's close needs no notes.
        expect(count(gitlab.calls, '/merge_requests/14/notes')).toBe(1)
        expect(count(gitlab.calls, '/merge_requests/13/notes')).toBe(1)
        expect(count(gitlab.calls, '/merge_requests/12/notes')).toBe(0)

        // A closed request that did not change since is not asked again.
        gitlab.calls.length = 0
        await listSharedPackages()
        expect(count(gitlab.calls, '/notes')).toBe(0)
    })

    it('lists a closed request whose notes cannot be read as not withdrawn, and asks again on the next visit', async () => {
        const botMrs = [
            {
                iid: 14,
                state: 'closed',
                source_branch: 'export/pegel-1.0.0',
                web_url: `${WEB}/-/merge_requests/14`,
                title: 'Export use case: Pegelkarte 1.0.0',
                closed_by: { id: 42 },
                updated_at: '2026-10-17T10:00:00Z',
            },
        ]
        const notes = { 14: [{ body: 'Withdrawn through the Open Urban Apps marketplace on behalf of **Ewa**.' }] }
        vi.stubGlobal('fetch', fakeGitLab(['/notes'], { botMrs, notes }).fetchImpl)
        const { rows, error } = await listSharedPackages()
        expect(error).toBeUndefined()
        expect(rows[0]).toMatchObject({ slug: 'pegel', bundleMr: { state: 'closed' } })
        expect(rows[0].withdrawn).toBeUndefined()

        // The failure was not kept: once GitLab answers, the note counts.
        const gitlab = fakeGitLab([], { botMrs, notes })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        expect((await listSharedPackages()).rows[0].withdrawn).toBe(true)
        expect(count(gitlab.calls, '/merge_requests/14/notes')).toBe(1)
    })

    it('still fails as a whole when the list itself cannot be read', async () => {
        vi.stubGlobal('fetch', fakeGitLab(['author_id=42']).fetchImpl)
        const { rows, error } = await listSharedPackages()
        expect(rows).toEqual([])
        expect(error).toContain('500')
    })
})
