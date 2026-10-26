import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ requireSession: vi.fn(async () => ({ user: { name: 'Test' } })), getAccessToken: vi.fn(async () => 't') }))
vi.mock('@/lib/export/share-permission', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/export/share-permission')>()),
    fetchShareRight: vi.fn(async () => 'allowed'),
}))

import { deleteShare, planShareDeletion, proposeSharedCatalogEntry } from '@/lib/export-actions'
import type { MergeRequestNote } from '@/lib/export/gitlab'
import { readShareListing } from '@/lib/export/share-listing'
import { shareSourceLine, shareSourceOf, withdrawalMarkIn, withdrawerOf } from '@/lib/export/merge-request-text'
import { SHARE_READS } from '@/lib/export/share-cache'
import type { DeletionScope } from '@/lib/export/share-deletion'
import { fetchShareRight } from '@/lib/export/share-permission'

const WEB = 'https://gitlab.example/group/catalog'
const HEAD = 'f'.repeat(40)
/** The merge commit of the version's export, and its first parent: the base branch before it. */
const MERGE = 'e'.repeat(40)
const BEFORE = 'b'.repeat(40)
const MERGED_HEAD = 'c'.repeat(40)
/** A second merge of the same branch, and the base branch before that one. */
const MERGE_AGAIN = 'd'.repeat(40)
const BEFORE_AGAIN = 'a'.repeat(40)
const DIR = 'packages/baeume'

const mr = (iid: number, state: string, branch: string, extra: Record<string, unknown> = {}) => ({
    iid,
    state,
    source_branch: branch,
    source_project_id: 7,
    web_url: `${WEB}/-/merge_requests/${iid}`,
    author: { id: 42 },
    description: 'Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\n## Bäume',
    ...extra,
})

/** A catalogue proposal as `proposeCatalog` writes it: it names the repository and folder it pins. */
const catalogMr = (iid: number, repo = WEB, dir = DIR, state = 'opened') =>
    mr(iid, state, 'catalog/baeume-1.1.0', { description: `Proposed by ...\n\nAdds \`urn:stadt:usecase:baeume\` in \`useCases\`, pinned to\n\`${HEAD}\` of ${repo} (path \`${dir}\`).` })

/** The note `withdrawalNote` left on what it closed until rc.6, two seconds after the close at 10:00. */
const WITHDRAWAL_NOTE = {
    body: 'Withdrawn through the Open Urban Apps marketplace on behalf of **Ewa**. Sharing the use case again opens a new merge request.',
    author: { id: 42 },
    created_at: '2026-10-17T10:00:02Z',
}

const MERGED_EXPORT = mr(3, 'merged', 'export/baeume-1.1.0', { sha: MERGED_HEAD, merge_commit_sha: MERGE, title: 'Export use case: Bäume 1.1.0' })
const manifest = (version: string) => JSON.stringify({ id: 'urn:stadt:usecase:baeume', version })
const index = (useCases: unknown[] = []) => JSON.stringify({ version: '1.0.0', useCases })

interface World {
    exportMrs: unknown[]
    removalMrs: unknown[]
    catalogMrs: unknown[]
    /** Blob ids under the package folder, by ref. */
    blobs: Record<string, Record<string, string>>
    /** File contents by `<ref>|<path>`. */
    files: Record<string, string>
    /** Commit parents, first parent first. */
    parents: Record<string, string[]>
    /** Comments per merge request, newest first. */
    notes?: Record<number, MergeRequestNote[]>
    /** `<METHOD> <path>` parts that answer 500. */
    failing?: string[]
    /** Branches besides the base branch that exist, by name. */
    branches?: string[]
}

function world(overrides: Partial<World> = {}): World {
    return {
        exportMrs: [MERGED_EXPORT],
        removalMrs: [],
        catalogMrs: [],
        blobs: { [HEAD]: { [`${DIR}/README.md`]: 'readme', [`${DIR}/core-ir/manifest.json`]: 'm-new' } },
        files: { [`${HEAD}|${DIR}/core-ir/manifest.json`]: manifest('1.1.0'), 'main|index.json': index() },
        parents: { [MERGE]: [BEFORE, MERGED_HEAD] },
        ...overrides,
    }
}

interface Call {
    method: string
    path: string
    body?: Record<string, unknown>
}

/** A GitLab with one project (7) that is target and catalogue at once; it writes down every request. */
function fakeGitLab(state: World) {
    const calls: Call[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input))
        const path = url.pathname.replace(/^\/api\/v4/, '')
        const query = url.searchParams
        const method = init?.method ?? 'GET'
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
        calls.push({ method, path: `${path}${url.search}`, body })
        const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status })
        if (state.failing?.some((part) => `${method} ${path}`.includes(part))) return json({ message: 'boom' }, 500)

        if (method === 'GET') {
            if (path === '/projects/group%2Fcatalog') {
                return json({ id: 7, path_with_namespace: 'group/catalog', web_url: WEB, default_branch: 'main', permissions: { project_access: { access_level: 40 } } })
            }
            if (path === '/user') return json({ id: 42, username: 'bot' })
            if (path === '/projects/7/merge_requests') {
                const branch = query.get('source_branch')
                if (branch?.startsWith('export/')) return json(state.exportMrs)
                if (branch?.startsWith('remove/')) return json(state.removalMrs)
                if (branch?.startsWith('catalog/')) return json(state.catalogMrs)
                if (query.get('author_id') === '42') return json([...state.removalMrs, ...state.catalogMrs, ...state.exportMrs])
                if (query.get('state') === 'opened') {
                    return json([...state.exportMrs, ...state.removalMrs, ...state.catalogMrs].filter((request) => (request as { state: string }).state === 'opened'))
                }
            }
            if (path === '/projects/7/repository/branches/main') return json({ commit: { id: HEAD } })
            const branch = path.startsWith('/projects/7/repository/branches/') ? decodeURIComponent(path.slice('/projects/7/repository/branches/'.length)) : undefined
            if (branch && state.branches?.includes(branch)) return json({ commit: { id: 'old' } })
            if (branch) return json({ message: '404 Branch Not Found' }, 404)
            if (path === '/projects/7/repository/tree') {
                const ref = query.get('ref') ?? ''
                if (query.get('recursive') === 'true') {
                    return json(Object.entries(state.blobs[ref] ?? {}).map(([file, id]) => ({ id, path: file, type: 'blob' })))
                }
                if (query.get('path') === 'packages' && (ref === HEAD || ref === MERGED_HEAD)) return json([{ id: 'T1', name: 'baeume', type: 'tree' }])
                return json({ message: '404 Tree Not Found' }, 404)
            }
            if (path.startsWith('/projects/7/repository/files/')) {
                const file = decodeURIComponent(path.slice('/projects/7/repository/files/'.length).replace(/\/raw$/, ''))
                const content = state.files[`${query.get('ref')}|${file}`]
                return content === undefined ? new Response('', { status: 404 }) : new Response(content, { status: 200 })
            }
            const notesOf = path.match(/^\/projects\/7\/merge_requests\/(\d+)\/notes$/)?.[1]
            if (notesOf) return json(state.notes?.[Number(notesOf)] ?? [])
            const commit = path.match(/^\/projects\/7\/repository\/commits\/([0-9a-f]{40})$/)?.[1]
            if (commit && state.parents[commit]) return json({ id: commit, parent_ids: state.parents[commit] })
            if (/^\/projects\/7\/merge_requests\/\d+\/commits$/.test(path)) return json([{ id: MERGED_HEAD }])
        }
        if (method === 'POST' && /^\/projects\/7\/merge_requests\/\d+\/notes$/.test(path)) return json({ id: 1 })
        if (method === 'PUT' && /^\/projects\/7\/merge_requests\/\d+$/.test(path)) return json({ state: 'closed' })
        if (method === 'DELETE' && path.startsWith('/projects/7/repository/branches/')) return new Response(null, { status: 204 })
        if (method === 'POST' && path === '/projects/7/repository/commits') return json({ id: 'new' })
        if (method === 'POST' && path === '/projects/7/merge_requests') {
            return json({ iid: 30, state: 'opened', source_branch: body?.source_branch, web_url: `${WEB}/-/merge_requests/30` })
        }
        return json({ message: `unrouted ${method} ${path}` }, 404)
    }) as typeof fetch
    return { fetchImpl, calls }
}

const writes = (calls: Call[]) => calls.filter((call) => call.method !== 'GET')
const sent = (calls: Call[]) => writes(calls).map((call) => `${call.method} ${call.path}`)

/**
 * Plans, then withdraws with the plan's own fingerprint, as the dialog does:
 * the default plan, or with `scope` the plan of that option of the choice.
 */
async function planAndDelete(state: World, slug = 'baeume', version = '1.1.0', scope?: DeletionScope) {
    const gitlab = fakeGitLab(state)
    vi.stubGlobal('fetch', gitlab.fetchImpl)
    const answer = await planShareDeletion(WEB, slug, version)
    expect(answer.error).toBeUndefined()
    const plan = scope ? [answer.plan, answer.alternative].find((candidate) => candidate?.scope === scope) : answer.plan
    expect(plan).toBeDefined()
    gitlab.calls.length = 0
    const result = await deleteShare(WEB, slug, version, plan!.fingerprint, scope)
    return { plan: plan!, result, calls: gitlab.calls }
}

async function planOf(state: World, slug = 'baeume', version = '1.1.0') {
    const gitlab = fakeGitLab(state)
    vi.stubGlobal('fetch', gitlab.fetchImpl)
    const { plan, error } = await planShareDeletion(WEB, slug, version)
    expect(error).toBeUndefined()
    return plan!
}

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
    vi.mocked(fetchShareRight).mockResolvedValue('allowed')
})

describe('deleting a version that waits for review', () => {
    const waiting = () => world({ exportMrs: [mr(4, 'opened', 'export/pegel-1.0.0', { title: 'Export use case: Pegelkarte 1.0.0' })] })

    it('withdraws the merge request: the close first, then a note on whose behalf, then its branch', async () => {
        const { plan, result, calls } = await planAndDelete(waiting(), 'pegel', '1.0.0')
        expect(plan).toMatchObject({ kind: 'withdraw', closes: [{ what: 'bundle', ref: '!4', url: `${WEB}/-/merge_requests/4` }], proposedBy: 'Ewa' })
        expect(result).toMatchObject({ status: 'ok', mrUrl: `${WEB}/-/merge_requests/4` })
        expect(result.detail).toBe('Vorschlag !4 ist geschlossen - das Teilen ist zurückgezogen.')

        expect(sent(calls)).toEqual([
            'PUT /projects/7/merge_requests/4',
            'POST /projects/7/merge_requests/4/notes',
            'DELETE /projects/7/repository/branches/export%2Fpegel-1.0.0',
        ])
        // The close carries the mark that tells the listing it was withdrawn, not turned down.
        const close = writes(calls)[0].body as { state_event: string; description: string }
        expect(close.state_event).toBe('close')
        expect(close.description.startsWith('Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\n## Bäume\n\n')).toBe(true)
        expect(close.description.split('\n').at(-1)).toMatch(/^Withdrawn through the Open Urban Apps marketplace on behalf of \*\*Test\*\* at \S+Z\.$/)
        expect(withdrawalMarkIn(close.description, new Date().toISOString())).toBe('Test')
        expect(writes(calls)[1].body?.body).toContain('on behalf of **Test**')
    })

    it('fails as a whole, visibly, when the close with its mark is refused, and writes nothing else', async () => {
        const { result, calls } = await planAndDelete(world({ ...waiting(), failing: ['PUT /projects/7/merge_requests/4'] }), 'pegel', '1.0.0')
        expect(result.status).toBe('error')
        expect(result.detail).toContain('500')
        expect(sent(calls)).toEqual(['PUT /projects/7/merge_requests/4'])
    })

    it('says when the share is someone else’s, outside the fingerprint', async () => {
        const plan = await planOf(waiting(), 'pegel', '1.0.0')
        expect(plan).toMatchObject({ proposedBy: 'Ewa', byOther: true })
        const own = await planOf(world({ exportMrs: [mr(4, 'opened', 'export/pegel-1.0.0', { description: 'Proposed by the Open Urban Apps marketplace on behalf of **Test**.' })] }), 'pegel', '1.0.0')
        expect(own.byOther).toBeUndefined()
        // The same plan for everyone: who asks does not change what is confirmed.
        expect(own.fingerprint).toBe(plan.fingerprint)
    })

    it('closes nothing it did not open itself', async () => {
        const gitlab = fakeGitLab(world({ exportMrs: [mr(4, 'opened', 'export/pegel-1.0.0', { author: { id: 99 } })] }))
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { plan } = await planShareDeletion(WEB, 'pegel', '1.0.0')
        expect(plan).toMatchObject({ kind: 'none', closes: [], mrUrl: `${WEB}/-/merge_requests/4` })
        expect(plan?.reason).toContain('nicht über diesen Marktplatz')
        const result = await deleteShare(WEB, 'pegel', '1.0.0', plan!.fingerprint)
        expect(result.status).toBe('unchanged')
        expect(writes(gitlab.calls)).toEqual([])
    })

    it('does nothing when GitLab changed since the person was shown the plan', async () => {
        const gitlab = fakeGitLab(waiting())
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const result = await deleteShare(WEB, 'pegel', '1.0.0', 'what-the-dialog-showed-earlier')
        expect(result.status).toBe('changed')
        expect(result.plan?.kind).toBe('withdraw')
        expect(writes(gitlab.calls)).toEqual([])
    })

    it('needs the right to share, like proposing', async () => {
        vi.mocked(fetchShareRight).mockResolvedValue('refused')
        const gitlab = fakeGitLab(waiting())
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const result = await deleteShare(WEB, 'pegel', '1.0.0', 'any')
        expect(result.status).toBe('forbidden')
        expect(gitlab.calls).toEqual([])
    })

    it('refuses arguments no shared version could have', async () => {
        expect((await planShareDeletion(WEB, '../etc', '1.0.0')).error).toContain('Ungültig')
        expect((await deleteShare('https://elsewhere.example/x/y', 'baeume', '1.0.0', 'any')).status).toBe('unconfigured')
    })
})

describe('deleting a merged version', () => {
    it('proposes removing a first version, after withdrawing its open catalogue proposal, when the person chose both', async () => {
        const { plan, result, calls } = await planAndDelete(world({ catalogMrs: [catalogMr(9)] }), 'baeume', '1.1.0', 'version')
        expect(plan).toMatchObject({
            kind: 'remove',
            closes: [{ what: 'catalog', ref: '!9' }],
            removal: { folder: DIR, previous: false, files: 2, mergedUrl: `${WEB}/-/merge_requests/3` },
        })

        expect(sent(calls)).toEqual([
            'PUT /projects/7/merge_requests/9',
            'POST /projects/7/merge_requests/9/notes',
            'DELETE /projects/7/repository/branches/catalog%2Fbaeume-1.1.0',
            'POST /projects/7/repository/commits',
            'POST /projects/7/merge_requests',
        ])
        const commit = writes(calls)[3].body as { branch: string; actions: unknown[] }
        expect(commit.branch).toBe('remove/baeume-1.1.0')
        expect(commit.actions).toEqual([
            { action: 'delete', file_path: `${DIR}/README.md` },
            { action: 'delete', file_path: `${DIR}/core-ir/manifest.json` },
        ])
        const opened = writes(calls)[4].body as { title: string; description: string }
        expect(opened.title).toBe('Remove use case: Bäume 1.1.0')
        expect(opened.description).toContain(`removes \`${DIR}/\` (2 files)`)
        expect(opened.description).toContain('is not listed in the catalogue')
        expect(opened.description).toContain(`Withdrawn with it: ${WEB}/-/merge_requests/9`)

        expect(result).toMatchObject({ status: 'ok', mrUrl: `${WEB}/-/merge_requests/30` })
        expect(result.detail).toBe('Entfernen vorgeschlagen: Vorschlag !30 wartet auf das Katalog-Team. Vorschlag !9 ist geschlossen.')
    })

    it('withdraws the open proposals of a merged version together with the rest, in one go, when the person chose both', async () => {
        // Bodenfeuchte on the demo: proposed again after the merge, and its catalogue proposal open.
        const state = world({
            exportMrs: [mr(21, 'opened', 'export/baeume-1.1.0'), MERGED_EXPORT],
            catalogMrs: [catalogMr(20)],
        })
        const { plan, result, calls } = await planAndDelete(state, 'baeume', '1.1.0', 'version')
        expect(plan).toMatchObject({ kind: 'remove', closes: [{ what: 'bundle', ref: '!21' }, { what: 'catalog', ref: '!20' }] })
        expect(sent(calls).filter((call) => call.startsWith('PUT'))).toEqual(['PUT /projects/7/merge_requests/21', 'PUT /projects/7/merge_requests/20'])
        expect(sent(calls).at(-1)).toBe('POST /projects/7/merge_requests')
        expect(result.detail).toContain('Die Vorschläge !21 und !20 sind geschlossen.')
    })

    it('hands the folder back to the version it replaced, writing only what differs', async () => {
        const state = world({
            blobs: {
                [HEAD]: { [`${DIR}/README.md`]: 'same', [`${DIR}/core-ir/manifest.json`]: 'm-new', [`${DIR}/core-ir/new.json`]: 'n' },
                [BEFORE]: { [`${DIR}/README.md`]: 'same', [`${DIR}/core-ir/manifest.json`]: 'm-old', [`${DIR}/core-ir/old.json`]: 'o' },
            },
            files: {
                [`${HEAD}|${DIR}/core-ir/manifest.json`]: manifest('1.1.0'),
                [`${BEFORE}|${DIR}/core-ir/manifest.json`]: manifest('1.0.0'),
                [`${BEFORE}|${DIR}/core-ir/old.json`]: '{"old":true}',
                'main|index.json': index(),
            },
        })
        const { plan, result, calls } = await planAndDelete(state)
        expect(plan).toMatchObject({ kind: 'remove', closes: [], removal: { previous: true, restores: '1.0.0', files: 3 } })
        expect(result.status).toBe('ok')

        const commit = writes(calls).find((call) => call.path === '/projects/7/repository/commits')?.body as { actions: unknown[] }
        expect(commit.actions).toEqual([
            { action: 'update', file_path: `${DIR}/core-ir/manifest.json`, content: manifest('1.0.0') },
            { action: 'create', file_path: `${DIR}/core-ir/old.json`, content: '{"old":true}' },
            { action: 'delete', file_path: `${DIR}/core-ir/new.json` },
        ])
        // The unchanged README is not read at all.
        expect(calls.some((call) => call.path.includes('README.md'))).toBe(false)
        const opened = writes(calls).find((call) => call.path === '/projects/7/merge_requests')?.body as { description: string }
        expect(opened.description).toContain('back to version 1.0.0')
    })

    it('undoes the merge that brought the version in: shared again after a newer one, it gives the folder back to that one', async () => {
        // 1.1.0 merged first (MERGE), replaced by 1.2.0, then shared again (MERGE_AGAIN): before that, 1.2.0 was there.
        const state = world({
            exportMrs: [
                mr(8, 'merged', 'export/baeume-1.1.0', { merge_commit_sha: MERGE_AGAIN, title: 'Export use case: Bäume 1.1.0' }),
                MERGED_EXPORT,
            ],
            parents: { [MERGE]: [BEFORE], [MERGE_AGAIN]: [BEFORE_AGAIN] },
            blobs: {
                [HEAD]: { [`${DIR}/core-ir/manifest.json`]: 'm-110' },
                [BEFORE]: {},
                [BEFORE_AGAIN]: { [`${DIR}/core-ir/manifest.json`]: 'm-120' },
            },
            files: {
                [`${HEAD}|${DIR}/core-ir/manifest.json`]: manifest('1.1.0'),
                [`${BEFORE_AGAIN}|${DIR}/core-ir/manifest.json`]: manifest('1.2.0'),
                'main|index.json': index(),
            },
        })
        const plan = await planOf(state)
        expect(plan).toMatchObject({ kind: 'remove', removal: { previous: true, restores: '1.2.0', mergedUrl: `${WEB}/-/merge_requests/8` } })
    })

    it('goes back to before the first merge of a version merged twice', async () => {
        const state = world({
            exportMrs: [
                mr(8, 'merged', 'export/baeume-1.1.0', { merge_commit_sha: MERGE_AGAIN, title: 'Export use case: Bäume 1.1.0' }),
                MERGED_EXPORT,
            ],
            parents: { [MERGE]: [BEFORE], [MERGE_AGAIN]: [BEFORE_AGAIN] },
            blobs: {
                [HEAD]: { [`${DIR}/core-ir/manifest.json`]: 'm-110b' },
                [BEFORE]: {},
                [BEFORE_AGAIN]: { [`${DIR}/core-ir/manifest.json`]: 'm-110a' },
            },
            files: {
                [`${HEAD}|${DIR}/core-ir/manifest.json`]: manifest('1.1.0'),
                [`${BEFORE_AGAIN}|${DIR}/core-ir/manifest.json`]: manifest('1.1.0'),
                'main|index.json': index(),
            },
        })
        const plan = await planOf(state)
        expect(plan).toMatchObject({ kind: 'remove', removal: { previous: false, files: 1, mergedUrl: `${WEB}/-/merge_requests/3` } })
    })

    it('leaves a catalogue proposal alone that pins another repository', async () => {
        const plan = await planOf(world({ catalogMrs: [catalogMr(9, 'https://gitlab.example/other/repo')] }))
        expect(plan).toMatchObject({ kind: 'remove', closes: [] })
    })

    it('says what already happened when the removal fails after a proposal was closed', async () => {
        const { result } = await planAndDelete(world({ catalogMrs: [catalogMr(9)], failing: ['POST /projects/7/repository/commits'] }), 'baeume', '1.1.0', 'version')
        expect(result.status).toBe('error')
        expect(result.partial).toBe(true)
        expect(result.detail).toContain('Vorschlag !9 ist geschlossen.')
        expect(result.detail).toContain('500')
    })

    it('leaves a listed version in the catalogue and withdraws only what is still proposed', async () => {
        const state = world({
            catalogMrs: [catalogMr(9)],
            files: { [`${HEAD}|${DIR}/core-ir/manifest.json`]: manifest('1.1.0'), 'main|index.json': index([{ id: 'urn:stadt:usecase:baeume', version: '1.1.0' }]) },
        })
        const { plan, result, calls } = await planAndDelete(state)
        expect(plan).toMatchObject({ kind: 'withdraw', listed: true, closes: [{ what: 'catalog', ref: '!9' }] })
        expect(result.detail).toBe('Vorschlag !9 ist geschlossen. Die Version bleibt im Katalog, wie sie ist.')
        expect(writes(calls).map((call) => call.method)).toEqual(['PUT', 'POST', 'DELETE'])
        expect(writes(calls)[1].body?.body).toContain('listed version stays')
    })

    it('does not delete a listed version at all', async () => {
        const plan = await planOf(world({ files: { [`${HEAD}|${DIR}/core-ir/manifest.json`]: manifest('1.1.0'), 'main|index.json': index([{ id: 'urn:stadt:usecase:baeume', version: '1.1.0' }]) } }))
        expect(plan).toMatchObject({ kind: 'none', closes: [] })
        expect(plan.reason).toContain('nur das Katalog-Team')
    })

    it('points at a removal that is already proposed', async () => {
        const plan = await planOf(world({ removalMrs: [mr(12, 'opened', 'remove/baeume-1.1.0')] }))
        expect(plan).toMatchObject({ kind: 'none', mrUrl: `${WEB}/-/merge_requests/12` })
    })

    it('has nothing to delete for a version that is no longer on the base branch', async () => {
        const gone = await planOf(world({ files: { [`${HEAD}|${DIR}/core-ir/manifest.json`]: manifest('1.2.0'), 'main|index.json': index() } }))
        expect(gone).toMatchObject({ kind: 'none' })
        expect(gone.reason).toContain('nicht (mehr) im Ablageort')
    })

    it('does not call a broken package folder gone', async () => {
        const broken = await planOf(world({ files: { [`${HEAD}|${DIR}/core-ir/manifest.json`]: '{not json', 'main|index.json': index() } }))
        expect(broken).toMatchObject({ kind: 'none' })
        expect(broken.reason).toContain('kein gültiges JSON')
        expect(broken.reason).not.toContain('nicht (mehr) im Ablageort')
    })

    it('does not claim the version is unlisted when no catalogue is configured, and counts one file as one', async () => {
        vi.stubEnv('REPO_LIST_URL', '')
        const state = world({ blobs: { [HEAD]: { [`${DIR}/core-ir/manifest.json`]: 'm-new' } } })
        const { plan, calls } = await planAndDelete(state)
        expect(plan.removal?.files).toBe(1)
        const opened = writes(calls).find((call) => call.path === '/projects/7/merge_requests')?.body as { description: string }
        expect(opened.description).toContain('(1 file)')
        expect(opened.description).toContain('no catalogue is configured')
        expect(opened.description).not.toContain('is not listed in the catalogue')
    })
})

describe('the choice between the open proposal and the accepted package', () => {
    // Merged 1.1.0, not listed, with its catalogue proposal !9 still open.
    const withProposal = () => world({ catalogMrs: [catalogMr(9)] })

    it('plans withdrawing only the open proposal by default, and offers the removal as the other plan', async () => {
        vi.stubGlobal('fetch', fakeGitLab(withProposal()).fetchImpl)
        const { plan, alternative } = await planShareDeletion(WEB, 'baeume', '1.1.0')
        expect(plan).toMatchObject({ kind: 'withdraw', scope: 'proposal', accepted: true, closes: [{ what: 'catalog', ref: '!9' }] })
        expect(plan?.removal).toBeUndefined()
        expect(alternative).toMatchObject({ kind: 'remove', scope: 'version', closes: [{ what: 'catalog', ref: '!9' }], removal: { folder: DIR, files: 2 } })
        // Two plans, two fingerprints: confirming one never runs the other.
        expect(plan?.fingerprint).not.toBe(alternative?.fingerprint)
    })

    it('withdraws only the open proposal and leaves the accepted package as it is', async () => {
        const { plan, result, calls } = await planAndDelete(withProposal())
        expect(plan.scope).toBe('proposal')
        expect(sent(calls)).toEqual([
            'PUT /projects/7/merge_requests/9',
            'POST /projects/7/merge_requests/9/notes',
            'DELETE /projects/7/repository/branches/catalog%2Fbaeume-1.1.0',
        ])
        expect(result).toMatchObject({ status: 'ok', mrUrl: `${WEB}/-/merge_requests/9` })
        expect(result.detail).toBe('Vorschlag !9 ist geschlossen. Das angenommene Paket bleibt, wie es ist.')
        expect(writes(calls)[1].body?.body).toContain('The merged package stays in the repository as it is.')
    })

    it('withdraws only the change to an accepted package by default, as for the bodenfeuchte proposal', async () => {
        const state = world({ exportMrs: [mr(21, 'opened', 'export/baeume-1.1.0'), MERGED_EXPORT] })
        const { plan, result, calls } = await planAndDelete(state)
        expect(plan).toMatchObject({ kind: 'withdraw', accepted: true, closes: [{ what: 'bundle', ref: '!21' }] })
        expect(sent(calls).filter((call) => call.startsWith('POST /projects/7/merge_requests'))).toEqual(['POST /projects/7/merge_requests/21/notes'])
        expect(result.status).toBe('ok')
    })

    it('withdraws what is open on an accepted package that came in another way, and says the package stays', async () => {
        // On the base branch, but through no merge request of this marketplace: no removal to offer, so no choice.
        const { plan, result, calls } = await planAndDelete(world({ exportMrs: [], catalogMrs: [catalogMr(9)] }))
        expect(plan).toMatchObject({ kind: 'withdraw', accepted: true, closes: [{ what: 'catalog', ref: '!9' }] })
        expect(plan.scope).toBeUndefined()
        expect(result.detail).toBe('Vorschlag !9 ist geschlossen. Das angenommene Paket bleibt, wie es ist.')
        expect(writes(calls)[1].body?.body).toContain('The merged package stays in the repository as it is.')
    })

    it('does not run one option under the other’s fingerprint', async () => {
        const gitlab = fakeGitLab(withProposal())
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { plan } = await planShareDeletion(WEB, 'baeume', '1.1.0')
        const result = await deleteShare(WEB, 'baeume', '1.1.0', plan!.fingerprint, 'version')
        expect(result.status).toBe('changed')
        expect(result.plan).toMatchObject({ kind: 'remove', scope: 'version' })
        expect(result.alternative).toMatchObject({ kind: 'withdraw', scope: 'proposal' })
        expect(writes(gitlab.calls)).toEqual([])
    })

    it('refuses an option that no longer applies, once the open proposal is gone, and hands back what is left', async () => {
        for (const scope of ['proposal', 'version'] as const) {
            SHARE_READS.clear()
            const state = withProposal()
            const gitlab = fakeGitLab(state)
            vi.stubGlobal('fetch', gitlab.fetchImpl)
            const answer = await planShareDeletion(WEB, 'baeume', '1.1.0')
            const chosen = [answer.plan, answer.alternative].find((candidate) => candidate?.scope === scope)
            // Closed by the catalogue team while the dialog was open.
            state.catalogMrs = [catalogMr(9, WEB, DIR, 'closed')]
            const result = await deleteShare(WEB, 'baeume', '1.1.0', chosen!.fingerprint, scope)
            expect(result.status).toBe('changed')
            // Nothing open any more: proposing the removal is the one plan left, without a choice.
            expect(result.plan).toMatchObject({ kind: 'remove', closes: [] })
            expect(result.plan?.scope).toBeUndefined()
            expect(result.alternative).toBeUndefined()
            expect(writes(gitlab.calls)).toEqual([])
        }
    })

    it('offers no choice where nothing is open: proposing the removal is the plan', async () => {
        vi.stubGlobal('fetch', fakeGitLab(world()).fetchImpl)
        const { plan, alternative } = await planShareDeletion(WEB, 'baeume', '1.1.0')
        expect(plan).toMatchObject({ kind: 'remove', closes: [] })
        expect(plan?.scope).toBeUndefined()
        expect(alternative).toBeUndefined()
    })

    it('refuses a scope no dialog offers', async () => {
        const gitlab = fakeGitLab(withProposal())
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const result = await deleteShare(WEB, 'baeume', '1.1.0', 'any', 'everything' as DeletionScope)
        expect(result.status).toBe('invalid')
        expect(gitlab.calls).toEqual([])
    })
})

describe('a version the catalogue team took out', () => {
    // 1.1.0 was listed through the merged !8, and Daniel deleted its row again (cb4d433 on the demo).
    const takenOut = (extra: unknown[] = []) => world({ catalogMrs: [...extra, catalogMr(8, WEB, DIR, 'merged')] })

    it('withdraws only the open proposal that would bring it back, and leaves the package where it is', async () => {
        const { plan, result, calls } = await planAndDelete(takenOut([catalogMr(27)]))
        expect(plan).toMatchObject({ kind: 'withdraw', takenOut: true, closes: [{ what: 'catalog', ref: '!27' }] })
        expect(plan.removal).toBeUndefined()
        expect(result).toMatchObject({ status: 'ok', detail: 'Vorschlag !27 ist geschlossen. Das angenommene Paket bleibt, wie es ist.' })
        expect(sent(calls)).toEqual([
            'PUT /projects/7/merge_requests/27',
            'POST /projects/7/merge_requests/27/notes',
            'DELETE /projects/7/repository/branches/catalog%2Fbaeume-1.1.0',
        ])
        expect(writes(calls)[1].body?.body).toContain('would have brought it back')
    })

    it('proposes nothing to remove once nothing is open for it', async () => {
        const plan = await planOf(takenOut())
        expect(plan).toMatchObject({ kind: 'none', closes: [] })
        expect(plan.reason).toContain('Das Katalog-Team hat Version 1.1.0 aus dem Katalog genommen')
    })

    it('is never proposed for the catalogue again', async () => {
        const gitlab = fakeGitLab(takenOut())
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const result = await proposeSharedCatalogEntry(WEB, 'baeume', '1.1.0')
        expect(result).toMatchObject({ intent: 'catalog', status: 'invalid', catalog: { state: 'withdrawn', takenOut: { version: '1.1.0' } } })
        expect(result.detail).toContain('Das Katalog-Team hat Version 1.1.0 aus dem Katalog genommen.')
        expect(writes(gitlab.calls)).toEqual([])
    })

    it('refuses to point at an open proposal that would bring it back, instead of calling it already open', async () => {
        const gitlab = fakeGitLab(takenOut([catalogMr(27)]))
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const result = await proposeSharedCatalogEntry(WEB, 'baeume', '1.1.0')
        expect(result).toMatchObject({ status: 'invalid', mrUrl: `${WEB}/-/merge_requests/27`, catalog: { state: 'mr-open', bringsBack: true } })
        expect(result.detail).toContain('!27 würde den herausgenommenen Eintrag zurückbringen - zieh den Vorschlag unter „In Arbeit“ zurück.')
        expect(writes(gitlab.calls)).toEqual([])
    })

    it('is withdrawn with the catalogue team’s reason when its row is marked revoked', async () => {
        const index = JSON.stringify({ version: '1.0.0', useCases: [{ id: 'urn:stadt:usecase:baeume', version: '1.1.0', revoked: true, revokedReason: 'Datenquelle abgeschaltet' }] })
        const gitlab = fakeGitLab(world({ files: { [`${HEAD}|${DIR}/core-ir/manifest.json`]: manifest('1.1.0'), 'main|index.json': index } }))
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const result = await proposeSharedCatalogEntry(WEB, 'baeume', '1.1.0')
        expect(result.status).toBe('invalid')
        expect(result.detail).toContain('Grund: Datenquelle abgeschaltet.')
        expect(result.detail).toContain('Diese Version kommt nicht noch einmal in den Katalog.')
        expect(writes(gitlab.calls)).toEqual([])
    })

    it('says the whole entry is out when the revoked row names an earlier version, not that this one was there', async () => {
        const index = JSON.stringify({ version: '1.0.0', useCases: [{ id: 'urn:stadt:usecase:baeume', version: '1.0.0', revoked: true }] })
        const gitlab = fakeGitLab(world({ files: { [`${HEAD}|${DIR}/core-ir/manifest.json`]: manifest('1.1.0'), 'main|index.json': index } }))
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const result = await proposeSharedCatalogEntry(WEB, 'baeume', '1.1.0')
        expect(result).toMatchObject({ status: 'invalid', catalog: { state: 'withdrawn', takenOut: { version: '1.0.0' } } })
        expect(result.detail).toBe(
            'Das Katalog-Team hat Version 1.0.0 aus dem Katalog genommen. Herausgenommen ist der ganze Eintrag: auch eine neue Version kommt erst in den Katalog, wenn das Katalog-Team ihn wieder freigibt.',
        )
        expect(writes(gitlab.calls)).toEqual([])
    })
})

describe('the catalogue step while a removal is pending', () => {
    it('is refused, with the removal to look at, and proposes nothing', async () => {
        const gitlab = fakeGitLab(world({ removalMrs: [mr(12, 'opened', 'remove/baeume-1.1.0')] }))
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const result = await proposeSharedCatalogEntry(WEB, 'baeume', '1.1.0')
        expect(result).toMatchObject({ intent: 'catalog', status: 'not-merged', mrUrl: `${WEB}/-/merge_requests/12` })
        expect(result.detail).toContain('Entfernen')
        expect(result.bundle?.removal).toEqual({ state: 'opened', mrUrl: `${WEB}/-/merge_requests/12` })
        expect(writes(gitlab.calls)).toEqual([])
    })
})

describe('the list after a deletion', () => {
    it('names a withdrawn version as such, keeps a merge over a newer closed duplicate, and carries the removal', async () => {
        const state = world({
            exportMrs: [
                mr(5, 'closed', 'export/baeume-1.1.0', { closed_by: { id: 42 } }),
                MERGED_EXPORT,
                mr(4, 'closed', 'export/pegel-1.0.0', { closed_by: { id: 42 }, closed_at: '2026-10-17T10:00:00Z', title: 'Export use case: Pegelkarte 1.0.0' }),
            ],
            removalMrs: [mr(12, 'opened', 'remove/baeume-1.1.0')],
            notes: { 4: [WITHDRAWAL_NOTE] },
        })
        vi.stubGlobal('fetch', fakeGitLab(state).fetchImpl)
        const { rows } = await readShareListing()
        const baeume = rows.find((row) => row.slug === 'baeume')
        expect(baeume).toMatchObject({ bundleMr: { state: 'merged' }, bundle: { state: 'on-base', removal: { state: 'opened', mrUrl: `${WEB}/-/merge_requests/12` } } })
        expect(baeume?.withdrawn).toBeUndefined()
        expect(rows.find((row) => row.slug === 'pegel')).toMatchObject({ bundleMr: { state: 'closed' }, withdrawn: true })
    })

    it('does not call a request withdrawn that the bot’s account closed without the marketplace’s note', async () => {
        const state = world({ exportMrs: [mr(4, 'closed', 'export/pegel-1.0.0', { closed_by: { id: 42 }, title: 'Export use case: Pegelkarte 1.0.0' })], notes: { 4: [{ body: 'closed' }] } })
        vi.stubGlobal('fetch', fakeGitLab(state).fetchImpl)
        const { rows } = await readShareListing()
        expect(rows[0]).toMatchObject({ slug: 'pegel', bundleMr: { state: 'closed' } })
        expect(rows[0].withdrawn).toBeUndefined()
    })

    it('writes the note the list reads back', async () => {
        const { calls } = await planAndDelete(world({ exportMrs: [mr(4, 'opened', 'export/pegel-1.0.0', { title: 'Export use case: Pegelkarte 1.0.0' })] }), 'pegel', '1.0.0')
        const note = String(writes(calls)[1].body?.body)
        expect(withdrawerOf(note)).toBe('Test')
    })

    it('reads the withdrawal back from the mark its close wrote, without asking for comments, even where the note was lost', async () => {
        const opened = mr(4, 'opened', 'export/pegel-1.0.0', { title: 'Export use case: Pegelkarte 1.0.0' })
        const { calls } = await planAndDelete(world({ exportMrs: [opened], failing: ['POST /projects/7/merge_requests/4/notes'] }), 'pegel', '1.0.0')
        const { description } = writes(calls)[0].body as { description: string }
        // GitLab as it is after that close: the description with the mark, closed by the account just now, and the note missing.
        const closed = mr(4, 'closed', 'export/pegel-1.0.0', {
            title: 'Export use case: Pegelkarte 1.0.0',
            description,
            closed_by: { id: 42 },
            closed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            user_notes_count: 0,
        })
        const gitlab = fakeGitLab(world({ exportMrs: [closed] }))
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { rows } = await readShareListing()
        expect(rows[0]).toMatchObject({ slug: 'pegel', withdrawn: true, proposals: [{ withdrawnBy: 'Test' }] })
        expect(gitlab.calls.some((call) => call.path.includes('/notes'))).toBe(false)
    })
})

describe('what the catalogue team turned down (2026-10-22)', () => {
    /** A removal of 1.1.0 the catalogue team closed with a reason. */
    const turnedDownRemoval = mr(12, 'closed', 'remove/baeume-1.1.0', {
        created_at: '2026-10-21T10:00:00Z',
        closed_at: '2026-10-22T10:00:00Z',
        updated_at: '2026-10-22T10:00:00Z',
        closed_by: { id: 99, username: 'kurator' },
        user_notes_count: 1,
    })
    const reason = { 12: [{ body: 'Das Paket wird noch gebraucht.', author: { id: 99, username: 'kurator' }, created_at: '2026-10-22T09:59:00Z' }] }

    it('does not propose a removal again that the catalogue team turned down, and says why (R3, S8)', async () => {
        const gitlab = fakeGitLab(world({ removalMrs: [turnedDownRemoval], notes: reason }))
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const { plan, alternative } = await planShareDeletion(WEB, 'baeume', '1.1.0')
        expect(plan).toMatchObject({ kind: 'none', closes: [], mrUrl: `${WEB}/-/merge_requests/12` })
        expect(plan?.reason).toBe(
            'Das Katalog-Team hat das Entfernen dieser Version am 22.10. nicht angenommen (Vorschlag !12). Noch einmal vorschlagen geht von hier nicht - frag beim Katalog-Team nach.',
        )
        expect(alternative).toBeUndefined()
        const result = await deleteShare(WEB, 'baeume', '1.1.0', plan!.fingerprint)
        expect(result.status).toBe('unchanged')
        expect(writes(gitlab.calls)).toEqual([])
    })

    it('still withdraws what is open next to a removal turned down, and leaves the accepted package - with no removal to choose', async () => {
        const state = () => world({ removalMrs: [turnedDownRemoval], notes: reason, catalogMrs: [catalogMr(9)] })
        vi.stubGlobal('fetch', fakeGitLab(state()).fetchImpl)
        const { plan, alternative } = await planShareDeletion(WEB, 'baeume', '1.1.0')
        expect(plan).toMatchObject({ kind: 'withdraw', accepted: true, closes: [{ what: 'catalog', ref: '!9' }] })
        expect(plan?.scope).toBeUndefined()
        expect(alternative).toBeUndefined()
        const { result, calls } = await planAndDelete(state())
        expect(result.detail).toBe('Vorschlag !9 ist geschlossen. Das angenommene Paket bleibt, wie es ist.')
        expect(sent(calls).some((call) => call === 'POST /projects/7/merge_requests')).toBe(false)
    })

    it('tells a removal closed through the marketplace’s account as such, and refuses it even where its comments cannot be read (R3)', async () => {
        const viaAccount = { ...turnedDownRemoval, closed_by: { id: 42, username: 'walkable.cities.2021' } }
        const plan = await planOf(world({ removalMrs: [viaAccount], failing: ['/notes'] }))
        expect(plan).toMatchObject({ kind: 'none', mrUrl: `${WEB}/-/merge_requests/12` })
        expect(plan.reason).toBe(
            'Das Entfernen dieser Version wurde am 22.10. über das Marktplatz-Konto geschlossen und gilt als nicht angenommen (Vorschlag !12). Noch einmal vorschlagen geht von hier nicht - frag beim Katalog-Team nach.',
        )
    })

    it('counts the removals since the version was last accepted: removed once, shared again and accepted, a "no" to removing it again holds', async () => {
        const first = { ...MERGED_EXPORT, created_at: '2026-10-01T10:00:00Z', merged_at: '2026-10-02T10:00:00Z' }
        const removedOnce = mr(10, 'merged', 'remove/baeume-1.1.0', { created_at: '2026-10-10T10:00:00Z', merged_at: '2026-10-11T10:00:00Z' })
        const sharedAgain = { ...MERGED_EXPORT, iid: 11, created_at: '2026-10-12T10:00:00Z', merged_at: '2026-10-13T10:00:00Z' }
        // The old removal's merge was undone by the merge after it: it no longer beats the later "no".
        const plan = await planOf(world({ exportMrs: [sharedAgain, first], removalMrs: [turnedDownRemoval, removedOnce], notes: reason }))
        expect(plan).toMatchObject({ kind: 'none', mrUrl: `${WEB}/-/merge_requests/12` })
    })

    it('proposes the removal as before when the one before was withdrawn, not turned down', async () => {
        const withdrawn = { ...turnedDownRemoval, closed_by: { id: 42, username: 'bot' }, description: `${turnedDownRemoval.description}\n\nWithdrawn through the Open Urban Apps marketplace on behalf of **Ewa** at 2026-10-22T10:00:00.000Z.` }
        const plan = await planOf(world({ removalMrs: [withdrawn] }))
        expect(plan).toMatchObject({ kind: 'remove', closes: [] })
    })

    it('does not propose the 1.1.0 entry again after two closes through the marketplace’s account, and hands back the reading (R2, U7: !31 and !32)', async () => {
        const viaAccount = (iid: number, createdAt: string, closedAt: string) => ({
            ...catalogMr(iid, WEB, DIR, 'closed'),
            created_at: createdAt,
            closed_at: closedAt,
            updated_at: closedAt,
            closed_by: { id: 42, username: 'walkable.cities.2021' },
            user_notes_count: 0,
        })
        const state = world({ catalogMrs: [viaAccount(31, '2026-10-22T09:37:00Z', '2026-10-22T09:37:23Z'), viaAccount(32, '2026-10-22T09:41:00Z', '2026-10-22T09:41:28Z')] })
        const gitlab = fakeGitLab(state)
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const result = await proposeSharedCatalogEntry(WEB, 'baeume', '1.1.0')
        expect(result).toMatchObject({
            intent: 'catalog',
            status: 'invalid',
            mrUrl: `${WEB}/-/merge_requests/32`,
            catalog: { state: 'declined', declined: { iid: 32, viaMarketplace: true, reason: { kind: 'none' } } },
        })
        // Told as what it was, a close through the marketplace's account - not as the catalogue team's decision (S10, P4).
        expect(result.detail).toBe(
            'Kein Katalog-Eintrag: Der Eintrag für Version 1.1.0 wurde am 22.10. über das Marktplatz-Konto geschlossen und gilt als nicht angenommen (Vorschlag !32). Für diese Version schlägt der Marktplatz ihn nicht noch einmal vor - teile eine neue Version.',
        )
        expect(writes(gitlab.calls)).toEqual([])
        // Nobody wrote anything on either: no comment was asked for.
        expect(gitlab.calls.some((call) => call.path.includes('/notes'))).toBe(false)
    })

    it('names the catalogue team where a reviewer closed the entry, and refuses even where their words cannot be read', async () => {
        const byReviewer = {
            ...catalogMr(32, WEB, DIR, 'closed'),
            created_at: '2026-10-22T09:41:00Z',
            closed_at: '2026-10-22T10:00:00Z',
            updated_at: '2026-10-22T10:00:00Z',
            closed_by: { id: 99, username: 'kurator' },
            user_notes_count: 1,
        }
        for (const failing of [undefined, ['/notes']]) {
            vi.stubGlobal('fetch', fakeGitLab(world({ catalogMrs: [byReviewer], ...(failing ? { failing } : {}) })).fetchImpl)
            const result = await proposeSharedCatalogEntry(WEB, 'baeume', '1.1.0')
            expect(result.status).toBe('invalid')
            expect(result.detail).toBe(
                'Kein Katalog-Eintrag: Das Katalog-Team hat den Eintrag für Version 1.1.0 am 22.10. nicht angenommen (Vorschlag !32). Für diese Version schlägt der Marktplatz ihn nicht noch einmal vor - teile eine neue Version.',
            )
        }
    })

    it('fails rather than refuses where a close by the account cannot be told from a withdrawal of the time before the mark', async () => {
        const byAccount = {
            ...catalogMr(32, WEB, DIR, 'closed'),
            created_at: '2026-10-22T09:41:00Z',
            closed_at: '2026-10-22T10:00:00Z',
            updated_at: '2026-10-22T10:00:00Z',
            closed_by: { id: 42, username: 'walkable.cities.2021' },
            user_notes_count: 1,
        }
        const gitlab = fakeGitLab(world({ catalogMrs: [byAccount], failing: ['/notes'] }))
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const result = await proposeSharedCatalogEntry(WEB, 'baeume', '1.1.0')
        expect(result.status).toBe('error')
        expect(writes(gitlab.calls)).toEqual([])
    })

    it('refuses the entry, with the proposal to look at, where another package of the same name holds its branch with a "no" (R5)', async () => {
        const otherPackage = {
            ...catalogMr(40, 'https://gitlab.example/andere/ablage', 'packages/baeume', 'closed'),
            description: 'Proposed by ...\n\nAdds `urn:andere:usecase:baeume` in `useCases`, pinned to …',
            created_at: '2026-10-21T09:00:00Z',
            closed_at: '2026-10-21T10:00:00Z',
            updated_at: '2026-10-21T10:00:00Z',
            closed_by: { id: 99, username: 'kurator' },
            user_notes_count: 0,
        }
        const full = JSON.stringify({ id: 'urn:stadt:usecase:baeume', version: '1.1.0', displayName: 'Bäume', description: 'Stadtbäume', maintainer: 'Stadt', license: 'EUPL-1.2', keywords: [] })
        const gitlab = fakeGitLab(
            world({ catalogMrs: [otherPackage], branches: ['catalog/baeume-1.1.0'], files: { [`${HEAD}|${DIR}/core-ir/manifest.json`]: full, 'main|index.json': index() } }),
        )
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const result = await proposeSharedCatalogEntry(WEB, 'baeume', '1.1.0')
        expect(result).toMatchObject({ intent: 'catalog', status: 'invalid', mrUrl: `${WEB}/-/merge_requests/40`, catalog: { state: 'none' } })
        expect(result.detail).toBe(
            'Kein Katalog-Eintrag: Für „baeume“ in Version 1.1.0 gibt es schon einen geschlossenen Vorschlag eines anderen Pakets (Vorschlag !40). Er bleibt, wie er ist, damit das Katalog-Team ihn wieder öffnen kann - für dein Paket teile eine neue Version.',
        )
        // Its branch stays, and nothing is written.
        expect(writes(gitlab.calls)).toEqual([])
    })

    it('proposes the entry once the catalogue team reopened the proposal they had closed (S11) - by pointing at it', async () => {
        const reopened = { ...catalogMr(32), created_at: '2026-10-22T09:41:00Z' }
        const full = JSON.stringify({ id: 'urn:stadt:usecase:baeume', version: '1.1.0', displayName: 'Bäume', description: 'Stadtbäume', maintainer: 'Stadt', license: 'EUPL-1.2', keywords: [] })
        const gitlab = fakeGitLab(world({ catalogMrs: [reopened], files: { [`${HEAD}|${DIR}/core-ir/manifest.json`]: full, 'main|index.json': index() } }))
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const result = await proposeSharedCatalogEntry(WEB, 'baeume', '1.1.0')
        expect(result).toMatchObject({ status: 'already-open', mrUrl: `${WEB}/-/merge_requests/32` })
        expect(writes(gitlab.calls)).toEqual([])
    })
})

describe('the source line of the proposals after the package’s', () => {
    /** The version's export as rc.6 writes it: its description ends in the source line. */
    const sourced = mr(3, 'merged', 'export/baeume-1.1.0', {
        sha: MERGED_HEAD,
        merge_commit_sha: MERGE,
        title: 'Export use case: Bäume 1.1.0',
        description: `Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\n## Bäume\n\n${shareSourceLine({ kind: 'dataset', id: 'ds-baeume', instance: 'https://portal.alt.example' })}`,
    })

    it('names the package’s dataset and this instance on a removal', async () => {
        vi.stubEnv('PORTAL_URL', 'https://portal.hier.example')
        const { calls } = await planAndDelete(world({ exportMrs: [sourced] }))
        const opened = writes(calls).find((call) => call.path === '/projects/7/merge_requests')?.body as { description: string }
        // The dataset is the share's; the instance is the one proposing.
        expect(shareSourceOf(opened.description)).toEqual({ kind: 'dataset', id: 'ds-baeume', instance: 'https://portal.hier.example' })
    })

    it('names this instance alone on the removal of an older share, without reading its README for it', async () => {
        vi.stubEnv('PORTAL_URL', 'https://portal.hier.example')
        const { calls } = await planAndDelete(world())
        const opened = writes(calls).find((call) => call.path === '/projects/7/merge_requests')?.body as { description: string }
        expect(shareSourceOf(opened.description)).toEqual({ kind: 'dataset', instance: 'https://portal.hier.example' })
        expect(calls.some((call) => call.path.includes('README.md'))).toBe(false)
    })

    it('names the package’s dataset and this instance on a catalogue entry', async () => {
        vi.stubEnv('PORTAL_URL', 'https://portal.hier.example')
        const full = JSON.stringify({ id: 'urn:stadt:usecase:baeume', version: '1.1.0', displayName: 'Bäume', description: 'Stadtbäume', maintainer: 'Stadt', license: 'EUPL-1.2', keywords: [] })
        const state = world({
            exportMrs: [sourced],
            files: { [`${HEAD}|${DIR}/core-ir/manifest.json`]: full, 'main|index.json': index() },
        })
        const gitlab = fakeGitLab(state)
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const result = await proposeSharedCatalogEntry(WEB, 'baeume', '1.1.0')
        expect(result).toMatchObject({ intent: 'catalog', status: 'ok' })
        const opened = writes(gitlab.calls).find((call) => call.path === '/projects/7/merge_requests')?.body as { title: string; description: string }
        expect(opened.title).toBe('Add use case: Bäume 1.1.0')
        expect(shareSourceOf(opened.description)).toEqual({ kind: 'dataset', id: 'ds-baeume', instance: 'https://portal.hier.example' })
        // The pin sentence the withdrawal and the listing read back is still there.
        expect(opened.description).toContain(`\`${HEAD}\` of ${WEB} (path \`${DIR}\`).`)
    })
})
