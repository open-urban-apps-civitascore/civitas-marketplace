import { describe, expect, it } from 'vitest'

import {
    canPush,
    clientFor,
    commitBefore,
    findMergeRequests,
    HeldBranchError,
    openMergeRequest,
    parseProjectUrl,
    withdrawMergeRequest,
    type GitLabProject,
    type MergeRequestRef,
} from '@/lib/export/gitlab'
import { shareSourceOf, withdrawalMark, withdrawalMarkIn } from '@/lib/export/merge-request-text'

interface Call {
    method: string
    path: string
    body?: unknown
}

/** A scripted GitLab: every request is matched by method + path prefix, in any order, and recorded. */
function fakeGitLab(routes: [string, string, unknown][]): { fetchImpl: typeof fetch; calls: Call[] } {
    const calls: Call[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        const path = url.replace('https://gitlab.example/api/v4', '')
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        calls.push({ method, path, body })
        const route = routes.find(([m, p]) => m === method && path.startsWith(p))
        if (!route) return new Response(JSON.stringify({ message: `unrouted ${method} ${path}` }), { status: 404 })
        const [, , payload] = route
        if (payload instanceof Response) return payload
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    return { fetchImpl, calls }
}

const upstream = (accessLevel: number): GitLabProject => ({
    id: 10,
    path_with_namespace: 'group/catalog',
    web_url: 'https://gitlab.example/group/catalog',
    default_branch: 'main',
    permissions: { project_access: { access_level: accessLevel }, group_access: null },
})

describe('parseProjectUrl / canPush', () => {
    it('derives the API base and project path from a project URL', () => {
        expect(parseProjectUrl('https://gitlab.com/civitascore-openurbanapps/civitas-marketplace-catalog.git')).toEqual({
            apiBase: 'https://gitlab.com/api/v4',
            projectPath: 'civitascore-openurbanapps/civitas-marketplace-catalog',
        })
    })

    it('treats Developer and above as able to push', () => {
        expect(canPush(upstream(30))).toBe(true)
        expect(canPush(upstream(20))).toBe(false)
    })
})

describe('openMergeRequest', () => {
    const files = { 'packages/x/core-ir/manifest.json': '{}\n', 'packages/x/README.md': '# x\n' }

    it('commits straight onto the upstream when the token may push', async () => {
        const gl = fakeGitLab([
            ['GET', '/projects/10/merge_requests', []],
            ['GET', '/projects/10/repository/branches/export%2Fx-1.0.0', new Response('', { status: 404 })],
            ['GET', '/projects/10/repository/branches/main', { commit: { id: 'abc' } }],
            ['POST', '/projects/10/repository/commits', { id: 'def' }],
            ['POST', '/projects/10/merge_requests', { iid: 7, web_url: 'https://gitlab.example/mr/7', state: 'opened', source_branch: 'export/x-1.0.0' }],
        ])
        const client = clientFor('https://gitlab.example/group/catalog', 'token', gl.fetchImpl)
        const outcome = await openMergeRequest(client, {
            upstream: upstream(40),
            baseBranch: 'main',
            branch: 'export/x-1.0.0',
            title: 'Export',
            description: 'body',
            files,
            existingPaths: new Set(['packages/x/README.md']),
        })
        expect(outcome).toEqual({ status: 'created', url: 'https://gitlab.example/mr/7', iid: 7 })

        const commit = gl.calls.find((c) => c.method === 'POST' && c.path.startsWith('/projects/10/repository/commits'))
        expect(commit?.body).toMatchObject({ branch: 'export/x-1.0.0', start_sha: 'abc' })
        const actions = (commit?.body as { actions: { action: string; file_path: string }[] }).actions
        expect(actions).toEqual([
            { action: 'create', file_path: 'packages/x/core-ir/manifest.json', content: '{}\n' },
            { action: 'update', file_path: 'packages/x/README.md', content: '# x\n' },
        ])
        const mr = gl.calls.find((c) => c.method === 'POST' && c.path.startsWith('/projects/10/merge_requests'))
        expect(mr?.body).toMatchObject({ source_branch: 'export/x-1.0.0', target_branch: 'main', target_project_id: 10 })
        expect(gl.calls.some((c) => c.path.includes('/fork'))).toBe(false)
    })

    it('returns the open merge request instead of opening a second one', async () => {
        const gl = fakeGitLab([
            ['GET', '/projects/10/merge_requests', [{ iid: 3, web_url: 'https://gitlab.example/mr/3', state: 'opened', source_branch: 'export/x-1.0.0' }]],
        ])
        const client = clientFor('https://gitlab.example/group/catalog', 'token', gl.fetchImpl)
        const outcome = await openMergeRequest(client, {
            upstream: upstream(40),
            baseBranch: 'main',
            branch: 'export/x-1.0.0',
            title: 'Export',
            description: 'body',
            files,
            existingPaths: new Set(),
        })
        expect(outcome).toEqual({ status: 'already-open', url: 'https://gitlab.example/mr/3', iid: 3 })
        expect(gl.calls).toHaveLength(1)
    })

    it('goes through the bot fork when the token cannot push, targeting the upstream', async () => {
        const gl = fakeGitLab([
            ['GET', '/projects/10/merge_requests', []],
            ['GET', '/projects/10/forks', []],
            ['POST', '/projects/10/fork', { id: 99, path_with_namespace: 'bot/catalog', web_url: 'x', default_branch: 'main', import_status: 'finished' }],
            ['GET', '/projects/99/repository/branches/export%2Fx-1.0.0', { commit: { id: 'old' } }],
            ['DELETE', '/projects/99/repository/branches/export%2Fx-1.0.0', new Response(null, { status: 204 })],
            ['GET', '/projects/10/repository/branches/main', { commit: { id: 'abc' } }],
            ['POST', '/projects/99/repository/commits', { id: 'def' }],
            ['POST', '/projects/99/merge_requests', { iid: 8, web_url: 'https://gitlab.example/mr/8', state: 'opened', source_branch: 'export/x-1.0.0' }],
        ])
        const client = clientFor('https://gitlab.example/group/catalog', 'token', gl.fetchImpl)
        const outcome = await openMergeRequest(client, {
            upstream: upstream(20),
            baseBranch: 'main',
            branch: 'export/x-1.0.0',
            title: 'Export',
            description: 'body',
            files,
            existingPaths: new Set(),
        })
        expect(outcome.status).toBe('created')
        // A leftover branch in the fork is replaced, never appended to.
        expect(gl.calls.some((c) => c.method === 'DELETE')).toBe(true)
        const mr = gl.calls.find((c) => c.method === 'POST' && c.path.startsWith('/projects/99/merge_requests'))
        expect(mr?.body).toMatchObject({ target_project_id: 10, source_branch: 'export/x-1.0.0' })
    })

    it('falls back to the fork base branch when the upstream head is unknown to the fork', async () => {
        let commitAttempts = 0
        const gl = fakeGitLab([
            ['GET', '/projects/10/merge_requests', []],
            ['GET', '/projects/10/forks', [{ id: 99, path_with_namespace: 'bot/catalog', web_url: 'x', default_branch: 'main' }]],
            ['GET', '/projects/99/repository/branches/export%2Fx-1.0.0', new Response('', { status: 404 })],
            ['GET', '/projects/10/repository/branches/main', { commit: { id: 'abc' } }],
            ['POST', '/projects/99/merge_requests', { iid: 9, web_url: 'https://gitlab.example/mr/9', state: 'opened', source_branch: 'export/x-1.0.0' }],
        ])
        const base = gl.fetchImpl
        const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
            if (String(input).endsWith('/projects/99/repository/commits') && init?.method === 'POST') {
                commitAttempts++
                const body = JSON.parse(String(init.body)) as { start_sha?: string }
                if (body.start_sha) return new Response(JSON.stringify({ message: 'start_sha not found' }), { status: 400 })
                return new Response(JSON.stringify({ id: 'def' }), { status: 200 })
            }
            return base(input, init)
        }) as typeof fetch
        const client = clientFor('https://gitlab.example/group/catalog', 'token', fetchImpl)
        const outcome = await openMergeRequest(client, {
            upstream: upstream(20),
            baseBranch: 'main',
            branch: 'export/x-1.0.0',
            title: 'Export',
            description: 'body',
            files,
            existingPaths: new Set(),
        })
        expect(outcome.status).toBe('created')
        expect(commitAttempts).toBe(2)
    })

    it('removes what it is told to remove, next to what it writes', async () => {
        const gl = fakeGitLab([
            ['GET', '/projects/10/merge_requests', []],
            ['GET', '/projects/10/repository/branches/remove%2Fx-1.0.0', new Response('', { status: 404 })],
            ['GET', '/projects/10/repository/branches/main', { commit: { id: 'abc' } }],
            ['POST', '/projects/10/repository/commits', { id: 'def' }],
            ['POST', '/projects/10/merge_requests', { iid: 7, web_url: 'https://gitlab.example/mr/7', state: 'opened', source_branch: 'remove/x-1.0.0' }],
        ])
        const client = clientFor('https://gitlab.example/group/catalog', 'token', gl.fetchImpl)
        await openMergeRequest(client, {
            upstream: upstream(40),
            baseBranch: 'main',
            branch: 'remove/x-1.0.0',
            title: 'Remove',
            description: 'body',
            files: { 'packages/x/README.md': '# old\n' },
            existingPaths: new Set(['packages/x/README.md', 'packages/x/core-ir/new.json']),
            deletedPaths: ['packages/x/core-ir/new.json'],
        })
        const commit = gl.calls.find((c) => c.method === 'POST' && c.path.startsWith('/projects/10/repository/commits'))
        expect((commit?.body as { actions: unknown[] }).actions).toEqual([
            { action: 'update', file_path: 'packages/x/README.md', content: '# old\n' },
            { action: 'delete', file_path: 'packages/x/core-ir/new.json' },
        ])
    })
})

describe('withdrawMergeRequest', () => {
    const fromFork: MergeRequestRef = {
        iid: 5,
        web_url: 'https://gitlab.example/mr/5',
        state: 'opened',
        source_branch: 'export/x-1.0.0',
        source_project_id: 99,
        description: 'Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\n<!-- oua-share {"kind":"dataset","id":"ds"} -->\n',
    }
    const MARK = withdrawalMark('Ewa', new Date('2026-10-22T10:00:00.000Z'))

    it('closes and marks it in one request, then leaves a note, then deletes the branch where it lives - in the fork', async () => {
        const gl = fakeGitLab([
            ['PUT', '/projects/10/merge_requests/5', { state: 'closed' }],
            ['POST', '/projects/10/merge_requests/5/notes', { id: 1 }],
            ['DELETE', '/projects/99/repository/branches/export%2Fx-1.0.0', new Response(null, { status: 204 })],
        ])
        await withdrawMergeRequest(clientFor('https://gitlab.example/group/catalog', 'token', gl.fetchImpl), 10, fromFork, { note: 'Withdrawn.', mark: MARK })
        expect(gl.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'PUT /projects/10/merge_requests/5',
            'POST /projects/10/merge_requests/5/notes',
            'DELETE /projects/99/repository/branches/export%2Fx-1.0.0',
        ])
        // The mark at the very end, after the hidden source line, which stays readable.
        const description = (gl.calls[0].body as { description: string }).description
        expect(gl.calls[0].body).toEqual({ state_event: 'close', description: `${fromFork.description?.trimEnd()}\n\n${MARK}` })
        expect(description.split('\n').at(-1)).toBe(MARK)
        expect(shareSourceOf(description)).toEqual({ kind: 'dataset', id: 'ds' })
        expect(withdrawalMarkIn(description, '2026-10-22T10:00:01.000Z')).toBe('Ewa')
        expect(gl.calls[1].body).toEqual({ body: 'Withdrawn.' })
    })

    it('marks a request without a description with the mark alone', async () => {
        const gl = fakeGitLab([['PUT', '/projects/10/merge_requests/5', { state: 'closed' }]])
        await withdrawMergeRequest(clientFor('https://gitlab.example/group/catalog', 'token', gl.fetchImpl), 10, { ...fromFork, description: null }, { note: 'n', mark: MARK })
        expect(gl.calls[0].body).toEqual({ state_event: 'close', description: MARK })
    })

    it('still closes when the note or the branch fail, and writes nothing more when the close does', async () => {
        const forbidden = () => new Response(JSON.stringify({ message: '403 Forbidden' }), { status: 403 })
        const tolerant = fakeGitLab([
            ['PUT', '/projects/10/merge_requests/5', { state: 'closed' }],
            ['POST', '/projects/10/merge_requests/5/notes', forbidden()],
            ['DELETE', '/projects/99/repository/branches/export%2Fx-1.0.0', forbidden()],
        ])
        await expect(
            withdrawMergeRequest(clientFor('https://gitlab.example/group/catalog', 'token', tolerant.fetchImpl), 10, fromFork, { note: 'n', mark: MARK }),
        ).resolves.toBeUndefined()

        const refused = fakeGitLab([
            ['PUT', '/projects/10/merge_requests/5', forbidden()],
            ['POST', '/projects/10/merge_requests/5/notes', { id: 1 }],
        ])
        await expect(
            withdrawMergeRequest(clientFor('https://gitlab.example/group/catalog', 'token', refused.fetchImpl), 10, fromFork, { note: 'n', mark: MARK }),
        ).rejects.toMatchObject({ status: 403 })
        // No note claims a withdrawal that did not happen, and the branch stays.
        expect(refused.calls.map((c) => c.method)).toEqual(['PUT'])
    })
})

describe('findMergeRequests', () => {
    it('asks for and returns the newest created first, whatever was changed last (U6)', async () => {
        const gl = fakeGitLab([
            [
                'GET',
                '/projects/10/merge_requests',
                [
                    { iid: 3, state: 'closed', source_branch: 'remove/x-1.0.0', web_url: 'u/3', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-22T10:00:00Z' },
                    { iid: 7, state: 'closed', source_branch: 'remove/x-1.0.0', web_url: 'u/7', created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T11:00:00Z' },
                ],
            ],
        ])
        const requests = await findMergeRequests(clientFor('https://gitlab.example/group/catalog', 'token', gl.fetchImpl), 10, 'remove/x-1.0.0')
        expect(requests.map((mr) => mr.iid)).toEqual([7, 3])
        expect(gl.calls[0].path).toContain('order_by=created_at&sort=desc')
    })
})

describe('openMergeRequest and a proposal the catalogue team turned down (R5)', () => {
    const files = { 'packages/x/core-ir/manifest.json': '{}\n' }
    const input = {
        upstream: upstream(40),
        baseBranch: 'main',
        branch: 'catalog/x-1.0.0',
        title: 'Add',
        description: 'body',
        files,
        existingPaths: new Set<string>(),
    }
    const ACCOUNT = { id: 42, username: 'walkable.cities.2021' }
    const closed = (extra: Partial<MergeRequestRef> = {}): MergeRequestRef => ({
        iid: 32,
        state: 'closed',
        source_branch: 'catalog/x-1.0.0',
        web_url: 'https://gitlab.example/mr/32',
        author: ACCOUNT,
        created_at: '2026-10-22T09:59:35Z',
        closed_at: '2026-10-22T10:00:00Z',
        updated_at: '2026-10-22T10:00:00Z',
        user_notes_count: 0,
        ...extra,
    })
    const routes = (requests: MergeRequestRef[]): [string, string, unknown][] => [
        ['GET', '/user', ACCOUNT],
        ['GET', '/projects/10/merge_requests/32/notes', []],
        ['GET', '/projects/10/merge_requests', requests],
        ['GET', '/projects/10/repository/branches/catalog%2Fx-1.0.0', { commit: { id: 'old' } }],
        ['DELETE', '/projects/10/repository/branches/catalog%2Fx-1.0.0', new Response(null, { status: 204 })],
        ['GET', '/projects/10/repository/branches/main', { commit: { id: 'abc' } }],
        ['POST', '/projects/10/repository/commits', { id: 'def' }],
        ['POST', '/projects/10/merge_requests', { iid: 33, web_url: 'https://gitlab.example/mr/33', state: 'opened', source_branch: 'catalog/x-1.0.0' }],
    ]

    it('keeps its branch and opens nothing, so the team can still reopen it - and names no one, as it cannot tell who closed it', async () => {
        const gl = fakeGitLab(routes([closed()]))
        const refused = openMergeRequest(clientFor('https://gitlab.example/group/catalog', 'token', gl.fetchImpl), input)
        await expect(refused).rejects.toBeInstanceOf(HeldBranchError)
        await expect(refused).rejects.toMatchObject({
            status: 0,
            held: { iid: 32 },
            message:
                'Vorschlag !32 wurde nicht angenommen. Er bleibt bei GitLab, wie er ist, damit das Katalog-Team ihn wieder öffnen kann - von hier wird er nicht noch einmal vorgeschlagen. Lade die Seite neu, dort steht, wie es weitergeht.',
        })
        expect(gl.calls.filter((c) => c.method !== 'GET')).toEqual([])
    })

    it('keeps it also where the branch brought a merge before, or the "no" was about another package of the same name', async () => {
        // Accepted, taken out by a merged removal and shared again: the old merge no longer beats the later "no".
        const merged = { ...closed({ iid: 19, state: 'merged', created_at: '2026-10-01T10:00:00Z' }) }
        const otherPackage = closed({ description: 'Adds `urn:andere:usecase:x` in `useCases`' })
        for (const requests of [[closed(), merged], [otherPackage]]) {
            const gl = fakeGitLab(routes(requests))
            await expect(openMergeRequest(clientFor('https://gitlab.example/group/catalog', 'token', gl.fetchImpl), input)).rejects.toBeInstanceOf(HeldBranchError)
            expect(gl.calls.some((c) => c.method === 'DELETE')).toBe(false)
        }
    })

    it('replaces the branch of a withdrawn one, and judges only the account’s own requests', async () => {
        const withdrawn = closed({ description: `body\n\n${withdrawalMark('Ewa', new Date('2026-10-22T10:00:00Z'))}` })
        const byHand = closed({ iid: 34, author: { id: 7, username: 'kurator' }, created_at: '2026-10-22T11:00:00Z' })
        for (const requests of [[withdrawn], [byHand, withdrawn]]) {
            const gl = fakeGitLab(routes(requests))
            const outcome = await openMergeRequest(clientFor('https://gitlab.example/group/catalog', 'token', gl.fetchImpl), input)
            expect(outcome.status).toBe('created')
            expect(gl.calls.some((c) => c.method === 'DELETE')).toBe(true)
        }
    })

    it('replaces it where the version started over since: a "no" to a change of an acceptance a removal undid (bodenfeuchte)', async () => {
        // !19 merged, the change !21 turned down on the same branch, then the removal merged: „Erneut einreichen“ after
        // „Entfernt“ proposes 1.0.0 once more, as R1 lets it (`presentRequests`), and its branch is no longer held.
        const accepted = closed({ iid: 19, state: 'merged', created_at: '2026-10-01T10:00:00Z' })
        const change = closed({ iid: 21, created_at: '2026-10-10T10:00:00Z', closed_at: '2026-10-12T10:00:00Z' })
        const removal = closed({ iid: 30, state: 'merged', source_branch: 'remove/x-1.0.0', created_at: '2026-10-20T10:00:00Z', merged_at: '2026-10-21T10:00:00Z' })
        const byBranch = (requests: MergeRequestRef[], removals: MergeRequestRef[]) => {
            const gl = fakeGitLab(routes(requests))
            const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
                const url = new URL(String(input))
                if (url.pathname.endsWith('/projects/10/merge_requests') && url.searchParams.get('source_branch') === 'remove/x-1.0.0') return new Response(JSON.stringify(removals))
                return gl.fetchImpl(input, init)
            }) as typeof fetch
            return { gl, client: clientFor('https://gitlab.example/group/catalog', 'token', fetchImpl) }
        }
        const released = byBranch([change, accepted], [removal])
        const outcome = await openMergeRequest(released.client, { ...input, restartedBy: 'remove/x-1.0.0' })
        expect(outcome.status).toBe('created')
        expect(released.gl.calls.some((c) => c.method === 'DELETE')).toBe(true)
        // A "no" after the removal still holds it, and without the removal's branch named nothing changes.
        const later = closed({ iid: 33, created_at: '2026-10-22T09:59:35Z' })
        await expect(openMergeRequest(byBranch([later, change, accepted], [removal]).client, { ...input, restartedBy: 'remove/x-1.0.0' })).rejects.toBeInstanceOf(HeldBranchError)
        await expect(openMergeRequest(byBranch([change, accepted], [removal]).client, input)).rejects.toBeInstanceOf(HeldBranchError)
    })

    it('asks for the account only where a closed request could hold the branch', async () => {
        const gl = fakeGitLab(routes([closed({ state: 'merged' })]))
        await openMergeRequest(clientFor('https://gitlab.example/group/catalog', 'token', gl.fetchImpl), input)
        expect(gl.calls.some((c) => c.path === '/user')).toBe(false)
    })
})

describe('commitBefore', () => {
    const merged = (extra: Partial<MergeRequestRef>): MergeRequestRef => ({ iid: 3, web_url: 'u', state: 'merged', source_branch: 'export/x-1.0.0', ...extra })
    const gl = fakeGitLab([
        ['GET', '/projects/10/repository/commits/merge', { id: 'merge', parent_ids: ['base-before', 'branch-head'] }],
        ['GET', '/projects/10/repository/commits/squash', { id: 'squash', parent_ids: ['base-before-squash'] }],
        ['GET', '/projects/10/repository/commits/first', { id: 'first', parent_ids: ['base-before-ff'] }],
        ['GET', '/projects/10/merge_requests/3/commits', [{ id: 'second' }, { id: 'first' }]],
    ])
    const client = clientFor('https://gitlab.example/group/catalog', 'token', gl.fetchImpl)

    it('takes the first parent of what landed: the merge commit, the squashed one, or the oldest own commit', async () => {
        expect(await commitBefore(client, 10, merged({ merge_commit_sha: 'merge' }))).toBe('base-before')
        expect(await commitBefore(client, 10, merged({ merge_commit_sha: null, squash_commit_sha: 'squash' }))).toBe('base-before-squash')
        expect(await commitBefore(client, 10, merged({}))).toBe('base-before-ff')
    })
})
