import { describe, expect, it } from 'vitest'

import { canPush, clientFor, openMergeRequest, parseProjectUrl, type GitLabProject } from '@/lib/export/gitlab'

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
})
