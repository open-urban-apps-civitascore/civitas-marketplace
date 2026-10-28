// GitLab side of sharing. It only proposes, or withdraws the bot's own proposal: no code path merges.

import { sinceStart, startedOver } from '@/lib/export/declines'
import { declineReasonOf, withdrawalMarkIn, withdrawalNoteIn, type DeclineReason } from '@/lib/export/merge-request-text'

export class GitLabError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message)
        this.name = 'GitLabError'
    }
}

export class HeldBranchError extends GitLabError {
    constructor(readonly held: MergeRequestRef) {
        super(
            `Vorschlag !${held.iid} wurde nicht angenommen. Er bleibt bei GitLab, wie er ist, damit das Katalog-Team ihn wieder öffnen kann - von hier wird er nicht noch einmal vorgeschlagen. Lade die Seite neu, dort steht, wie es weitergeht.`,
            0,
        )
        this.name = 'HeldBranchError'
    }
}

export function gitlabMessage(error: GitLabError): string {
    switch (error.status) {
        case 0:
            return error.message
        case 401:
            return 'GitLab lehnt den hinterlegten Token ab (401) - ungültig oder abgelaufen.'
        case 403:
            return `GitLab verweigert die Aktion (403): ${error.message}`
        case 404:
            return `GitLab: ${error.message} - bei privaten Projekten auch, wenn der Token dort keinen Zugriff hat.`
        default:
            return `GitLab-Fehler (${error.status}): ${error.message}`
    }
}

export interface GitLabClient {
    /** e.g. `https://gitlab.com/api/v4` */
    apiBase: string
    token: string
    fetchImpl?: typeof fetch
    cache?: GitLabReadCache
    /** Reads only; writes never time out. */
    timeoutMs?: number
}

/** Reads only: giving up on a write would not undo it, only hide whether it happened. */
export const READ_TIMEOUT_MS = 10_000

const COMMIT_SHA = /^[0-9a-f]{40}$/i

/** Only for answers that cannot change. The key leaves out the token: one deployment has one token. */
export class GitLabReadCache {
    private readonly entries = new Map<string, Promise<unknown>>()

    constructor(private readonly limit = 1000) {}

    read<T>(key: string, load: () => Promise<T>): Promise<T> {
        const known = this.entries.get(key)
        if (known) return known as Promise<T>
        const pending: Promise<T> = load().catch((error: unknown) => {
            // A newer attempt under the same key stays.
            if (this.entries.get(key) === pending) this.entries.delete(key)
            throw error
        })
        this.entries.set(key, pending)
        while (this.entries.size > this.limit) {
            const oldest = this.entries.keys().next().value
            if (oldest === undefined) break
            this.entries.delete(oldest)
        }
        return pending
    }

    get size(): number {
        return this.entries.size
    }

    clear(): void {
        this.entries.clear()
    }
}

export function readOnce<T>(client: GitLabClient, key: string, immutable: boolean, load: () => Promise<T>): Promise<T> {
    return client.cache && immutable ? client.cache.read(`${client.apiBase}|${key}`, load) : load()
}

function readSignal(client: GitLabClient, method: string): AbortSignal | undefined {
    return method === 'GET' ? AbortSignal.timeout(client.timeoutMs ?? READ_TIMEOUT_MS) : undefined
}

const isTimeout = (cause: unknown) => cause instanceof Error && cause.name === 'TimeoutError'

function bodyFailure(client: GitLabClient, cause: unknown): unknown {
    return isTimeout(cause) ? unreachable(client, cause) : cause
}

function unreachable(client: GitLabClient, cause: unknown): GitLabError {
    if (isTimeout(cause)) {
        return new GitLabError(`GitLab hat nicht innerhalb von ${Math.round((client.timeoutMs ?? READ_TIMEOUT_MS) / 1000)} s geantwortet`, 0)
    }
    return new GitLabError(`GitLab ist nicht erreichbar: ${String(cause)}`, 0)
}

export interface GitLabProject {
    id: number
    path_with_namespace: string
    web_url: string
    default_branch: string
    import_status?: string
    forked_from_project?: { id: number }
    permissions?: {
        project_access?: { access_level: number } | null
        group_access?: { access_level: number } | null
    }
}

export interface MergeRequestRef {
    iid: number
    web_url: string
    state: 'opened' | 'merged' | 'closed' | 'locked' | string
    source_branch: string
    source_project_id?: number
    /** Head of the source branch; readable in the target project too, also after the merge. */
    sha?: string
    merge_commit_sha?: string | null
    squash_commit_sha?: string | null
    title?: string
    description?: string | null
    author?: { id: number; username?: string } | null
    closed_by?: { id: number; username?: string } | null
    /** Older GitLab versions set only the deprecated `merged_by`. */
    merge_user?: { id: number; username?: string } | null
    merged_by?: { id: number; username?: string } | null
    created_at?: string
    closed_at?: string | null
    merged_at?: string | null
    updated_at?: string
    user_notes_count?: number
}

export interface MergeRequestNote {
    body: string
    /** GitLab's own note ("closed", "reopened"). */
    system?: boolean
    author?: { id: number; username?: string } | null
    created_at?: string
}

export function newestFirst<T extends { created_at?: string | null }>(requests: readonly T[]): T[] {
    return [...requests].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
}

export function parseProjectUrl(url: string): { apiBase: string; projectPath: string } {
    const parsed = new URL(url)
    const projectPath = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')
    if (!projectPath.includes('/')) {
        throw new GitLabError(`${url} ist keine GitLab-Projekt-URL (group/project erwartet)`, 0)
    }
    return { apiBase: `${parsed.origin}/api/v4`, projectPath }
}

export function clientFor(url: string, token: string, fetchImpl?: typeof fetch): GitLabClient {
    return { apiBase: parseProjectUrl(url).apiBase, token, fetchImpl }
}

async function gl<T>(
    client: GitLabClient,
    path: string,
    init?: { method: string; body?: unknown },
): Promise<T> {
    const doFetch = client.fetchImpl ?? fetch
    const method = init?.method ?? 'GET'
    let response: Response
    try {
        response = await doFetch(`${client.apiBase}${path}`, {
            method,
            headers: {
                'PRIVATE-TOKEN': client.token,
                ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
            cache: 'no-store',
            signal: readSignal(client, method),
        })
    } catch (cause) {
        throw unreachable(client, cause)
    }
    if (response.status === 404) {
        throw new GitLabError(`nicht gefunden: ${path}`, 404)
    }
    if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as
            | { message?: unknown; error?: string }
            | null
        const message =
            typeof problem?.message === 'string'
                ? problem.message
                : problem?.message
                  ? JSON.stringify(problem.message)
                  : (problem?.error ?? `${response.status} ${response.statusText}`)
        throw new GitLabError(message, response.status)
    }
    if (response.status === 204) return undefined as T
    try {
        return (await response.json()) as T
    } catch (cause) {
        // The time limit also covers the body, which can stall after the headers arrived.
        throw bodyFailure(client, cause)
    }
}

const encode = (value: string) => encodeURIComponent(value)

/** Cached for the server's life, permissions too: a changed access level shows after a restart. */
export async function getProject(client: GitLabClient, projectPath: string): Promise<GitLabProject> {
    return readOnce(client, `project|${projectPath}`, true, () => gl<GitLabProject>(client, `/projects/${encode(projectPath)}`))
}

/** 30 = Developer, the lowest level that may push branches. */
export function canPush(project: GitLabProject): boolean {
    const levels = [
        project.permissions?.project_access?.access_level ?? 0,
        project.permissions?.group_access?.access_level ?? 0,
    ]
    return Math.max(...levels) >= 30
}

export async function ensureFork(client: GitLabClient, upstream: GitLabProject): Promise<GitLabProject> {
    const owned = await gl<GitLabProject[]>(
        client,
        `/projects/${upstream.id}/forks?owned=true&per_page=100`,
    )
    let fork = owned[0]
    if (!fork) {
        fork = await gl<GitLabProject>(client, `/projects/${upstream.id}/fork`, { method: 'POST' })
    }
    const deadline = Date.now() + 60_000
    while (fork.import_status && fork.import_status !== 'finished' && fork.import_status !== 'none') {
        if (fork.import_status === 'failed') {
            throw new GitLabError('Die Arbeitskopie des Ablageorts (Fork) konnte nicht angelegt werden', 500)
        }
        if (Date.now() > deadline) {
            throw new GitLabError('Die Arbeitskopie des Ablageorts (Fork) ist nach 60 s noch nicht bereit - bitte erneut versuchen', 504)
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
        fork = await gl<GitLabProject>(client, `/projects/${fork.id}`)
    }
    return fork
}

export async function branchHead(
    client: GitLabClient,
    projectId: number,
    branch: string,
): Promise<string | undefined> {
    try {
        const info = await gl<{ commit: { id: string } }>(
            client,
            `/projects/${projectId}/repository/branches/${encode(branch)}`,
        )
        return info.commit.id
    } catch (error) {
        if (error instanceof GitLabError && error.status === 404) return undefined
        throw error
    }
}

export async function listTree(
    client: GitLabClient,
    projectId: number,
    path: string,
    ref: string,
): Promise<string[]> {
    return [...(await listBlobs(client, projectId, path, ref)).keys()]
}

/** Path to blob id, git's hash of the content: equal ids mean equal files. */
export function listBlobs(
    client: GitLabClient,
    projectId: number,
    path: string,
    ref: string,
): Promise<Map<string, string>> {
    return readOnce(client, `blobs|${projectId}|${path}|${ref}`, COMMIT_SHA.test(ref), async () => {
        const files = new Map<string, string>()
        for (let page = 1; ; page++) {
            let batch: { id: string; path: string; type: string }[]
            try {
                batch = await gl(
                    client,
                    `/projects/${projectId}/repository/tree?recursive=true&per_page=100&page=${page}` +
                        `&ref=${encode(ref)}${path && path !== '.' ? `&path=${encode(path)}` : ''}`,
                )
            } catch (error) {
                if (error instanceof GitLabError && error.status === 404) return files
                throw error
            }
            for (const entry of batch) if (entry.type === 'blob') files.set(entry.path, entry.id)
            if (batch.length < 100) break
            if (files.size > 5000) {
                throw new GitLabError('Der Ordner im Ablageort enthält mehr als 5000 Dateien - das ist kein Paketordner', 413)
            }
        }
        return files
    })
}

export async function commitParents(client: GitLabClient, projectId: number, sha: string): Promise<string[]> {
    const commit = await readOnce(client, `commit|${projectId}|${sha}`, COMMIT_SHA.test(sha), () =>
        gl<{ parent_ids?: string[] }>(client, `/projects/${projectId}/repository/commits/${encode(sha)}`),
    )
    return commit.parent_ids ?? []
}

/** Base branch just before a merge: first parent of the merge, squash or (fast-forward) oldest commit. */
export async function commitBefore(client: GitLabClient, projectId: number, merged: MergeRequestRef): Promise<string | undefined> {
    const landed =
        merged.merge_commit_sha ?? merged.squash_commit_sha ?? (await mergeRequestCommits(client, projectId, merged.iid, true)).at(-1)?.id
    return landed ? (await commitParents(client, projectId, landed))[0] : undefined
}

export function readFile(
    client: GitLabClient,
    projectId: number,
    path: string,
    ref: string,
): Promise<string | undefined> {
    return readOnce(client, `file|${projectId}|${path}|${ref}`, COMMIT_SHA.test(ref), async () => {
        const doFetch = client.fetchImpl ?? fetch
        let response: Response
        try {
            response = await doFetch(
                `${client.apiBase}/projects/${projectId}/repository/files/${encode(path)}/raw?ref=${encode(ref)}`,
                { headers: { 'PRIVATE-TOKEN': client.token }, cache: 'no-store', signal: readSignal(client, 'GET') },
            )
        } catch (cause) {
            throw unreachable(client, cause)
        }
        if (response.status === 404) return undefined
        if (!response.ok) {
            throw new GitLabError(`Datei ${path} konnte nicht gelesen werden (${response.status})`, response.status)
        }
        try {
            return await response.text()
        } catch (cause) {
            throw bodyFailure(client, cause)
        }
    })
}

/** Newest created first: a late comment on an older proposal must not make it the newest. */
export async function findMergeRequests(
    client: GitLabClient,
    targetProjectId: number,
    sourceBranch: string,
): Promise<MergeRequestRef[]> {
    return newestFirst(
        await gl<MergeRequestRef[]>(
            client,
            `/projects/${targetProjectId}/merge_requests?source_branch=${encode(sourceBranch)}&state=all&order_by=created_at&sort=desc&per_page=20`,
        ),
    )
}

export async function listOpenMergeRequests(client: GitLabClient, projectId: number): Promise<MergeRequestRef[]> {
    const requests: MergeRequestRef[] = []
    for (let page = 1; ; page++) {
        const batch = await gl<MergeRequestRef[]>(
            client,
            `/projects/${projectId}/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=100&page=${page}`,
        )
        requests.push(...batch)
        if (batch.length < 100 || page >= 10) return requests
    }
}

export async function currentUser(client: GitLabClient): Promise<{ id: number; username: string }> {
    return readOnce(client, 'bot', true, () => gl<{ id: number; username: string }>(client, '/user'))
}

export const AUTHOR_PAGES = 3

/** By creation: by last change, a comment on an old proposal could push a newer one off the last page. */
export async function listMergeRequestsBy(
    client: GitLabClient,
    targetProjectId: number,
    authorId: number,
): Promise<MergeRequestRef[]> {
    const requests: MergeRequestRef[] = []
    for (let page = 1; page <= AUTHOR_PAGES; page++) {
        const batch = await gl<MergeRequestRef[]>(
            client,
            `/projects/${targetProjectId}/merge_requests?author_id=${authorId}&state=all&order_by=created_at&sort=desc&per_page=100&page=${page}`,
        )
        requests.push(...batch)
        if (batch.length < 100) break
    }
    return requests
}

/** Newest first. Cached only when `merged`: then its commits can no longer change. */
export function mergeRequestCommits(
    client: GitLabClient,
    projectId: number,
    iid: number,
    merged = false,
): Promise<{ id: string }[]> {
    return readOnce(client, `mr-commits|${projectId}|${iid}`, merged, () =>
        gl<{ id: string }[]>(client, `/projects/${projectId}/merge_requests/${iid}/commits?per_page=100`),
    )
}

/** Newest first. Cached per `updatedAt`, which every new comment or reopen moves. */
export function mergeRequestNotes(
    client: GitLabClient,
    projectId: number,
    iid: number,
    updatedAt: string | undefined,
): Promise<MergeRequestNote[]> {
    return readOnce(client, `mr-notes|${projectId}|${iid}|${updatedAt}`, Boolean(updatedAt), () =>
        gl<MergeRequestNote[]>(client, `/projects/${projectId}/merge_requests/${iid}/notes?sort=desc&order_by=created_at&per_page=100`),
    )
}

export interface Closing {
    withdrawnBy?: string
    reason?: DeclineReason
}

/** Throws when the comments cannot be read, so nothing is claimed about the catalogue team. */
export async function readClosing(client: GitLabClient, projectId: number, mr: MergeRequestRef): Promise<Closing> {
    const marked = withdrawalMarkIn(mr.description, mr.closed_at)
    if (marked) return { withdrawnBy: marked }
    // The old withdrawal note is a comment too, so there is none either.
    if (mr.user_notes_count === 0) return { reason: { kind: 'none' } }
    const notes = await mergeRequestNotes(client, projectId, mr.iid, mr.updated_at)
    const noted = withdrawalNoteIn(mr, notes)
    return noted ? { withdrawnBy: noted } : { reason: declineReasonOf(mr, notes) }
}

export function directoryTrees(
    client: GitLabClient,
    projectId: number,
    parent: string,
    ref: string,
): Promise<Map<string, string>> {
    return readOnce(client, `trees|${projectId}|${parent}|${ref}`, COMMIT_SHA.test(ref), async () => {
        const trees = new Map<string, string>()
        for (let page = 1; ; page++) {
            let batch: { id: string; name: string; type: string }[]
            try {
                batch = await gl(
                    client,
                    `/projects/${projectId}/repository/tree?per_page=100&page=${page}&ref=${encode(ref)}` +
                        (parent ? `&path=${encode(parent)}` : ''),
                )
            } catch (error) {
                if (error instanceof GitLabError && error.status === 404) return trees
                throw error
            }
            for (const entry of batch) if (entry.type === 'tree') trees.set(entry.name, entry.id)
            if (batch.length < 100) return trees
        }
    })
}

/** Git's hash over a folder: equal ids mean equal contents, even after a rebase or squash. */
export async function treeIdOf(
    client: GitLabClient,
    projectId: number,
    dir: string,
    ref: string,
): Promise<string | undefined> {
    const parts = dir.split('/').filter(Boolean)
    const name = parts.pop()
    if (!name) return undefined
    return (await directoryTrees(client, projectId, parts.join('/'), ref)).get(name)
}

/**
 * Closes with `mark` in one request, else the close reads as the team's "no"; a failed close fails all.
 * The note and the branch deletion are best effort; the next proposal replaces a leftover branch.
 */
export async function withdrawMergeRequest(
    client: GitLabClient,
    projectId: number,
    mr: MergeRequestRef,
    { note, mark }: { note: string; mark: string },
): Promise<void> {
    const description = mr.description?.trimEnd() ? `${mr.description.trimEnd()}\n\n${mark}` : mark
    await gl(client, `/projects/${projectId}/merge_requests/${mr.iid}`, { method: 'PUT', body: { state_event: 'close', description } })
    await gl(client, `/projects/${projectId}/merge_requests/${mr.iid}/notes`, { method: 'POST', body: { body: note } }).catch(() => undefined)
    await gl(client, `/projects/${mr.source_project_id ?? projectId}/repository/branches/${encode(mr.source_branch)}`, {
        method: 'DELETE',
    }).catch(() => undefined)
}

/**
 * The bot's newest request from this branch, if closed without being withdrawn: a reopen needs the branch.
 * Counted since `restartedBy`, as the callers' refusals count, or „Erneut einreichen“ would always fail.
 */
async function heldBy(client: GitLabClient, projectId: number, requests: MergeRequestRef[], restartedBy?: string): Promise<MergeRequestRef | undefined> {
    if (!requests.some((mr) => mr.state === 'closed')) return undefined
    const account = await currentUser(client)
    const restarts = restartedBy ? await findMergeRequests(client, projectId, restartedBy) : []
    const since = startedOver(restarts.filter((mr) => mr.state === 'merged').map((mr) => mr.merged_at ?? mr.created_at))
    const newest = requests.find((mr) => mr.author?.id === account.id && sinceStart(mr.created_at, since))
    if (newest?.state !== 'closed') return undefined
    return (await readClosing(client, projectId, newest)).withdrawnBy ? undefined : newest
}

export type MergeRequestOutcome =
    | { status: 'created'; url: string; iid: number }
    | { status: 'already-open'; url: string; iid: number }

export async function openMergeRequest(
    client: GitLabClient,
    input: {
        upstream: GitLabProject
        baseBranch: string
        branch: string
        title: string
        description: string
        files: Record<string, string>
        existingPaths: Set<string>
        deletedPaths?: string[]
        /** Branch whose merge starts the count over (the version's removal); see `heldBy`. */
        restartedBy?: string
    },
): Promise<MergeRequestOutcome> {
    const requests = await findMergeRequests(client, input.upstream.id, input.branch)
    const open = requests.find((mr) => mr.state === 'opened')
    if (open) return { status: 'already-open', url: open.web_url, iid: open.iid }

    const source = canPush(input.upstream) ? input.upstream : await ensureFork(client, input.upstream)

    // A leftover branch is replaced, never built on: the merge request must show exactly this export.
    if (await branchHead(client, source.id, input.branch)) {
        // A turned-down proposal keeps its branch for a reopen; the callers refuse such a version first.
        const held = await heldBy(client, input.upstream.id, requests, input.restartedBy)
        if (held) throw new HeldBranchError(held)
        await gl(client, `/projects/${source.id}/repository/branches/${encode(input.branch)}`, {
            method: 'DELETE',
        })
    }

    const actions: { action: 'create' | 'update' | 'delete'; file_path: string; content?: string }[] = [
        ...Object.entries(input.files).map(([path, content]) => ({
            action: input.existingPaths.has(path) ? ('update' as const) : ('create' as const),
            file_path: path,
            content,
        })),
        ...(input.deletedPaths ?? []).map((path) => ({ action: 'delete' as const, file_path: path })),
    ]
    const upstreamHead = await branchHead(client, input.upstream.id, input.baseBranch)
    const commitBody = {
        branch: input.branch,
        commit_message: input.title,
        actions,
    }
    try {
        await gl(client, `/projects/${source.id}/repository/commits`, {
            method: 'POST',
            body: { ...commitBody, ...(upstreamHead ? { start_sha: upstreamHead } : { start_branch: input.baseBranch }) },
        })
    } catch (error) {
        if (!(error instanceof GitLabError) || source.id === input.upstream.id || !upstreamHead) throw error
        // The fork cannot see the upstream head: start from its own base branch.
        await gl(client, `/projects/${source.id}/repository/commits`, {
            method: 'POST',
            body: { ...commitBody, start_branch: input.baseBranch },
        })
    }

    const mr = await gl<MergeRequestRef>(client, `/projects/${source.id}/merge_requests`, {
        method: 'POST',
        body: {
            source_branch: input.branch,
            target_branch: input.baseBranch,
            target_project_id: input.upstream.id,
            title: input.title,
            description: input.description,
            remove_source_branch: true,
        },
    })
    return { status: 'created', url: mr.web_url, iid: mr.iid }
}
