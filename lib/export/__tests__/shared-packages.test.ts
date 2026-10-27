import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ requireSession: vi.fn(async () => ({ user: { name: 'Test' } })), getAccessToken: vi.fn(async () => 't') }))

import { getRepoListMeta, getRepoListSummaries, resetRepoListCacheForTests } from '@/lib/catalog/repo-list'
import type { MergeRequestNote } from '@/lib/export/gitlab'
import { inProgressItems, rowProgress } from '@/lib/export/in-progress-items'
import { shareSourceLine, withdrawalMark } from '@/lib/export/merge-request-text'
import { SHARE_READS } from '@/lib/export/share-cache'
import { olderProposalsUrl, readShareListing, servesSameIndex } from '@/lib/export/share-listing'
import { shareTabs } from '@/lib/export/share-tabs'

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
    notes: Record<number, MergeRequestNote[]>
    /** Folder listings by `<ref>|<path>`, where `TREES` is not enough. */
    trees: Record<string, unknown[]>
    /** The catalogue in a project of its own (8): the bot's requests there, its open requests and its index. */
    catalogue?: { botMrs: unknown[]; openMrs: unknown[]; index: string }
    /** The bot's requests page by page, where `botMrs` is one page. */
    pages?: unknown[][]
    /** What the catalogue pages fetch through REPO_LIST_URL. */
    served?: unknown
}

/** A GitLab that knows one project, answers from the tables above and writes down every request. */
function fakeGitLab(failing: string[] = [], world: Partial<World> = {}) {
    const { botMrs = BOT_MRS, openMrs = OPEN_MRS, files = FILES, notes = {}, trees = TREES, catalogue, pages, served } = world
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
        if (path === '/projects/7/merge_requests' && query.get('author_id') === '42') {
            return json(pages ? (pages[Number(query.get('page')) - 1] ?? []) : botMrs)
        }
        if (path === '/group/catalog/-/raw/main/index.json' && served) return json(served)
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
            const listing = trees[`${query.get('ref')}|${query.get('path') ?? ''}`]
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
    vi.stubEnv('MOCK_CATALOG', '')
    vi.stubEnv('PORTAL_URL', 'https://portal.hier.example')
    SHARE_READS.clear()
    resetRepoListCacheForTests()
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('readShareListing', () => {
    it('reports every shared package, newest first, with its state', async () => {
        vi.stubGlobal('fetch', fakeGitLab().fetchImpl)
        const { rows, error } = await readShareListing()
        expect(error).toBeUndefined()
        expect(rows.map((row) => `${row.slug} ${row.version}`)).toEqual(['pegel 1.0.0', 'baeume 1.1.0', 'baeume 1.0.0'])

        const [open, current, older] = rows
        expect(open.bundleMr.state).toBe('opened')
        expect(open.bundle).toBeUndefined()
        expect(current.displayName).toBe('Bäume')
        expect(current.bundle).toMatchObject({ state: 'on-base', sha: HEAD, packageId: 'urn:stadt:usecase:baeume', verification: { state: 'verified' } })
        expect(current.catalog).toEqual({ state: 'mr-open', mrUrl: `${WEB}/-/merge_requests/9` })
        // Where a change after the review would show, built without asking GitLab.
        expect(current.folderUrl).toBe(`${WEB}/-/commits/main/packages/baeume`)
        // The base branch carries 1.1.0, so the older version is no longer there.
        expect(older.bundle?.state).toBe('none')
        expect(older.bundle?.detail).toContain('1.1.0')
        expect(older.bundle).toMatchObject({ reason: 'other-version', onBase: { id: 'urn:stadt:usecase:baeume', version: '1.1.0' } })
    })

    it('asks what all packages share once per visit, and no question per branch', async () => {
        const gitlab = fakeGitLab()
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        await readShareListing()
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
        // Proposed before rc.6, the two merged versions name no source: each README is read once, at its commit.
        expect(count(calls, 'README.md')).toBe(2)
        expect(count(calls, `README.md/raw?ref=${MERGED_NEW}`)).toBe(1)
        expect(count(calls, `README.md/raw?ref=${MERGED_OLD}`)).toBe(1)
        // 10 until rc.5, plus the two READMEs.
        expect(calls).toHaveLength(12)
    })

    it('on a second visit asks only what can have changed', async () => {
        const gitlab = fakeGitLab()
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const first = await readShareListing()
        gitlab.calls.length = 0
        const second = await readShareListing()

        expect(second).toEqual(first)
        // Kept: what the base head, a merged commit and a merged request hold, and the READMEs at their commits.
        expect(count(gitlab.calls, 'manifest.json')).toBe(0)
        expect(count(gitlab.calls, 'README.md')).toBe(0)
        expect(count(gitlab.calls, '/repository/tree')).toBe(0)
        expect(count(gitlab.calls, '/commits')).toBe(0)
        // Kept for the server's life since rc.6: the project and the account (6 calls until rc.5).
        expect(count(gitlab.calls, '/projects/group%2Fcatalog')).toBe(0)
        expect(count(gitlab.calls, '/user')).toBe(0)
        // Asked again: the requests, the base head, the open requests and the index.
        expect(count(gitlab.calls, 'author_id=42')).toBe(1)
        expect(count(gitlab.calls, '/repository/branches/main')).toBe(1)
        expect(count(gitlab.calls, 'files/index.json')).toBe(1)
        expect(count(gitlab.calls, 'state=opened')).toBe(1)
        expect(gitlab.calls).toHaveLength(4)
    })

    it('keeps the list when one package cannot be read, and says so on that row', async () => {
        vi.stubGlobal('fetch', fakeGitLab([`ref=${MERGED_NEW}&path=packages`]).fetchImpl)
        const { rows, error } = await readShareListing()
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
        const { rows } = await readShareListing()
        const current = rows.find((row) => row.version === '1.1.0')
        expect(current?.catalog).toEqual({ state: 'withdrawn', takenOut: { version: '1.1.0' } })
        expect(rowProgress(current!)).toMatchObject({ finished: true, summary: 'Aus dem Katalog genommen' })
        expect(inProgressItems([], new Set(), shareTabs(rows).inProgress)).toEqual([])
        // The bot's requests on the catalogue are the ones the target already read: same project, same visit.
        expect(count(gitlab.calls, 'author_id=42')).toBe(1)
        expect(count(gitlab.calls, '/user')).toBe(1)
    })

    it('reads a listed version’s Herausgeber from the index, and keeps the package’s id for „Im Katalog ansehen“, without asking GitLab more', async () => {
        const index = JSON.stringify({ version: '1.0.0', useCases: [{ id: 'urn:stadt:usecase:baeume', version: '1.1.0', maintainer: 'Stadt Musterstadt' }] })
        const entry = { ...listedOnce(5, '1.1.0'), merged_at: '2026-10-14T10:00:00Z' }
        const gitlab = fakeGitLab([], { botMrs: [BOT_MRS[1], entry, BOT_MRS[2], BOT_MRS[3]], openMrs: [], files: { ...FILES, 'main|index.json': index } })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { rows } = await readShareListing()
        const current = rows.find((row) => row.version === '1.1.0')
        const older = rows.find((row) => row.version === '1.0.0')
        expect(current?.catalog).toEqual({ state: 'listed', maintainer: 'Stadt Musterstadt' })
        expect(current?.packageId).toBe('urn:stadt:usecase:baeume')
        // 1.1.0 took its place in the repository, and is the same package: the same id.
        expect(older?.packageId).toBe('urn:stadt:usecase:baeume')
        // 1.0.0 was in the catalogue through its own entry proposal before 1.1.0 took its place there.
        expect(shareTabs(rows).published.map((tabbed) => [tabbed.row.version, tabbed.listedEarlier])).toEqual([['1.1.0', ['1.0.0']]])
        expect(count(gitlab.calls, 'files/index.json')).toBe(1)
    })

    it('keeps an open proposal that would bring a taken-out version back in "In Arbeit", as the person’s move', async () => {
        const botMrs = [BOT_MRS[1], listedOnce(2, '1.1.0'), BOT_MRS[3]]
        vi.stubGlobal('fetch', fakeGitLab([], { botMrs }).fetchImpl)
        const { rows } = await readShareListing()
        const current = rows.find((row) => row.version === '1.1.0')
        expect(current?.catalog).toEqual({ state: 'mr-open', mrUrl: `${WEB}/-/merge_requests/9`, takenOut: { version: '1.1.0' }, bringsBack: true })
        const [item] = inProgressItems([], new Set(), shareTabs(rows).inProgress)
        expect(item).toMatchObject({ kind: 'shared', key: current?.key, progress: { turn: 'you', active: 'listing' } })
    })

    it('reads the withdrawal from a catalogue of its own, asking the bot’s account once', async () => {
        vi.stubEnv('REPO_LIST_URL', '')
        vi.stubEnv('CATALOG_REPO_URL', CATALOGUE_WEB)
        const index = JSON.stringify({ version: '1.0.0', useCases: [{ id: 'urn:stadt:usecase:baeume', version: '1.1.0', revoked: true, revokedReason: 'Datenquelle abgeschaltet' }] })
        const gitlab = fakeGitLab([], { catalogue: { botMrs: [], openMrs: [], index } })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { rows } = await readShareListing()
        expect(rows.find((row) => row.version === '1.1.0')?.catalog).toEqual({
            state: 'withdrawn',
            takenOut: { version: '1.1.0', reason: 'Datenquelle abgeschaltet' },
        })
        expect(count(gitlab.calls, '/user')).toBe(1)
        expect(count(gitlab.calls, '/projects/8/merge_requests?author_id=42')).toBe(1)
    })

    it('names a closed request withdrawn only with the marketplace’s mark or note, and reads comments only where someone wrote any, once', async () => {
        const closed = (iid: number, slug: string, closedBy: number, extra: Record<string, unknown> = {}) => ({
            iid,
            state: 'closed',
            source_branch: `export/${slug}-1.0.0`,
            web_url: `${WEB}/-/merge_requests/${iid}`,
            title: `Export use case: ${slug} 1.0.0`,
            created_at: '2026-10-16T10:00:00Z',
            closed_by: { id: closedBy, username: closedBy === 42 ? 'bot' : 'kurator' },
            closed_at: '2026-10-17T10:00:00Z',
            updated_at: '2026-10-17T10:00:00Z',
            ...extra,
        })
        const botMrs = [
            // Withdrawn since rc.7: the mark its close wrote says it, no comment is read.
            closed(15, 'wind2', 42, { user_notes_count: 1, description: `Proposed by …\n\n${withdrawalMark('Ewa', new Date('2026-10-17T09:59:59Z'))}` }),
            closed(14, 'pegel', 42, { user_notes_count: 1 }),
            // Closed by hand through the bot's account (!3, !5 on the demo): nobody wrote anything.
            closed(13, 'wind', 42, { user_notes_count: 0 }),
            closed(12, 'regen', 99, { user_notes_count: 1 }),
        ]
        const notes = {
            14: [
                { body: 'Withdrawn through the Open Urban Apps marketplace on behalf of **Ewa**. Sharing the use case again opens a new merge request.', author: { id: 42 }, created_at: '2026-10-17T10:00:01Z' },
                { body: 'closed', system: true, created_at: '2026-10-17T10:00:00Z' },
            ],
            12: [{ body: 'Die Datenquelle ist nicht öffentlich.', author: { id: 99, username: 'kurator' }, created_at: '2026-10-17T09:59:00Z' }],
        }
        const gitlab = fakeGitLab([], { botMrs, notes })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { rows } = await readShareListing()
        const bySlug = Object.fromEntries(rows.map((row) => [row.slug, row]))
        expect(bySlug.wind2.withdrawn).toBe(true)
        expect(bySlug.wind2.proposals?.[0].withdrawnBy).toBe('Ewa')
        expect(bySlug.pegel.withdrawn).toBe(true)
        expect(rowProgress(bySlug.pegel).summary).toBe('Zurückgezogen')
        expect(bySlug.wind.withdrawn).toBeUndefined()
        expect(rowProgress(bySlug.wind).summary).toBe('Nicht angenommen')
        expect(bySlug.wind.proposals?.[0]).toMatchObject({ closedByBot: true, reason: { kind: 'none' } })
        expect(bySlug.regen.withdrawn).toBeUndefined()
        // A reviewer's close is read too, for their words.
        expect(bySlug.regen.proposals?.[0]).toMatchObject({ closedBy: 'kurator', reason: { kind: 'given', text: 'Die Datenquelle ist nicht öffentlich.' } })
        expect(count(gitlab.calls, '/merge_requests/15/notes')).toBe(0)
        expect(count(gitlab.calls, '/merge_requests/14/notes')).toBe(1)
        expect(count(gitlab.calls, '/merge_requests/13/notes')).toBe(0)
        expect(count(gitlab.calls, '/merge_requests/12/notes')).toBe(1)

        // A closed request that did not change since is not asked again.
        gitlab.calls.length = 0
        await readShareListing()
        expect(count(gitlab.calls, '/notes')).toBe(0)
    })

    it('lists a closed request whose notes cannot be read as not withdrawn, with a reason that could not be read, and asks again on the next visit', async () => {
        const botMrs = [
            {
                iid: 14,
                state: 'closed',
                source_branch: 'export/pegel-1.0.0',
                web_url: `${WEB}/-/merge_requests/14`,
                title: 'Export use case: Pegelkarte 1.0.0',
                closed_by: { id: 42 },
                closed_at: '2026-10-17T10:00:00Z',
                updated_at: '2026-10-17T10:00:00Z',
            },
        ]
        const notes = { 14: [{ body: 'Withdrawn through the Open Urban Apps marketplace on behalf of **Ewa**.', author: { id: 42 }, created_at: '2026-10-17T10:00:01Z' }] }
        vi.stubGlobal('fetch', fakeGitLab(['/notes'], { botMrs, notes }).fetchImpl)
        const { rows, error } = await readShareListing()
        expect(error).toBeUndefined()
        expect(rows[0]).toMatchObject({ slug: 'pegel', bundleMr: { state: 'closed' } })
        expect(rows[0].withdrawn).toBeUndefined()
        // Not "ohne Begründung": that would be a claim about the team (U4).
        expect(rows[0].proposals?.[0].reason).toEqual({ kind: 'unreadable' })

        // The failure was not kept: once GitLab answers, the note counts.
        const gitlab = fakeGitLab([], { botMrs, notes })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        expect((await readShareListing()).rows[0].withdrawn).toBe(true)
        expect(count(gitlab.calls, '/merge_requests/14/notes')).toBe(1)
    })

    it('still fails as a whole when the list itself cannot be read', async () => {
        vi.stubGlobal('fetch', fakeGitLab(['author_id=42']).fetchImpl)
        const { rows, error } = await readShareListing()
        expect(rows).toEqual([])
        expect(error).toContain('500')
    })
})

/** A package README as `transform.ts` writes it, naming the dataset and, where it was set, the instance. */
const readme = (instance?: string) =>
    [
        '# Bäume — CORE-IR Use-Case Package',
        '',
        'Stadtbäume',
        '',
        'Exported from a running CIVITAS/CORE instance through the Open Urban Apps',
        'marketplace on 2026-10-01 by Ewa',
        `(dataset \`Bäume\`, id \`ds-baeume\`${instance ? `, instance ${instance}` : ''}).`,
        'Version 1.1.0 · EUPL-1.2 · maintained by Stadt.',
    ].join('\n')

const HERE = 'https://portal.hier.example'
const PEGEL_HEAD = '1'.repeat(40)

/** Pegelkarte as rc.6 proposes it: open, with its source line. */
const SOURCED_PEGEL = {
    ...BOT_MRS[0],
    sha: PEGEL_HEAD,
    description: `Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\n## Pegelkarte 1.0.0\n\n${shareSourceLine({ kind: 'dataset', id: 'ds-pegel', instance: HERE })}`,
}

describe('where a share came from', () => {
    it('reads the source line, and only for an older proposal the README at its commit, once', async () => {
        const files = {
            ...FILES,
            [`${MERGED_NEW}|packages/baeume/README.md`]: readme('https://portal.dev.example/'),
            [`${MERGED_OLD}|packages/baeume/README.md`]: readme(),
            [`${PEGEL_HEAD}|packages/pegel/README.md`]: readme('https://never.read.example'),
        }
        const gitlab = fakeGitLab([], { botMrs: [SOURCED_PEGEL, BOT_MRS[1], BOT_MRS[3]], files })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const listing = await readShareListing()
        expect(listing.instance).toBe(HERE)
        const byVersion = Object.fromEntries(listing.rows.map((row) => [`${row.slug} ${row.version}`, row]))
        expect(byVersion['pegel 1.0.0'].source).toEqual({ kind: 'dataset', id: 'ds-pegel', instance: HERE })
        expect(byVersion['pegel 1.0.0'].proposedBy).toBe('Ewa')
        expect(byVersion['baeume 1.1.0'].source).toEqual({ kind: 'dataset', id: 'ds-baeume', instance: 'https://portal.dev.example/' })
        // Exported where PORTAL_URL was not set: the dataset, but no instance.
        expect(byVersion['baeume 1.0.0'].source).toEqual({ kind: 'dataset', id: 'ds-baeume' })
        expect(count(gitlab.calls, 'packages%2Fpegel%2FREADME.md')).toBe(0)
        expect(count(gitlab.calls, 'README.md')).toBe(2)

        gitlab.calls.length = 0
        await readShareListing()
        expect(count(gitlab.calls, 'README.md')).toBe(0)
    })

    it('leaves the source unknown when the README cannot be read, and asks again next time', async () => {
        vi.stubGlobal('fetch', fakeGitLab(['README.md'], { botMrs: [BOT_MRS[1]] }).fetchImpl)
        const { rows, error } = await readShareListing()
        expect(error).toBeUndefined()
        expect(rows[0].source).toBeUndefined()
        expect(rows[0].problem).toBeUndefined()

        const files = { ...FILES, [`${MERGED_NEW}|packages/baeume/README.md`]: readme(HERE) }
        const gitlab = fakeGitLab([], { botMrs: [BOT_MRS[1]], files })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        expect((await readShareListing()).rows[0].source).toEqual({ kind: 'dataset', id: 'ds-baeume', instance: HERE })
    })
})

describe('the proposals of a version', () => {
    it('lists the package’s and the catalogue entry’s with when and who, newest first, and only entries pinning this folder', async () => {
        const entry = (iid: number, repo: string, extra: Record<string, unknown>) => ({
            iid,
            state: 'closed',
            source_branch: 'catalog/baeume-1.1.0',
            web_url: `${WEB}/-/merge_requests/${iid}`,
            description: `Proposed by the Open Urban Apps marketplace on behalf of **Kim**.\n\nAdds \`urn:stadt:usecase:baeume\` in \`useCases\`, pinned to\n\`${HEAD}\` of ${repo} (path \`packages/baeume\`).`,
            ...extra,
        })
        const botMrs = [
            entry(6, WEB, { created_at: '2026-10-15T09:00:00Z', closed_at: '2026-10-16T09:00:00Z', updated_at: '2026-10-16T09:00:00Z', closed_by: { id: 99, username: 'kurator' }, user_notes_count: 2 }),
            // Another target's package of the same name: its row, not this one.
            entry(5, 'https://gitlab.example/other/repo', { created_at: '2026-10-15T08:00:00Z' }),
            {
                ...BOT_MRS[1],
                created_at: '2026-10-14T09:00:00Z',
                merged_at: '2026-10-14T12:00:00Z',
                merge_user: { id: 99, username: 'kurator' },
                description: 'Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.',
            },
        ]
        const notes = {
            6: [
                // Written after the close, by someone else, or by the reviewer long before the proposal: none of these is the reason.
                { body: 'Schade!', author: { id: 7, username: 'kim' }, created_at: '2026-10-16T09:01:00Z' },
                { body: 'Bitte die Lizenz ergänzen, dann gern noch einmal.', author: { id: 99, username: 'kurator' }, created_at: '2026-10-16T08:59:00Z' },
                { body: 'Sieht gut aus.', author: { id: 99, username: 'kurator' }, created_at: '2026-10-15T08:00:00Z' },
            ],
        }
        const gitlab = fakeGitLab([], { botMrs, openMrs: [], notes })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { rows } = await readShareListing()
        expect(rows).toHaveLength(1)
        expect(rows[0].proposedBy).toBe('Ewa')
        expect(rows[0].proposals).toEqual([
            {
                kind: 'catalog',
                iid: 6,
                url: `${WEB}/-/merge_requests/6`,
                state: 'closed',
                createdAt: '2026-10-15T09:00:00Z',
                closedAt: '2026-10-16T09:00:00Z',
                closedBy: 'kurator',
                proposedBy: 'Kim',
                reason: { kind: 'given', text: 'Bitte die Lizenz ergänzen, dann gern noch einmal.' },
                comments: 2,
            },
            {
                kind: 'bundle',
                iid: 3,
                url: `${WEB}/-/merge_requests/3`,
                state: 'merged',
                createdAt: '2026-10-14T09:00:00Z',
                mergedAt: '2026-10-14T12:00:00Z',
                mergedBy: 'kurator',
                proposedBy: 'Ewa',
            },
        ])
        // A reviewer's close is read once, for their words; the entry of the other target is not this row's.
        expect(count(gitlab.calls, '/notes')).toBe(1)
        // The catalogue's reading of the version takes the "no" from the proposals: no question more.
        expect(rows[0].catalog).toEqual({
            state: 'declined',
            mrUrl: `${WEB}/-/merge_requests/6`,
            declined: {
                iid: 6,
                mrUrl: `${WEB}/-/merge_requests/6`,
                closedAt: '2026-10-16T09:00:00Z',
                closedBy: 'kurator',
                reason: { kind: 'given', text: 'Bitte die Lizenz ergänzen, dann gern noch einmal.' },
            },
        })
    })

    it('reads whom a withdrawal was for, on any proposal the account closed, once', async () => {
        const closedByBot = (iid: number, branch: string) => ({
            iid,
            state: 'closed',
            source_branch: branch,
            web_url: `${WEB}/-/merge_requests/${iid}`,
            closed_by: { id: 42, username: 'bot' },
            closed_at: '2026-10-17T10:00:00Z',
            updated_at: '2026-10-17T10:00:00Z',
        })
        // Bodenfeuchte-like: proposed again after the merge, and that second proposal withdrawn; its removal withdrawn too.
        const botMrs = [closedByBot(21, 'remove/baeume-1.1.0'), closedByBot(20, 'export/baeume-1.1.0'), BOT_MRS[1]]
        const note = {
            body: 'Withdrawn through the Open Urban Apps marketplace on behalf of **Ewa**. The merged package stays in the repository as it is.',
            author: { id: 42 },
            created_at: '2026-10-17T10:00:02Z',
        }
        const gitlab = fakeGitLab([], { botMrs, openMrs: [], notes: { 21: [note], 20: [{ body: 'closed', system: true, created_at: '2026-10-17T10:00:00Z' }] } })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { rows } = await readShareListing()
        expect(rows).toHaveLength(1)
        // The merge is the version's present; the closed duplicate does not make it withdrawn.
        expect(rows[0]).toMatchObject({ bundleMr: { state: 'merged' }, bundle: { state: 'on-base' } })
        expect(rows[0].withdrawn).toBeUndefined()
        const byIid = Object.fromEntries((rows[0].proposals ?? []).map((proposal) => [proposal.iid, proposal]))
        expect(byIid[21]).toMatchObject({ kind: 'removal', closedByBot: true, withdrawnBy: 'Ewa', closedAt: '2026-10-17T10:00:00Z' })
        expect(byIid[20]).toMatchObject({ kind: 'bundle', closedByBot: true })
        expect(byIid[20].withdrawnBy).toBeUndefined()
        expect(count(gitlab.calls, '/notes')).toBe(2)

        gitlab.calls.length = 0
        await readShareListing()
        expect(count(gitlab.calls, '/notes')).toBe(0)
    })
})

describe('a "no" from the catalogue team, as the listing reads it (2026-10-22)', () => {
    const SLUG = 'jungbaumbewaesserung-musterbach'
    const ID = `urn:musterbach:usecase:${SLUG}`
    const MERGED = '3'.repeat(40)
    const line = shareSourceLine({ kind: 'dataset', id: 'ds-musterbach', instance: HERE })
    /** An entry proposal for 1.1.4, closed through the marketplace's account seconds after it was opened, with no comment (!31, !32 on the demo). */
    const closedEntry = (iid: number, createdAt: string, closedAt: string) => ({
        iid,
        state: 'closed',
        source_branch: `catalog/${SLUG}-1.1.4`,
        web_url: `${WEB}/-/merge_requests/${iid}`,
        description: `Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\nAdds \`${ID}\` in \`useCases\`, pinned to\n\`${HEAD}\` of ${WEB} (path \`packages/${SLUG}\`).\n\n${line}`,
        created_at: createdAt,
        closed_at: closedAt,
        updated_at: closedAt,
        closed_by: { id: 42, username: 'walkable.cities.2021' },
        user_notes_count: 0,
    })
    const world = {
        botMrs: [
            closedEntry(32, '2026-10-22T09:41:00Z', '2026-10-22T09:41:28Z'),
            closedEntry(31, '2026-10-22T09:37:00Z', '2026-10-22T09:37:23Z'),
            {
                iid: 30,
                state: 'merged',
                source_branch: `export/${SLUG}-1.1.4`,
                sha: MERGED,
                web_url: `${WEB}/-/merge_requests/30`,
                title: 'Export use case: Jungbaumbewässerung Musterbach 1.1.4',
                description: `Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\n${line}`,
                created_at: '2026-10-21T09:00:00Z',
                merged_at: '2026-10-21T15:00:00Z',
            },
        ],
        openMrs: [],
        files: { [`${HEAD}|packages/${SLUG}/core-ir/manifest.json`]: JSON.stringify({ id: ID, version: '1.1.4' }), 'main|index.json': JSON.stringify({ version: '1.0.0', useCases: [] }) },
        trees: {
            [`${HEAD}|packages`]: [{ id: 'M1', name: SLUG, type: 'tree' }],
            [`${MERGED}|packages`]: [{ id: 'M1', name: SLUG, type: 'tree' }],
        },
    }

    it('reads the 1.1.4 entry as turned down through the marketplace’s account, without a reason and without asking for comments (!31, !32)', async () => {
        const gitlab = fakeGitLab([], world)
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { rows } = await readShareListing()
        expect(rows.map((row) => `${row.slug} ${row.version}`)).toEqual([`${SLUG} 1.1.4`])
        expect(rows[0].catalog).toEqual({
            state: 'declined',
            mrUrl: `${WEB}/-/merge_requests/32`,
            declined: {
                iid: 32,
                mrUrl: `${WEB}/-/merge_requests/32`,
                closedAt: '2026-10-22T09:41:28Z',
                closedBy: 'walkable.cities.2021',
                viaMarketplace: true,
                reason: { kind: 'none' },
            },
        })
        // Nobody wrote anything on them: there is nothing to read.
        expect(count(gitlab.calls, '/notes')).toBe(0)

        const tabs = shareTabs(rows, { instance: HERE, person: 'Ewa', now: Date.parse('2026-10-22T12:00:00Z') })
        // Never again "Katalog-Eintrag vorschlagen" for 1.1.4: the stage turned down, and the person's move to read it.
        expect(tabs.inProgress.map((tabbed) => [tabbed.outcome, tabbed.mine])).toEqual([['entry-declined', true]])
        expect(rowProgress(rows[0]).states).toEqual({ propose: 'done', review: 'done', catalog: 'done', listing: 'declined' })
        expect(tabs.ended.map((entry) => [entry.what, entry.ending, entry.proposal?.iid, entry.proposal?.closedByBot])).toEqual([
            ['catalog', 'not-accepted', 32, true],
            ['catalog', 'not-accepted', 31, true],
        ])
    })

    it('reads a version shared again after its removal from what came since: the old merge does not hide the "no" to it', async () => {
        const pegel = (iid: number, state: string, branch: string, extra: Record<string, unknown>) => ({
            iid,
            state,
            source_branch: branch,
            web_url: `${WEB}/-/merge_requests/${iid}`,
            title: 'Export use case: Pegelkarte 1.0.0',
            description: `Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\n${shareSourceLine({ kind: 'dataset', id: 'ds-pegel', instance: HERE })}`,
            ...extra,
        })
        const botMrs = [
            pegel(9, 'closed', 'export/pegel-1.0.0', { created_at: '2026-10-15T10:00:00Z', closed_at: '2026-10-21T10:00:00Z', closed_by: { id: 99, username: 'kurator' }, user_notes_count: 0 }),
            pegel(6, 'merged', 'remove/pegel-1.0.0', { created_at: '2026-10-10T10:00:00Z', merged_at: '2026-10-11T10:00:00Z' }),
            pegel(3, 'merged', 'export/pegel-1.0.0', { created_at: '2026-10-01T10:00:00Z', merged_at: '2026-10-02T10:00:00Z' }),
        ]
        vi.stubGlobal('fetch', fakeGitLab([], { botMrs, openMrs: [] }).fetchImpl)
        const { rows } = await readShareListing()
        expect(rows.map((row) => [row.version, row.bundleMr])).toEqual([['1.0.0', { url: `${WEB}/-/merge_requests/9`, state: 'closed' }]])
        const tabs = shareTabs(rows, { instance: HERE, person: 'Ewa', now: Date.parse('2026-10-22T12:00:00Z') })
        expect(tabs.inProgress.map((tabbed) => [tabbed.outcome, tabbed.mine, tabbed.declined?.decline.iid])).toEqual([['declined', true, 9]])
        // The removal stays an ending of its own, next to the "no".
        expect(tabs.ended.map((entry) => [entry.what, entry.ending, entry.proposal?.iid])).toEqual([
            ['bundle', 'not-accepted', 9],
            ['removal', 'removed', 6],
        ])
    })
})

describe('how much is listed', () => {
    it('pages through the account’s proposals, newest created first, 100 at a time and at most three pages, and lists every version', async () => {
        const page = (n: number) =>
            Array.from({ length: 100 }, (_, i) => ({ iid: n * 100 + i + 1, state: 'opened', source_branch: `export/paket${n}x${i}-1.0.0`, web_url: `${WEB}/-/merge_requests/${n * 100 + i + 1}` }))
        const gitlab = fakeGitLab([], { pages: [page(0), page(1), page(2), page(3)], openMrs: [] })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { rows, error } = await readShareListing()
        expect(error).toBeUndefined()
        const asked = gitlab.calls.filter((call) => call.includes('author_id=42'))
        expect(asked).toHaveLength(3)
        asked.forEach((call, index) => {
            expect(call).toContain('order_by=created_at&sort=desc&per_page=100')
            expect(call).toContain(`page=${index + 1}`)
        })
        // No cut-off at 15 any more.
        expect(rows).toHaveLength(300)
        expect(rows[0].slug).toBe('paket0x0')
    })

    it('says where GitLab keeps the account’s older proposals once it stopped at three full pages, by the account’s name', async () => {
        const page = (n: number) =>
            Array.from({ length: 100 }, (_, i) => ({ iid: n * 100 + i + 1, state: 'closed', source_branch: `export/paket${n}x${i}-1.0.0`, web_url: `${WEB}/-/merge_requests/${n * 100 + i + 1}` }))
        const gitlab = fakeGitLab([], { pages: [page(0), page(1), page(2), page(3)], openMrs: [] })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { older } = await readShareListing()
        expect(older).toBe(`${WEB}/-/merge_requests?scope=all&state=all&author_username=bot`)
        // Nothing more asked for it: the project and the account are read anyway.
        expect(count(gitlab.calls, '/user')).toBe(1)
    })

    it('stops at the first page that is not full, and then knows of nothing older', async () => {
        const gitlab = fakeGitLab([], { pages: [BOT_MRS] })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { older } = await readShareListing()
        expect(count(gitlab.calls, 'author_id=42')).toBe(1)
        expect(older).toBeUndefined()
    })

    it('builds the address of the older proposals from the project and the account', () => {
        expect(olderProposalsUrl('https://gitlab.example/group/sub/project/', 'walkable.cities.2021')).toBe(
            'https://gitlab.example/group/sub/project/-/merge_requests?scope=all&state=all&author_username=walkable.cities.2021',
        )
        expect(olderProposalsUrl('https://gitlab.example/g/p', 'a b')).toBe('https://gitlab.example/g/p/-/merge_requests?scope=all&state=all&author_username=a%20b')
    })

    it('keeps what 300 accepted packages need, so the next visit asks only what can have changed', async () => {
        // 300 packages on the base branch, each merged at a commit of its own: about four answers each to keep.
        const shaOf = (n: number) => (n + 1).toString(16).padStart(40, '0')
        const mrs = Array.from({ length: 300 }, (_, n) => ({
            iid: n + 1,
            state: 'merged',
            source_branch: `export/p${n}-1.0.0`,
            sha: shaOf(n),
            web_url: `${WEB}/-/merge_requests/${n + 1}`,
        }))
        const folders = mrs.map((_, n) => ({ id: `T${n}`, name: `p${n}`, type: 'tree' }))
        const calls: string[] = []
        const fetchImpl = (async (input: string | URL | Request) => {
            const url = new URL(String(input))
            const path = url.pathname.replace(/^\/api\/v4/, '')
            const query = url.searchParams
            const page = Number(query.get('page') ?? 1)
            calls.push(`${path}${url.search}`)
            const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
            if (path === '/projects/group%2Fcatalog') return json({ id: 7, path_with_namespace: 'group/catalog', web_url: WEB, default_branch: 'main' })
            if (path === '/user') return json({ id: 42, username: 'bot' })
            if (path === '/projects/7/merge_requests' && query.get('author_id') === '42') return json(mrs.slice((page - 1) * 100, page * 100))
            if (path === '/projects/7/merge_requests' && query.get('state') === 'opened') return json([])
            if (path === '/projects/7/repository/branches/main') return json({ commit: { id: HEAD } })
            if (path === '/projects/7/repository/tree') {
                const ref = query.get('ref')
                if (ref === HEAD) return json(folders.slice((page - 1) * 100, page * 100))
                const n = mrs.findIndex((mr) => mr.sha === ref)
                return json(n >= 0 && page === 1 ? [folders[n]] : [])
            }
            const commits = path.match(/^\/projects\/7\/merge_requests\/(\d+)\/commits$/)?.[1]
            if (commits) return json([{ id: shaOf(Number(commits) - 1) }])
            if (path === '/projects/7/repository/files/index.json/raw') return new Response(JSON.stringify({ version: '1.0.0', useCases: [] }), { status: 200 })
            const file = path.match(/^\/projects\/7\/repository\/files\/(.+)\/raw$/)?.[1]
            const named = file && decodeURIComponent(file).match(/^packages\/(p\d+)\/(core-ir\/manifest\.json|README\.md)$/)
            if (named && named[2] === 'README.md') return new Response(readme(HERE), { status: 200 })
            if (named) return new Response(JSON.stringify({ id: `urn:stadt:usecase:${named[1]}`, version: '1.0.0' }), { status: 200 })
            return new Response(JSON.stringify({ message: `404 ${path}` }), { status: 404 })
        }) as typeof fetch
        vi.stubGlobal('fetch', fetchImpl)

        const first = await readShareListing()
        expect(first.rows).toHaveLength(300)
        expect(first.rows.every((row) => row.bundle?.state === 'on-base' && row.bundle.verification?.state === 'verified')).toBe(true)
        expect(SHARE_READS.size).toBeGreaterThan(1000)

        calls.length = 0
        expect(await readShareListing()).toEqual(first)
        // Three pages of proposals, the base head, the open requests and the index: nothing kept was pushed out.
        expect(calls).toHaveLength(6)
    })
})

describe('the catalogue pages’ copy of the index', () => {
    const index = (version: string, updatedAt = '2026-10-01T00:00:00Z') => ({ version, updatedAt, useCases: [] })
    const listingSees = (seen: unknown) => ({ ...FILES, 'main|index.json': JSON.stringify(seen) })
    const fetchesOfTheCatalogue = (calls: string[]) => count(calls, '/-/raw/main/index.json')

    it('is fetched again once the listing saw a newer index of the same project and branch', async () => {
        const gitlab = fakeGitLab([], { served: index('1.0.0'), files: listingSees(index('1.0.1')) })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        await getRepoListSummaries('usecase')
        await getRepoListSummaries('usecase')
        expect(fetchesOfTheCatalogue(gitlab.calls)).toBe(1)

        await readShareListing()
        const meta = await getRepoListMeta()
        expect(fetchesOfTheCatalogue(gitlab.calls)).toBe(2)
        // Fetched afresh, so not flagged stale.
        expect(meta.stale).toBe(false)
    })

    it('counts a later updatedAt as newer too, and leaves the same index alone', async () => {
        const later = fakeGitLab([], { served: index('1.0.0'), files: listingSees(index('1.0.0', '2026-10-02T00:00:00Z')) })
        vi.stubGlobal('fetch', later.fetchImpl)
        await getRepoListSummaries('usecase')
        await readShareListing()
        await getRepoListSummaries('usecase')
        expect(fetchesOfTheCatalogue(later.calls)).toBe(2)

        resetRepoListCacheForTests()
        const same = fakeGitLab([], { served: index('1.0.0'), files: listingSees(index('1.0.0')) })
        vi.stubGlobal('fetch', same.fetchImpl)
        await getRepoListSummaries('usecase')
        await readShareListing()
        await getRepoListSummaries('usecase')
        expect(fetchesOfTheCatalogue(same.calls)).toBe(1)
    })

    it('is left alone in mock mode', async () => {
        const gitlab = fakeGitLab([], { served: index('1.0.0'), files: listingSees(index('1.0.1')) })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        await getRepoListSummaries('usecase')
        vi.stubEnv('MOCK_CATALOG', '1')
        await readShareListing()
        vi.stubEnv('MOCK_CATALOG', '')
        await getRepoListSummaries('usecase')
        expect(fetchesOfTheCatalogue(gitlab.calls)).toBe(1)
    })

    it('is the listing’s only where REPO_LIST_URL names the same project and branch', () => {
        const repo = { url: WEB, baseBranch: 'main' }
        expect(servesSameIndex(repo, { REPO_LIST_URL: `${WEB}/-/raw/main/index.json` })).toBe(true)
        // GitLab finds a project whatever the case of its path.
        expect(servesSameIndex(repo, { REPO_LIST_URL: 'https://gitlab.example/Group/Catalog/-/raw/main/index.json' })).toBe(true)
        expect(servesSameIndex(repo, { REPO_LIST_URL: `${WEB}/-/raw/next/index.json` })).toBe(false)
        expect(servesSameIndex(repo, { REPO_LIST_URL: 'https://gitlab.example/group/other/-/raw/main/index.json' })).toBe(false)
        expect(servesSameIndex(repo, { REPO_LIST_URL: 'https://cdn.example/index.json' })).toBe(false)
        expect(servesSameIndex(repo, {})).toBe(false)
    })
})

describe('the tabs, fed from the listing', () => {
    it('shows this instance’s shares, counts another’s, and knows which datasets are busy', async () => {
        const files = { ...FILES, [`${MERGED_NEW}|packages/baeume/README.md`]: readme('https://portal.dev.example') }
        vi.stubGlobal('fetch', fakeGitLab([], { botMrs: [SOURCED_PEGEL, BOT_MRS[1], BOT_MRS[3]], files }).fetchImpl)
        const listing = await readShareListing()
        const tabs = shareTabs(listing.rows, { instance: listing.instance, person: 'Ewa' })
        expect(tabs.inProgress.map((tabbed) => tabbed.row.slug)).toEqual(['pegel'])
        // Bäume 1.1.0 waits for its entry, but came from dev; 1.0.0 was replaced by it.
        expect(tabs.elsewhere).toEqual({ 'in-progress': 1, published: 0, ended: 0 })
        expect([...tabs.busy.keys()]).toEqual(['ds-pegel'])
        expect(tabs.counts).toEqual({ inProgress: 1, published: 0 })
    })
})
