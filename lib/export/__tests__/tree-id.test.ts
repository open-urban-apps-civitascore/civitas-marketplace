import { describe, expect, it } from 'vitest'

import { bundleBranch, catalogBranch, parseBundleBranch } from '@/lib/export/config'
import { clientFor, treeIdOf } from '@/lib/export/gitlab'

type Entry = { id: string; name: string; type: string }

/** A GitLab that knows tree listings by `<ref>|<path>`, page by page; anything else is a 404. */
function fakeTrees(listings: Record<string, Entry[][]>) {
    const fetchImpl = (async (input: string | URL | Request) => {
        const url = new URL(String(input))
        const key = `${url.searchParams.get('ref')}|${url.searchParams.get('path') ?? ''}`
        const pages = listings[key]
        if (!pages) return new Response(JSON.stringify({ message: '404 Tree Not Found' }), { status: 404 })
        const page = Number(url.searchParams.get('page') ?? '1')
        return new Response(JSON.stringify(pages[page - 1] ?? []), { status: 200 })
    }) as typeof fetch
    return clientFor('https://gitlab.example/group/packages', 'token', fetchImpl)
}

describe('treeIdOf', () => {
    it('reads a nested directory id from its parent listing', async () => {
        const client = fakeTrees({ 'abc|packages': [[{ id: 't1', name: 'baeume', type: 'tree' }]] })
        expect(await treeIdOf(client, 10, 'packages/baeume', 'abc')).toBe('t1')
    })

    it('reads a directory at the repository root without a path', async () => {
        const client = fakeTrees({ 'abc|': [[{ id: 't2', name: 'baeume', type: 'tree' }]] })
        expect(await treeIdOf(client, 10, 'baeume', 'abc')).toBe('t2')
    })

    it('does not take a file of the same name for the directory', async () => {
        const client = fakeTrees({ 'abc|packages': [[{ id: 'b1', name: 'baeume', type: 'blob' }]] })
        expect(await treeIdOf(client, 10, 'packages/baeume', 'abc')).toBeUndefined()
    })

    it('follows the pages of a long parent listing', async () => {
        const filler = Array.from({ length: 100 }, (_, n) => ({ id: `x${n}`, name: `other-${n}`, type: 'tree' }))
        const client = fakeTrees({ 'abc|packages': [filler, [{ id: 't3', name: 'baeume', type: 'tree' }]] })
        expect(await treeIdOf(client, 10, 'packages/baeume', 'abc')).toBe('t3')
    })

    it('is undefined for a ref the repository does not know', async () => {
        expect(await treeIdOf(fakeTrees({}), 10, 'packages/baeume', 'gone')).toBeUndefined()
    })
})

describe('parseBundleBranch', () => {
    it('reads slug and version back from the branch the export names', () => {
        expect(parseBundleBranch(bundleBranch('baeume-kataster', '1.2.3'))).toEqual({
            slug: 'baeume-kataster',
            version: '1.2.3',
        })
    })

    it('ignores branches the export did not name', () => {
        expect(parseBundleBranch(catalogBranch('baeume', '1.0.0'))).toBeUndefined()
        expect(parseBundleBranch('main')).toBeUndefined()
    })
})
