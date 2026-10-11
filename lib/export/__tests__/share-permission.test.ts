import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ getAccessToken: vi.fn(async () => 'test-token') }))

import { fetchShareRight, mayShare, proposerName, shareRefusal } from '@/lib/export/share-permission'

const tenant = (permissions: string[]) => ({ scopeType: 'TENANT', permissions })

describe('mayShare', () => {
    it('lets whoever builds data across the tenant share', () => {
        expect(mayShare({ assignments: [tenant(['DATASTRUCTURE_CREATE', 'DATASET_UPDATE', 'DATASET_READ'])] })).toBe(true)
    })

    it('accepts the two rights from different assignments', () => {
        expect(mayShare({ assignments: [tenant(['DATASTRUCTURE_CREATE']), tenant(['DATASET_UPDATE'])] })).toBe(true)
    })

    it('refuses readers and release approvers', () => {
        expect(mayShare({ assignments: [tenant(['DATASET_READ', 'DATASTRUCTURE_READ'])] })).toBe(false)
        expect(mayShare({ assignments: [tenant(['DATASET_RELEASE', 'DATASET_READ'])] })).toBe(false)
    })

    it('refuses rights that hold only inside one datapool', () => {
        expect(mayShare({ assignments: [{ scopeType: 'DATAPOOL', permissions: ['DATASTRUCTURE_CREATE', 'DATASET_UPDATE'] }] })).toBe(false)
    })

    it('refuses an unreadable answer', () => {
        expect(mayShare(null)).toBe(false)
        expect(mayShare({})).toBe(false)
    })
})

describe('proposerName', () => {
    it('uses the name and never the e-mail address', () => {
        expect(proposerName({ name: 'Ewa Flis' })).toBe('Ewa Flis')
        expect(proposerName({ name: '  ', email: 'someone@example.org' } as { name: string })).toBe('unbekannt')
        expect(proposerName(undefined)).toBe('unbekannt')
    })
})

describe('fetchShareRight', () => {
    afterEach(() => vi.unstubAllGlobals())
    const answer = (response: Promise<Response>) => vi.stubGlobal('fetch', vi.fn(() => response))

    it('allows whoever holds both rights tenant-wide', async () => {
        answer(Promise.resolve(Response.json({ assignments: [tenant(['DATASTRUCTURE_CREATE', 'DATASET_UPDATE'])] })))
        expect(await fetchShareRight()).toBe('allowed')
    })

    it('refuses whoever lacks them', async () => {
        answer(Promise.resolve(Response.json({ assignments: [tenant(['DATASET_READ'])] })))
        expect(await fetchShareRight()).toBe('refused')
    })

    it('says unknown, not refused, when the platform does not answer', async () => {
        answer(Promise.reject(new Error('ECONNREFUSED')))
        expect(await fetchShareRight()).toBe('unknown')
        answer(Promise.resolve(new Response('', { status: 502 })))
        expect(await fetchShareRight()).toBe('unknown')
    })

    it('explains both kinds of no, and has nothing to say to a yes', () => {
        expect(shareRefusal('allowed')).toBeUndefined()
        expect(shareRefusal('refused')).toContain('Data Owner')
        expect(shareRefusal('unknown')).toContain('nicht geprüft')
    })
})
