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
// The package's own check has tests of its own; here it only has to let a package through.
vi.mock('@/lib/export/package-check', () => ({ checkPackage: vi.fn(() => []) }))

import { exportAction, prepareNewVersion } from '@/lib/export-actions'
import { openMergeRequest } from '@/lib/export/gitlab'
import { proposerOf, shareSourceLine, shareSourceOf, withdrawalMark } from '@/lib/export/merge-request-text'
import { followsLine } from '@/lib/export/new-version'
import { readUseCase } from '@/lib/export/portal-reader'
import { fetchShareRight } from '@/lib/export/share-permission'
import { readBundleStatus } from '@/lib/export/status'

/**
 * „Auswählen“ knows the stage, and the update path (rc.7, plan slice 7), on
 * the server: a dataset with another proposal open is refused, a new version
 * after a "no" says what changed (R7) and is refused with a version that is
 * free (R6), and a new version's Steckbrief is filled from a shared one
 * (`prepareNewVersion`, plan of 2026-10-18, section 10.6).
 */

const TARGET = 'https://gitlab.example/group/catalog'
/** The catalogue in a project of its own, where a test says so. */
const CATALOG = 'https://gitlab.example/group/katalog'
const WEB = `${TARGET}/-/merge_requests`
const HERE = 'https://portal.hier.example'
const THERE = 'https://portal.dev.example'
const BOT = { id: 42 }
const DIR = 'packages/baeume'
const SHA = 'a'.repeat(40)

function bundleForm(version: string, extra: Record<string, string> = {}) {
    const data = new FormData()
    const fields = {
        datasetId: 'local', publisher: 'stadt', slug: 'baeume', version, domain: 'environment', displayName: 'Bäume',
        description: 'Stadtbäume', maintainer: 'Stadt', license: 'EUPL-1.2', catalogMetadata: '{}', targetKey: TARGET, intent: 'bundle',
        ...extra,
    }
    for (const [key, value] of Object.entries(fields)) data.set(key, value)
    return data
}

/** A proposal of the account, from dataset `local` here unless said otherwise. */
const request = (iid: number, branch: string, facts: Record<string, unknown> = {}) => ({
    iid,
    web_url: `${WEB}/${iid}`,
    state: 'opened',
    source_branch: branch,
    author: BOT,
    created_at: '2026-10-20T10:00:00Z',
    description: `Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\n${shareSourceLine({ kind: 'dataset', id: 'local', instance: HERE })}`,
    ...facts,
})

/** A second place packages go, where a test sets up two. */
const SECOND = 'https://gitlab.example/group/zweite'

interface Fake {
    /** Merge requests into the target (project 7). */
    requests?: unknown[]
    /** Merge requests into the catalogue's own project (8). */
    catalogRequests?: unknown[]
    /** Merge requests into the second place (9). */
    secondRequests?: unknown[]
    /** Files per `<path>@<ref>` in the target. */
    files?: Record<string, string>
}

/** Target 7 and, where asked, the catalogue 8 and a second place 9; reads only - the writes are mocked. */
function fakeGitLab({ requests = [], catalogRequests = [], secondRequests = [], files = {} }: Fake) {
    const calls: string[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
        const url = new URL(String(input))
        const path = url.pathname.replace(/^\/api\/v4/, '')
        const query = url.searchParams
        calls.push(`${path}${url.search}`)
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
        if (path === '/projects/group%2Fcatalog') return json({ id: 7, path_with_namespace: 'group/catalog', web_url: TARGET, default_branch: 'main' })
        if (path === '/projects/group%2Fkatalog') return json({ id: 8, path_with_namespace: 'group/katalog', web_url: CATALOG, default_branch: 'main' })
        if (path === '/projects/group%2Fzweite') return json({ id: 9, path_with_namespace: 'group/zweite', web_url: SECOND, default_branch: 'main' })
        if (path === '/user') return json({ id: BOT.id, username: 'bot' })
        const listed = path.match(/^\/projects\/(7|8|9)\/merge_requests$/)?.[1]
        if (listed) {
            const branch = query.get('source_branch')
            const all = ({ 7: requests, 8: catalogRequests, 9: secondRequests }[listed] ?? []) as { source_branch: string; state: string }[]
            return json(all.filter((mr) => (!branch || mr.source_branch === branch) && (query.get('state') !== 'opened' || mr.state === 'opened')))
        }
        if (path === '/projects/8/repository/files/index.json/raw') return new Response(JSON.stringify({ version: '1.0.0', useCases: [] }), { status: 200 })
        const file = path.match(/^\/projects\/7\/repository\/files\/(.+)\/raw$/)?.[1]
        if (file) {
            const content = files[`${decodeURIComponent(file)}@${query.get('ref')}`]
            return content === undefined ? json({ message: '404 File Not Found' }, 404) : new Response(content, { status: 200 })
        }
        if (/^\/projects\/(7|8)\/repository\/tree$/.test(path)) return json([])
        return json({ message: `404 ${path}` }, 404)
    }) as typeof fetch
    return { fetchImpl, calls }
}

const EMPTY_SNAPSHOT = { dataset: { id: 'local', name: 'Bäume' }, structures: [], sources: [], sinks: [], mappings: [], pipelines: [], warnings: [] }

beforeEach(() => {
    vi.stubEnv('EXPORT_TARGET_REPOS', JSON.stringify([{ label: 'Katalog', url: TARGET, baseBranch: 'main', pathPrefix: 'packages' }]))
    vi.stubEnv('EXPORT_REPO_TOKEN', 'token')
    vi.stubEnv('REPO_LIST_URL', '')
    vi.stubEnv('CATALOG_REPO_URL', '')
    vi.stubEnv('PORTAL_URL', HERE)
    vi.mocked(readUseCase).mockResolvedValue(EMPTY_SNAPSHOT)
    vi.mocked(readBundleStatus).mockResolvedValue({ state: 'none', reason: 'no-package' })
    vi.mocked(openMergeRequest).mockResolvedValue({ status: 'created', url: `${WEB}/50`, iid: 50 })
})
afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe('a dataset with another proposal open (plan of 2026-10-18, section 10.7)', () => {
    it('is refused a new version, before anything is built, with the reading to grey it out', async () => {
        vi.stubGlobal('fetch', fakeGitLab({ requests: [request(31, 'export/baeume-1.1.0')] }).fetchImpl)
        const result = await exportAction(null, bundleForm('1.2.0'))
        expect(result).toMatchObject({ intent: 'bundle', status: 'invalid', busy: true, mrUrl: `${WEB}/31` })
        expect(result.detail).toBe(
            'Nicht eingereicht: Für diesen Datensatz läuft schon ein Vorschlag (Version 1.1.0, Paket-Prüfung, Vorschlag !31). Eine neue Version geht erst, wenn er entschieden oder zurückgezogen ist - weiter geht es unter „In Arbeit“.',
        )
        expect(readUseCase).not.toHaveBeenCalled()
        expect(openMergeRequest).not.toHaveBeenCalled()
    })

    it('counts an entry proposal open in the catalogue’s own project too', async () => {
        vi.stubEnv('REPO_LIST_URL', `${CATALOG}/-/raw/main/index.json`)
        vi.stubGlobal('fetch', fakeGitLab({ catalogRequests: [request(8, 'catalog/baeume-1.1.0', { web_url: `${CATALOG}/-/merge_requests/8` })] }).fetchImpl)
        const result = await exportAction(null, bundleForm('1.2.0'))
        expect(result).toMatchObject({ status: 'invalid', busy: true, mrUrl: `${CATALOG}/-/merge_requests/8` })
        expect(result.detail).toContain('(Version 1.1.0, Eintrags-Prüfung, Vorschlag !8)')
        expect(openMergeRequest).not.toHaveBeenCalled()
    })

    it('counts one open in a second place packages go: „Auswählen“ greys it out for every one', async () => {
        vi.stubEnv('EXPORT_TARGET_REPOS', JSON.stringify([
            { label: 'Katalog', url: TARGET, baseBranch: 'main', pathPrefix: 'packages' },
            { label: 'Zweite', url: SECOND, baseBranch: 'main', pathPrefix: 'packages' },
        ]))
        vi.stubGlobal('fetch', fakeGitLab({ secondRequests: [request(5, 'export/baeume-1.1.0', { web_url: `${SECOND}/-/merge_requests/5` })] }).fetchImpl)
        const result = await exportAction(null, bundleForm('1.2.0'))
        expect(result).toMatchObject({ status: 'invalid', busy: true, mrUrl: `${SECOND}/-/merge_requests/5` })
        expect(openMergeRequest).not.toHaveBeenCalled()
    })

    it('lets it through next to an open proposal of another dataset, another instance or another account, and a closed one', async () => {
        const closedAt = '2026-10-21T10:00:00Z'
        const requests = [
            request(31, 'export/eichen-1.0.0', { description: shareSourceLine({ kind: 'dataset', id: 'anders', instance: HERE }) }),
            request(32, 'export/baeume-1.1.0', { description: shareSourceLine({ kind: 'dataset', id: 'local', instance: THERE }) }),
            request(33, 'export/baeume-1.1.1', { author: { id: 7 } }),
            // Withdrawn: it decided nothing, so the new version follows no "no" either (R8).
            request(34, 'export/baeume-1.1.2', { state: 'closed', closed_at: closedAt, description: `${request(0, '').description}\n${withdrawalMark('Ewa', new Date(closedAt))}` }),
        ]
        vi.stubGlobal('fetch', fakeGitLab({ requests }).fetchImpl)
        const result = await exportAction(null, bundleForm('1.2.0'))
        expect(result.status).toBe('ok')
        expect(result.busy).toBeUndefined()
        expect(openMergeRequest).toHaveBeenCalledTimes(1)
    })
})

describe('a new version after a "no" (R7 of 2026-10-22)', () => {
    const follows = JSON.stringify({ iid: 31, url: `${WEB}/31`, closedAt: '2026-10-22T10:00:23Z' })

    it('says in its proposal which "no" it follows and what changed, in the person’s words, under the line naming them', async () => {
        vi.stubGlobal('fetch', fakeGitLab({}).fetchImpl)
        const result = await exportAction(null, bundleForm('1.1.5', { follows, changeNote: 'Lizenz ergänzt.' }))
        expect(result.status).toBe('ok')
        const { description } = vi.mocked(openMergeRequest).mock.calls[0][1]
        const lines = description.split('\n')
        expect(lines[2]).toBe(followsLine({ iid: 31, url: `${WEB}/31`, closedAt: '2026-10-22T10:00:23Z' }, 'Lizenz ergänzt.', 'Test'))
        expect(lines[2]).toBe(`Follows [!31](${WEB}/31) (not accepted on 2026-10-22). What changed, in Test's words: "Lizenz ergänzt."`)
        // What the listing reads back stays as it was.
        expect(proposerOf(description)).toBe('Test')
        expect(shareSourceOf(description)).toEqual({ kind: 'dataset', id: 'local', instance: HERE })
    })

    it('asks for the change before the preview already, in 1 to 500 characters, and only where a "no" is followed', async () => {
        for (const intent of ['preview', 'bundle']) {
            const empty = await exportAction(null, bundleForm('1.1.5', { follows, changeNote: '  ', intent }))
            expect(empty).toMatchObject({ status: 'invalid', detail: 'Was hast du geändert? Bitte kurz beschreiben - das Katalog-Team liest es im neuen Vorschlag.' })
            const long = await exportAction(null, bundleForm('1.1.5', { follows, changeNote: 'x'.repeat(501), intent }))
            expect(long.detail).toBe('Was hast du geändert? Bitte höchstens 500 Zeichen.')
        }
        expect(readUseCase).not.toHaveBeenCalled()
        // No "no" to follow, nothing asked: the preview is made.
        expect((await exportAction(null, bundleForm('1.1.5', { intent: 'preview' }))).status).toBe('ok')
    })

    /** The package of 1.1.0 turned down by a reviewer, from here unless said otherwise. */
    const turnedDown = (facts: Record<string, unknown> = {}) =>
        request(40, 'export/baeume-1.1.0', { state: 'closed', closed_at: '2026-10-21T10:00:00Z', closed_by: { id: 99, username: 'kurator' }, user_notes_count: 0, ...facts })

    it('is refused without the change where the page did not know the "no" - the answer carries it, so the Steckbrief asks', async () => {
        vi.stubGlobal('fetch', fakeGitLab({ requests: [turnedDown()] }).fetchImpl)
        const result = await exportAction(null, bundleForm('1.2.0'))
        expect(result).toMatchObject({
            intent: 'bundle',
            status: 'invalid',
            follows: { version: '1.1.0', kind: 'package', decline: { iid: 40, mrUrl: `${WEB}/40`, closedBy: 'kurator', reason: { kind: 'none' } } },
        })
        expect(result.detail).toBe(
            'Nicht eingereicht: Version 1.1.0 hat das Katalog-Team am 21.10. nicht angenommen. Schreib im Steckbrief unter „Was hast du geändert?“, was die neue Version anders macht - das Katalog-Team liest es im neuen Vorschlag.',
        )
        expect(readUseCase).not.toHaveBeenCalled()
        expect(openMergeRequest).not.toHaveBeenCalled()
    })

    it('names the "no" as GitLab tells it, with the person’s words, where the page named another', async () => {
        vi.stubGlobal('fetch', fakeGitLab({ requests: [turnedDown()] }).fetchImpl)
        const result = await exportAction(null, bundleForm('1.2.0', { follows, changeNote: 'Lizenz ergänzt.' }))
        expect(result.status).toBe('ok')
        const { description } = vi.mocked(openMergeRequest).mock.calls[0][1]
        expect(description.split('\n')[2]).toBe(`Follows [!40](${WEB}/40) (not accepted on 2026-10-21). What changed, in Test's words: "Lizenz ergänzt."`)
    })

    it('asks nothing after another instance’s "no", nor after a withdrawal on top of an acceptance', async () => {
        const elsewhere = turnedDown({ description: `Proposed by the Open Urban Apps marketplace on behalf of **Kim**.\n\n${shareSourceLine({ kind: 'dataset', id: 'dort', instance: THERE })}` })
        vi.stubGlobal('fetch', fakeGitLab({ requests: [elsewhere] }).fetchImpl)
        expect((await exportAction(null, bundleForm('1.2.0'))).status).toBe('ok')
        const closedAt = '2026-10-21T10:00:00Z'
        const withdrawnOne = request(41, 'export/baeume-1.1.5', { state: 'closed', closed_at: closedAt, description: `${request(0, '').description}\n${withdrawalMark('Ewa', new Date(closedAt))}` })
        vi.stubGlobal('fetch', fakeGitLab({ requests: [request(39, 'export/baeume-1.1.0', { state: 'merged' }), withdrawnOne] }).fetchImpl)
        expect((await exportAction(null, bundleForm('1.2.0'))).status).toBe('ok')
    })

    describe('with the catalogue in a project of its own', () => {
        const id = '`urn:stadt:usecase:baeume`'
        /** The entry of 1.1.0, closed through the marketplace's account without a word, as !32 was. */
        const entryNo = request(32, 'catalog/baeume-1.1.0', {
            web_url: `${CATALOG}/-/merge_requests/32`,
            state: 'closed',
            closed_at: '2026-10-22T10:00:28Z',
            closed_by: { id: BOT.id, username: 'walkable.cities.2021' },
            user_notes_count: 0,
            description: `Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\nPackage ${id}\n\n${shareSourceLine({ kind: 'dataset', id: 'local', instance: HERE })}`,
        })
        beforeEach(() => vi.stubEnv('REPO_LIST_URL', `${CATALOG}/-/raw/main/index.json`))

        it('asks after a "no" to the entry of the version before, and takes a reference to it there', async () => {
            const fake = { requests: [request(39, 'export/baeume-1.1.0', { state: 'merged' })], catalogRequests: [entryNo] }
            vi.stubGlobal('fetch', fakeGitLab(fake).fetchImpl)
            const refused = await exportAction(null, bundleForm('1.2.0'))
            expect(refused).toMatchObject({ status: 'invalid', follows: { version: '1.1.0', kind: 'entry', decline: { iid: 32, viaMarketplace: true } } })
            expect(refused.detail).toContain('Der Katalog-Eintrag für Version 1.1.0 wurde am 22.10. nicht angenommen (über das Marktplatz-Konto geschlossen).')
            vi.stubGlobal('fetch', fakeGitLab(fake).fetchImpl)
            const ref = JSON.stringify({ iid: 32, url: `${CATALOG}/-/merge_requests/32`, closedAt: '2026-10-22T10:00:28Z' })
            const result = await exportAction(null, bundleForm('1.2.0', { follows: ref, changeNote: 'Neue Karte.' }))
            expect(result.status).toBe('ok')
            expect(vi.mocked(openMergeRequest).mock.calls[0][1].description).toContain(`Follows [!32](${CATALOG}/-/merge_requests/32) (not accepted on 2026-10-22).`)
        })

        it('refuses the version itself once it left the repository: its entry is used up, and the same number would get none (R2)', async () => {
            vi.stubGlobal('fetch', fakeGitLab({ requests: [request(39, 'export/baeume-1.1.0', { state: 'merged' })], catalogRequests: [entryNo] }).fetchImpl)
            const result = await exportAction(null, bundleForm('1.1.0'))
            expect(result).toMatchObject({ status: 'invalid', mrUrl: `${CATALOG}/-/merge_requests/32` })
            expect(result.detail).toBe(
                'Nicht eingereicht: Der Katalog-Eintrag für Version 1.1.0 wurde am 22.10. nicht angenommen (über das Marktplatz-Konto geschlossen). Trag im Steckbrief eine höhere Version ein, zum Beispiel 1.1.1.',
            )
            expect(openMergeRequest).not.toHaveBeenCalled()
        })
    })

    it('refuses a reference that is no proposal of the place or the catalogue', async () => {
        vi.stubGlobal('fetch', fakeGitLab({}).fetchImpl)
        for (const other of [JSON.stringify({ iid: 3, url: 'https://gitlab.example/andere/gruppe/-/merge_requests/3' }), 'kein JSON']) {
            const result = await exportAction(null, bundleForm('1.1.5', { follows: other, changeNote: 'Lizenz ergänzt.' }))
            expect(result).toMatchObject({ status: 'invalid', detail: 'Die Angabe zum nicht angenommenen Vorschlag ist ungültig - bitte die Seite neu laden.' })
        }
        expect(openMergeRequest).not.toHaveBeenCalled()
    })
})

describe('the version a refusal names (R6 of 2026-10-22)', () => {
    it('is above every version of the package the account proposed, not only one above the refused one (R1)', async () => {
        const declined = { iid: 31, mrUrl: `${WEB}/31`, closedAt: '2026-10-22T10:00:00Z', closedBy: 'spaudanjo', reason: { kind: 'none' as const } }
        vi.mocked(readBundleStatus).mockResolvedValue({ state: 'none', reason: 'no-package', declined, mrUrl: declined.mrUrl })
        const requests = [
            request(40, 'export/baeume-1.1.1', { state: 'closed', closed_at: '2026-10-21T10:00:00Z', closed_by: { id: 99, username: 'kurator' } }),
            request(41, 'export/baeume-1.1.3', { state: 'merged' }),
            // Withdrawn: the same number may go again, so it is free.
            request(42, 'export/baeume-1.1.5', { state: 'closed', closed_at: '2026-10-21T10:00:00Z', description: withdrawalMark('Ewa', new Date('2026-10-21T10:00:00Z')) }),
            request(43, 'export/eichen-2.0.0'),
        ]
        vi.stubGlobal('fetch', fakeGitLab({ requests }).fetchImpl)
        const result = await exportAction(null, bundleForm('1.1.0'))
        expect(result.detail).toBe('Nicht eingereicht: Version 1.1.0 hat das Katalog-Team am 22.10. nicht angenommen. Trag im Steckbrief eine höhere Version ein, zum Beispiel 1.1.4.')
    })
})

describe('the Steckbrief of a new version, from a shared one (prepareNewVersion, plan of 2026-10-18, section 10.6)', () => {
    const manifest = JSON.stringify({
        id: 'urn:stadt:usecase:baeume',
        displayName: 'Bäume',
        description: 'Stadtbäume',
        version: '1.1.0',
        maintainer: 'Stadt',
        license: 'EUPL-1.2',
        keywords: ['bäume'],
        themes: ['umwelt-klima'],
        contact: { email: 'amt@stadt.example' },
        members: {},
    })
    /** The version's package proposal, closed (withdrawn or turned down); `source: null` for one made before rc.6, without a source line. */
    const shared = (facts: Record<string, unknown> = {}, source: string | null = shareSourceLine({ kind: 'dataset', id: 'local', instance: HERE })) =>
        request(31, 'export/baeume-1.1.0', {
            state: 'closed',
            sha: SHA,
            description: ['Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.', '', 'Publisher `stadt`, domain `environment`', '', ...(source ? [source] : [])].join('\n'),
            ...facts,
        })
    const atSha = { [`${DIR}/core-ir/manifest.json@${SHA}`]: manifest }

    it('is not read without the right to share, nor for a place, short name or version that is no such thing', async () => {
        const gitlab = fakeGitLab({ requests: [shared()], files: atSha })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        vi.mocked(fetchShareRight).mockResolvedValueOnce('refused')
        expect((await prepareNewVersion(TARGET, 'baeume', '1.1.0')).status).toBe('forbidden')
        expect(await prepareNewVersion('https://gitlab.example/anders', 'baeume', '1.1.0')).toMatchObject({ status: 'unconfigured' })
        expect(await prepareNewVersion(TARGET, 'Bäume', '1.1.0')).toMatchObject({ status: 'invalid', detail: 'Ungültiger Kurzname oder ungültige Version.' })
        expect(await prepareNewVersion(TARGET, 'baeume', '1.1')).toMatchObject({ status: 'invalid' })
        expect(gitlab.calls).toEqual([])
    })

    it('copies every field from a share of this instance, read at its proposal’s last commit, also where it was withdrawn or turned down', async () => {
        const gitlab = fakeGitLab({ requests: [shared()], files: atSha })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        const answer = await prepareNewVersion(TARGET, 'baeume', '1.1.0')
        expect(answer).toEqual({
            status: 'ok',
            steckbrief: {
                from: '1.1.0',
                targetKey: TARGET,
                displayName: 'Bäume',
                description: 'Stadtbäume',
                publisher: 'stadt',
                slug: 'baeume',
                domain: 'environment',
                maintainer: 'Stadt',
                license: 'EUPL-1.2',
                keywords: 'bäume',
                metadata: { themes: ['umwelt-klima'], contact: { email: 'amt@stadt.example' } },
                full: true,
            },
        })
        expect(gitlab.calls).toContain(`/projects/7/repository/files/${encodeURIComponent(`${DIR}/core-ir/manifest.json`)}/raw?ref=${SHA}`)
        // The source line says where it came from: no README needed.
        expect(gitlab.calls.some((call) => call.includes('README'))).toBe(false)
    })

    it('copies only the package’s own fields from a share of another instance, or of one that names none (D12)', async () => {
        for (const [source, elsewhere] of [[shareSourceLine({ kind: 'dataset', id: 'local', instance: THERE }), true], [shareSourceLine({ kind: 'dataset', id: 'local' }), undefined]] as const) {
            vi.stubGlobal('fetch', fakeGitLab({ requests: [shared({}, source)], files: atSha }).fetchImpl)
            const answer = await prepareNewVersion(TARGET, 'baeume', '1.1.0')
            expect(answer.steckbrief).toMatchObject({ displayName: 'Bäume', maintainer: 'Stadt', full: false })
            expect(answer.steckbrief?.metadata).toEqual({ themes: ['umwelt-klima'] })
            // The notice over the form says another instance only where the share names one.
            expect(answer.steckbrief?.elsewhere).toBe(elsewhere)
        }
    })

    it('reads the newest proposal where a removal undid the acceptance before it - its text is the newer one', async () => {
        const before = shared({ iid: 10, state: 'merged', sha: 'b'.repeat(40), created_at: '2026-10-01T10:00:00Z' })
        const removal = request(11, 'remove/baeume-1.1.0', { state: 'merged', created_at: '2026-10-04T10:00:00Z', merged_at: '2026-10-05T10:00:00Z' })
        const again = shared({ iid: 12, state: 'closed', sha: 'c'.repeat(40), created_at: '2026-10-10T10:00:00Z' })
        const gitlab = fakeGitLab({ requests: [again, removal, before], files: { [`${DIR}/core-ir/manifest.json@${'c'.repeat(40)}`]: manifest } })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        expect((await prepareNewVersion(TARGET, 'baeume', '1.1.0')).status).toBe('ok')
        expect(gitlab.calls.some((call) => call.endsWith(`ref=${'b'.repeat(40)}`))).toBe(false)
    })

    it('asks the README at that commit for older shares without a source line', async () => {
        const readme = (instance?: string) => `# Bäume\n\nShared from a running instance\n(dataset \`Bäume\`, id \`local\`${instance ? `, instance ${instance}` : ''}).\n`
        for (const [instance, full] of [[HERE, true], [undefined, false]] as const) {
            vi.stubGlobal('fetch', fakeGitLab({ requests: [shared({}, null)], files: { ...atSha, [`${DIR}/README.md@${SHA}`]: readme(instance) } }).fetchImpl)
            expect((await prepareNewVersion(TARGET, 'baeume', '1.1.0')).steckbrief?.full).toBe(full)
        }
    })

    it('reads the accepted proposal where a newer one on the branch was closed (bodenfeuchte !19 and !21)', async () => {
        const accepted = shared({ iid: 19, state: 'merged', sha: 'b'.repeat(40), created_at: '2026-10-01T10:00:00Z' })
        const later = shared({ iid: 21, state: 'closed', sha: 'c'.repeat(40), created_at: '2026-10-15T10:00:00Z' })
        const gitlab = fakeGitLab({ requests: [later, accepted], files: { [`${DIR}/core-ir/manifest.json@${'b'.repeat(40)}`]: manifest } })
        vi.stubGlobal('fetch', gitlab.fetchImpl)
        expect((await prepareNewVersion(TARGET, 'baeume', '1.1.0')).status).toBe('ok')
        expect(gitlab.calls.some((call) => call.endsWith(`ref=${'c'.repeat(40)}`))).toBe(false)
    })

    it('says so where this marketplace shared no such version, or its package is not at that commit, or GitLab fails', async () => {
        const notShared = 'Version 1.1.0 von „baeume“ ist nicht über diesen Marktplatz geteilt.'
        vi.stubGlobal('fetch', fakeGitLab({ requests: [shared({ author: { id: 7 } })], files: atSha }).fetchImpl)
        expect(await prepareNewVersion(TARGET, 'baeume', '1.1.0')).toEqual({ status: 'missing', detail: notShared })
        vi.stubGlobal('fetch', fakeGitLab({ requests: [shared()] }).fetchImpl)
        expect(await prepareNewVersion(TARGET, 'baeume', '1.1.0')).toEqual({ status: 'missing', detail: notShared })
        vi.stubGlobal('fetch', (async () => new Response(JSON.stringify({ message: 'boom' }), { status: 500 })) as typeof fetch)
        expect((await prepareNewVersion(TARGET, 'baeume', '1.1.0')).status).toBe('error')
    })
})
