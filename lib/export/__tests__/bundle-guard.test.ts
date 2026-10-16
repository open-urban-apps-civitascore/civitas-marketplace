import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ requireSession: vi.fn(async () => ({ user: { name: 'Test' } })), getAccessToken: vi.fn(async () => 'test-token') }))
vi.mock('@/lib/export/share-permission', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/export/share-permission')>()),
    fetchShareRight: vi.fn(async () => 'allowed'),
}))
vi.mock('@/lib/export/status', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/export/status')>()),
    readBundleStatus: vi.fn(),
}))
vi.mock('@/lib/export/portal-reader', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/export/portal-reader')>()),
    readUseCase: vi.fn(),
}))
vi.mock('@/lib/export/gitlab', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/export/gitlab')>()),
    openMergeRequest: vi.fn(),
}))

import { exportAction } from '@/lib/export-actions'
import { openMergeRequest } from '@/lib/export/gitlab'
import { readUseCase } from '@/lib/export/portal-reader'
import { readBundleStatus } from '@/lib/export/status'

const TARGET = 'https://gitlab.example/group/catalog'

function bundleForm() {
    const data = new FormData()
    const fields = {
        datasetId: 'local', publisher: 'stadt', slug: 'baeume', version: '1.1.0', domain: 'environment', displayName: 'Bäume',
        description: 'Stadtbäume', maintainer: 'Stadt', license: 'EUPL-1.2', catalogMetadata: '{}', targetKey: TARGET, intent: 'bundle',
    }
    for (const [key, value] of Object.entries(fields)) data.set(key, value)
    return data
}

beforeEach(() => {
    vi.stubEnv('EXPORT_TARGET_REPOS', JSON.stringify([{ label: 'Katalog', url: TARGET, baseBranch: 'main', pathPrefix: 'packages' }]))
    vi.stubEnv('EXPORT_REPO_TOKEN', 'token')
})
afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
})

describe('proposing a version that GitLab already has', () => {
    it('does not open a second merge request for a version already on the base branch', async () => {
        vi.mocked(readBundleStatus).mockResolvedValue({ state: 'on-base', sha: 'f'.repeat(40), packageId: 'urn:stadt:usecase:baeume', verification: { state: 'verified' } })
        const result = await exportAction(null, bundleForm())
        expect(result.status).toBe('unchanged')
        expect(result.bundle?.state).toBe('on-base')
        expect(result.detail).toContain('schon im Repository')
        expect(openMergeRequest).not.toHaveBeenCalled()
        // Nothing is built for it either: the platform is not read.
        expect(readUseCase).not.toHaveBeenCalled()
    })

    it('points at the merge request that is already open', async () => {
        vi.mocked(readBundleStatus).mockResolvedValue({ state: 'mr-open', mrUrl: `${TARGET}/-/merge_requests/12` })
        const result = await exportAction(null, bundleForm())
        expect(result.status).toBe('already-open')
        expect(result.mrUrl).toBe(`${TARGET}/-/merge_requests/12`)
        expect(openMergeRequest).not.toHaveBeenCalled()
    })
})
