import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ requireSession: vi.fn(async () => ({ user: { name: 'Ewa' } })), getAccessToken: vi.fn(async () => 'token') }))
vi.mock('@/lib/export/share-permission', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/export/share-permission')>()),
    fetchShareRight: vi.fn(async () => 'allowed'),
}))
vi.mock('@/lib/export/new-version-fill', () => ({ readTextEditFill: vi.fn() }))
vi.mock('@/lib/export/gitlab', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/export/gitlab')>()),
    branchHead: vi.fn(),
    currentUser: vi.fn(async () => ({ id: 42, username: 'bot' })),
    findMergeRequests: vi.fn(async () => []),
    getProject: vi.fn(async () => ({ id: 8 })),
    openMergeRequest: vi.fn(),
    readFile: vi.fn(),
    withdrawMergeRequest: vi.fn(),
}))

import { branchHead, findMergeRequests, GitLabError, openMergeRequest, readFile, withdrawMergeRequest, type MergeRequestRef } from '@/lib/export/gitlab'
import { readTextEditFill } from '@/lib/export/new-version-fill'
import { SHARE_READS } from '@/lib/export/share-cache'
import { fetchShareRight } from '@/lib/export/share-permission'
import { textDraftOf, textReading } from '@/lib/export/text-edit'
import { proposeTextEdit, withdrawTextEdit } from '@/lib/export/text-edit-actions'

const ID = 'urn:stadt:usecase:baeume'
const SHA = 'a'.repeat(40)
const CATALOG = 'https://gitlab.example/group/katalog'
const curation = { tier: 'verified', reviewedBy: 'Team', reviewedAt: '2026-10-01' }
const row = {
    id: ID, type: 'usecase', displayName: 'Bäume', description: 'Stadtbäume', version: '1.0.0', maintainer: 'Stadt', license: 'EUPL-1.2', keywords: ['baum'],
    deploymentRef: { url: 'https://gitlab.example/x', ref: SHA, releaseTag: null, path: 'baeume' },
    curation,
}
const INDEX = JSON.stringify({ version: '4.0.0', updatedAt: '2026-10-01T00:00:00Z', addons: [], useCases: [row], dataStructures: [] })
const steckbrief = { from: '1.0.0', targetKey: 't', displayName: 'Bäume', description: 'Stadtbäume', publisher: 'stadt', slug: 'baeume', maintainer: 'Stadt', license: 'EUPL-1.2', keywords: 'baum', metadata: {}, full: true }

function form(fields: Record<string, string> = {}) {
    const data = new FormData()
    for (const [key, value] of Object.entries({ targetKey: 't', slug: 'baeume', version: '1.0.0', displayName: 'Bäume', description: 'Korrigiert', keywords: 'baum', catalogMetadata: '{}', basedOn: textReading(textDraftOf(steckbrief)), ...fields })) data.set(key, value)
    return data
}

beforeEach(() => {
    vi.stubEnv('EXPORT_TARGET_REPOS', JSON.stringify([{ label: 'Ablage', url: 'https://gitlab.example/group/catalog', baseBranch: 'main', pathPrefix: 'packages' }]))
    vi.stubEnv('EXPORT_REPO_TOKEN', 'token')
    vi.stubEnv('CATALOG_REPO_URL', CATALOG)
    vi.mocked(fetchShareRight).mockResolvedValue('allowed')
    vi.mocked(readTextEditFill).mockResolvedValue({ id: ID, steckbrief })
    vi.mocked(branchHead).mockResolvedValue(SHA)
    vi.mocked(readFile).mockResolvedValue(INDEX)
    vi.mocked(openMergeRequest).mockResolvedValue({ status: 'created', url: `${CATALOG}/-/merge_requests/50`, iid: 50 })
    SHARE_READS.clear()
})
afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
})

describe('proposing a text change', () => {
    it('opens one proposal on the catalogue only, with the pin and the seal untouched', async () => {
        const result = await proposeTextEdit(form())
        expect(result).toMatchObject({ status: 'ok', mrUrl: `${CATALOG}/-/merge_requests/50` })
        expect(openMergeRequest).toHaveBeenCalledOnce()
        const input = vi.mocked(openMergeRequest).mock.calls[0][1]
        expect(input.branch).toBe('text/stadt/baeume-1.0.0')
        expect(input.replacesClosed).toBe(true)
        expect(Object.keys(input.files)).toEqual(['index.json'])
        const [after] = JSON.parse(input.files['index.json']).useCases
        expect(after).toEqual({ ...row, description: 'Korrigiert' })
        expect(input.title).toBe('Update texts: Bäume 1.0.0')
        expect(input.description).toContain('on behalf of **Ewa**')
        expect(input.description).toContain('Changed: Kurzbeschreibung.')
    })

    it('starts the proposal from the commit the catalogue was read at, so a merge since stays', async () => {
        await proposeTextEdit(form())
        expect(vi.mocked(readFile).mock.calls[0][3]).toBe(SHA)
        expect(vi.mocked(openMergeRequest).mock.calls[0][1].startSha).toBe(SHA)
    })

    it('refuses a form older than the catalogue’s texts, so it cannot overwrite them unseen', async () => {
        const result = await proposeTextEdit(form({ basedOn: textReading(textDraftOf({ ...steckbrief, displayName: 'Früher' })) }))
        expect(result).toMatchObject({ status: 'invalid', detail: expect.stringContaining('Bitte lade die Seite neu') })
        expect(openMergeRequest).not.toHaveBeenCalled()
    })

    it('takes no pin, licence or seal from the form', async () => {
        const smuggled = form({ catalogMetadata: JSON.stringify({ curation: { tier: 'verified' } }) })
        expect(await proposeTextEdit(smuggled)).toMatchObject({ status: 'invalid' })
        await proposeTextEdit(form({ license: 'MIT', maintainer: 'Jemand', deploymentRef: 'x', version: '1.0.0' }))
        const [after] = JSON.parse(vi.mocked(openMergeRequest).mock.calls[0][1].files['index.json']).useCases
        expect(after).toMatchObject({ license: 'EUPL-1.2', maintainer: 'Stadt', deploymentRef: row.deploymentRef })
    })

    it('asks for what a catalogue row cannot go without', async () => {
        expect(await proposeTextEdit(form({ displayName: ' ' }))).toEqual({ status: 'invalid', detail: 'Name im Katalog fehlt.' })
        expect(await proposeTextEdit(form({ description: '' }))).toEqual({ status: 'invalid', detail: 'Kurzbeschreibung fehlt.' })
        expect(openMergeRequest).not.toHaveBeenCalled()
    })

    it('refuses without the right, for another instance, and where sharing is not set up, before reading anything else', async () => {
        vi.mocked(fetchShareRight).mockResolvedValueOnce('refused')
        expect(await proposeTextEdit(form())).toMatchObject({ status: 'forbidden' })
        vi.mocked(readTextEditFill).mockResolvedValueOnce({ refusal: 'Nicht von dieser Instanz.' })
        expect(await proposeTextEdit(form())).toEqual({ status: 'invalid', detail: 'Nicht von dieser Instanz.' })
        vi.stubEnv('CATALOG_REPO_URL', '')
        vi.stubEnv('REPO_LIST_URL', '')
        expect(await proposeTextEdit(form())).toMatchObject({ status: 'unconfigured' })
        expect(readFile).not.toHaveBeenCalled()
        expect(openMergeRequest).not.toHaveBeenCalled()
    })

    it('says so when the catalogue already shows these texts or moved on meanwhile', async () => {
        expect(await proposeTextEdit(form({ description: 'Stadtbäume' }))).toMatchObject({ status: 'unchanged' })
        vi.mocked(readFile).mockResolvedValue(JSON.stringify({ version: '4.0.0', useCases: [{ ...row, version: '1.1.0' }] }))
        expect(await proposeTextEdit(form())).toMatchObject({ status: 'invalid', detail: expect.stringContaining('nicht mehr im Katalog') })
        expect(openMergeRequest).not.toHaveBeenCalled()
    })

    it('points at a proposal already open, and passes on what GitLab says', async () => {
        vi.mocked(openMergeRequest).mockResolvedValueOnce({ status: 'already-open', url: `${CATALOG}/-/merge_requests/49`, iid: 49 })
        expect(await proposeTextEdit(form())).toMatchObject({ status: 'already-open', mrUrl: `${CATALOG}/-/merge_requests/49` })
        vi.mocked(openMergeRequest).mockRejectedValueOnce(new GitLabError('Nein', 500))
        expect(await proposeTextEdit(form())).toMatchObject({ status: 'error' })
    })
})

describe('withdrawing a text change', () => {
    const open = (facts: Partial<MergeRequestRef> = {}) => ({ iid: 50, web_url: `${CATALOG}/-/merge_requests/50`, state: 'opened', source_branch: 'text/stadt/baeume-1.0.0', author: { id: 42 }, ...facts }) as MergeRequestRef

    it('closes the open proposal with the mark the listing reads', async () => {
        vi.mocked(findMergeRequests).mockResolvedValue([open()])
        expect(await withdrawTextEdit(form())).toMatchObject({ status: 'ok' })
        const [, projectId, mr, words] = vi.mocked(withdrawMergeRequest).mock.calls[0]
        expect(projectId).toBe(8)
        expect(mr.iid).toBe(50)
        expect(words.mark).toContain('on behalf of **Ewa**')
    })

    it('leaves alone what is not the account’s own or no longer open', async () => {
        vi.mocked(findMergeRequests).mockResolvedValue([open({ author: { id: 7 } } as Partial<MergeRequestRef>), open({ iid: 49, state: 'merged' })])
        expect(await withdrawTextEdit(form())).toMatchObject({ status: 'unchanged' })
        expect(withdrawMergeRequest).not.toHaveBeenCalled()
    })

    it('asks for the right as well', async () => {
        vi.mocked(fetchShareRight).mockResolvedValueOnce('refused')
        expect(await withdrawTextEdit(form())).toMatchObject({ status: 'forbidden' })
        expect(findMergeRequests).not.toHaveBeenCalled()
    })
})
