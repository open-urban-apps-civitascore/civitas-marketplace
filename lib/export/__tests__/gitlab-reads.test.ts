import { describe, expect, it } from 'vitest'

import {
    clientFor,
    directoryTrees,
    GitLabError,
    GitLabReadCache,
    listOpenMergeRequests,
    mergeRequestCommits,
    readFile,
} from '@/lib/export/gitlab'

const SHA = 'b'.repeat(40)

/** Counts requests and answers each with `answer(url)`. */
function counting(answer: (url: URL) => Response | Promise<Response>) {
    const urls: string[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input))
        urls.push(url.pathname + url.search)
        void init
        return answer(url)
    }) as typeof fetch
    return { urls, fetchImpl }
}

const withCache = (fetchImpl: typeof fetch, cache = new GitLabReadCache()) => ({
    ...clientFor('https://gitlab.example/group/packages', 'token', fetchImpl),
    cache,
})

describe('GitLabReadCache', () => {
    it('keeps a file read at a commit, but not one read at a branch', async () => {
        const gitlab = counting(() => new Response('content', { status: 200 }))
        const client = withCache(gitlab.fetchImpl)
        await readFile(client, 7, 'packages/a/core-ir/manifest.json', SHA)
        await readFile(client, 7, 'packages/a/core-ir/manifest.json', SHA)
        await readFile(client, 7, 'index.json', 'main')
        await readFile(client, 7, 'index.json', 'main')
        expect(gitlab.urls.filter((url) => url.includes('manifest.json'))).toHaveLength(1)
        expect(gitlab.urls.filter((url) => url.includes('index.json'))).toHaveLength(2)
    })

    it('asks once for two reads of the same commit that run at the same time', async () => {
        const gitlab = counting(() => new Response(JSON.stringify([{ id: 't1', name: 'a', type: 'tree' }]), { status: 200 }))
        const client = withCache(gitlab.fetchImpl)
        const [first, second] = await Promise.all([directoryTrees(client, 7, 'packages', SHA), directoryTrees(client, 7, 'packages', SHA)])
        expect(first.get('a')).toBe('t1')
        expect(second).toBe(first)
        expect(gitlab.urls).toHaveLength(1)
    })

    it('does not keep a failed read, so the next visit asks again', async () => {
        let fail = true
        const gitlab = counting(() => (fail ? new Response(JSON.stringify({ message: 'boom' }), { status: 500 }) : new Response(JSON.stringify([]), { status: 200 })))
        const client = withCache(gitlab.fetchImpl)
        await expect(directoryTrees(client, 7, 'packages', SHA)).rejects.toBeInstanceOf(GitLabError)
        fail = false
        expect((await directoryTrees(client, 7, 'packages', SHA)).size).toBe(0)
        expect(gitlab.urls).toHaveLength(2)
    })

    it('keeps the commits of a merged request only', async () => {
        const gitlab = counting(() => new Response(JSON.stringify([{ id: SHA }]), { status: 200 }))
        const client = withCache(gitlab.fetchImpl)
        await mergeRequestCommits(client, 7, 3, true)
        await mergeRequestCommits(client, 7, 3, true)
        await mergeRequestCommits(client, 7, 4)
        await mergeRequestCommits(client, 7, 4)
        expect(gitlab.urls.filter((url) => url.includes('/merge_requests/3/'))).toHaveLength(1)
        expect(gitlab.urls.filter((url) => url.includes('/merge_requests/4/'))).toHaveLength(2)
    })

    it('reads straight from GitLab for a client without a cache', async () => {
        const gitlab = counting(() => new Response('content', { status: 200 }))
        const client = clientFor('https://gitlab.example/group/packages', 'token', gitlab.fetchImpl)
        await readFile(client, 7, 'a.json', SHA)
        await readFile(client, 7, 'a.json', SHA)
        expect(gitlab.urls).toHaveLength(2)
    })

    it('forgets the oldest answers beyond its limit', async () => {
        const cache = new GitLabReadCache(2)
        await cache.read('a', async () => 1)
        await cache.read('b', async () => 2)
        await cache.read('c', async () => 3)
        expect(cache.size).toBe(2)
        let asked = false
        await cache.read('a', async () => {
            asked = true
            return 1
        })
        expect(asked).toBe(true)
    })
})

describe('read time limit', () => {
    it('gives up on a read GitLab does not answer, with a message that says so', async () => {
        const hanging = (async (_input: string | URL | Request, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
            })) as typeof fetch
        const client = { ...clientFor('https://gitlab.example/group/packages', 'token', hanging), timeoutMs: 20 }
        const failure = await directoryTrees(client, 7, 'packages', 'main').catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(GitLabError)
        expect((failure as GitLabError).status).toBe(0)
        expect((failure as GitLabError).message).toContain('nicht innerhalb von')
    })
})

describe('listOpenMergeRequests', () => {
    it('follows the pages to the end', async () => {
        const gitlab = counting((url) => {
            const page = Number(url.searchParams.get('page'))
            const size = page === 1 ? 100 : 3
            return new Response(JSON.stringify(Array.from({ length: size }, (_, n) => ({ iid: page * 1000 + n, state: 'opened' }))), { status: 200 })
        })
        const open = await listOpenMergeRequests(clientFor('https://gitlab.example/group/packages', 'token', gitlab.fetchImpl), 7)
        expect(open).toHaveLength(103)
        expect(gitlab.urls.every((url) => url.includes('state=opened'))).toBe(true)
    })
})
