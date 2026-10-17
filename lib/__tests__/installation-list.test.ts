import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    activeInstallationOf,
    partitionInstallations,
    readAllInstallations,
} from '@/lib/installation-list'

interface Row {
    id: string
    packageId?: string
    uninstalledAt?: string | null
}

const FULL_PAGE = 200

function rows(count: number, prefix: string): Row[] {
    return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}` }))
}

function pageOf(content: Row[]): Response {
    return new Response(JSON.stringify({ content }), { status: 200 })
}

function stubFetch(...responses: Response[]) {
    const fetchMock = vi.fn()
    for (const response of responses) fetchMock.mockResolvedValueOnce(response)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('readAllInstallations', () => {
    it('stops after a page that is not full', async () => {
        const fetchMock = stubFetch(pageOf(rows(3, 'first')))

        const list = await readAllInstallations<Row>('token')

        expect(list).toEqual({ ok: true, rows: rows(3, 'first'), isComplete: true })
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('reads the next page when a page is full', async () => {
        // The case that hid an installation: more rows than one page holds.
        const fetchMock = stubFetch(pageOf(rows(FULL_PAGE, 'first')), pageOf(rows(3, 'second')))

        const list = await readAllInstallations<Row>('token')

        expect(list.ok && list.rows).toHaveLength(FULL_PAGE + 3)
        expect(list.ok && list.isComplete).toBe(true)
        expect(fetchMock.mock.calls[0][0]).toContain('size=200&page=0')
        expect(fetchMock.mock.calls[1][0]).toContain('size=200&page=1')
    })

    it('stops at an empty page when the last page was exactly full', async () => {
        const fetchMock = stubFetch(pageOf(rows(FULL_PAGE, 'first')), pageOf([]))

        const list = await readAllInstallations<Row>('token')

        expect(list.ok && list.rows).toHaveLength(FULL_PAGE)
        expect(list.ok && list.isComplete).toBe(true)
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('sends the token of the caller', async () => {
        const fetchMock = stubFetch(pageOf([]))

        await readAllInstallations<Row>('token-of-the-user')

        expect(fetchMock.mock.calls[0][1].headers).toEqual({
            Authorization: 'Bearer token-of-the-user',
        })
    })

    it('reports the status when the platform refuses', async () => {
        stubFetch(new Response('permission_denied', { status: 403, statusText: 'Forbidden' }))

        const list = await readAllInstallations<Row>('token')

        expect(list).toEqual({ ok: false, status: 403, statusText: 'Forbidden' })
    })

    it('says that rows are missing when the page guard stops the read', async () => {
        // A platform that ignores `page` would answer with a full page forever.
        const fetchMock = vi.fn().mockImplementation(async () => pageOf(rows(FULL_PAGE, 'same')))
        vi.stubGlobal('fetch', fetchMock)

        const list = await readAllInstallations<Row>('token')

        expect(list.ok && list.isComplete).toBe(false)
        expect(fetchMock).toHaveBeenCalledTimes(25)
    })
})

describe('partitionInstallations', () => {
    it('separates the active installations from the history and keeps the order', () => {
        const installations: Row[] = [
            { id: 'newest', uninstalledAt: '2026-09-29T16:57:00' },
            { id: 'active-1' },
            { id: 'older', uninstalledAt: '2026-09-29T17:03:00' },
            { id: 'active-2', uninstalledAt: null },
        ]

        const { active, history } = partitionInstallations(installations)

        expect(active.map((row) => row.id)).toEqual(['active-1', 'active-2'])
        expect(history.map((row) => row.id)).toEqual(['newest', 'older'])
    })
})

describe('activeInstallationOf', () => {
    it('finds the active installation of a package and skips its history', () => {
        const installations: Row[] = [
            { id: 'old', packageId: 'pkg', uninstalledAt: '2026-09-29T16:57:00' },
            { id: 'other', packageId: 'other-pkg' },
            { id: 'current', packageId: 'pkg' },
        ]

        expect(activeInstallationOf(installations, 'pkg')?.id).toBe('current')
    })

    it('is null for a package that is not installed, or only was', () => {
        const installations: Row[] = [
            { id: 'old', packageId: 'pkg', uninstalledAt: '2026-09-29T16:57:00' },
        ]

        expect(activeInstallationOf(installations, 'pkg')).toBeNull()
        expect(activeInstallationOf(installations, 'unknown')).toBeNull()
    })
})
