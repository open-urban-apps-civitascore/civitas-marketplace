/**
 * The GitLab side of proposing an export: read what is on the base branch,
 * then write branch + commit + merge request — through the bot's own fork
 * when the token cannot push to the target.
 *
 * Kept behind a narrow surface (project lookup, tree/file reads, branch head,
 * merge-request lookup, `openMergeRequest`) mirroring `deployment-repo/github.ts`,
 * so a third forge would only have to satisfy these functions. GitLab can
 * create a branch with all its files in ONE commits request, which is why
 * this file is shorter than the GitHub one.
 *
 * Everything here only ever PROPOSES, or takes back what the bot itself
 * proposed (`withdrawMergeRequest`). No code path merges.
 */

export class GitLabError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message)
        this.name = 'GitLabError'
    }
}

export interface GitLabClient {
    /** `https://gitlab.com/api/v4` — derived from the repository URL, so self-hosted instances work. */
    apiBase: string
    token: string
    /** Injected for tests; defaults to the global fetch. */
    fetchImpl?: typeof fetch
    /**
     * Keeps the answers that cannot change (see {@link GitLabReadCache}). Opt-in:
     * the list of shared packages sets one, single reads go without.
     */
    cache?: GitLabReadCache
    /** How long a read may take; {@link READ_TIMEOUT_MS} unless a test shortens it. */
    timeoutMs?: number
}

/**
 * A read that takes longer is given up. Without a limit, one request GitLab
 * never answers held up the whole list of shared packages. Writes have none:
 * giving up on a commit or a merge request would not undo it, only hide
 * whether it happened.
 */
export const READ_TIMEOUT_MS = 10_000

const COMMIT_SHA = /^[0-9a-f]{40}$/i

/**
 * Answers that cannot change, kept in the server's memory: what a repository
 * holds at a commit (a file, a folder listing) and the commits of a merged
 * merge request. A commit is immutable, so these never go stale; anything
 * read at a branch name can, and is never kept.
 *
 * A failed read is not kept, so the next visit asks again. The oldest entries
 * leave first once `limit` is reached; the token is not part of the key,
 * because one deployment has one token.
 */
export class GitLabReadCache {
    private readonly entries = new Map<string, Promise<unknown>>()

    constructor(private readonly limit = 1000) {}

    read<T>(key: string, load: () => Promise<T>): Promise<T> {
        const known = this.entries.get(key)
        if (known) return known as Promise<T>
        const pending: Promise<T> = load().catch((error: unknown) => {
            // Only this attempt leaves; a newer one under the same key stays.
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

    /** Forgets everything; for tests. */
    clear(): void {
        this.entries.clear()
    }
}

/** Through the client's cache when the answer cannot change, straight to GitLab otherwise. */
export function readOnce<T>(client: GitLabClient, key: string, immutable: boolean, load: () => Promise<T>): Promise<T> {
    return client.cache && immutable ? client.cache.read(`${client.apiBase}|${key}`, load) : load()
}

/** The signal for a read, or none for a write (see {@link READ_TIMEOUT_MS}). */
function readSignal(client: GitLabClient, method: string): AbortSignal | undefined {
    return method === 'GET' ? AbortSignal.timeout(client.timeoutMs ?? READ_TIMEOUT_MS) : undefined
}

const isTimeout = (cause: unknown) => cause instanceof Error && cause.name === 'TimeoutError'

/** The body arrived only in part: a time limit becomes a GitLab error, anything else stays what it was. */
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
    /** Where the source branch lives: the target project itself, or the bot's fork of it. */
    source_project_id?: number
    /** The head of the source branch; after the merge still reachable in the target project. */
    sha?: string
    merge_commit_sha?: string | null
    squash_commit_sha?: string | null
    title?: string
    description?: string | null
    author?: { id: number; username?: string } | null
    /** Who closed it, for a closed one. */
    closed_by?: { id: number; username?: string } | null
    merged_at?: string | null
    updated_at?: string
}

/** Splits a project web URL into API base and `group/project` path. */
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

export async function getProject(client: GitLabClient, projectPath: string): Promise<GitLabProject> {
    return gl<GitLabProject>(client, `/projects/${encode(projectPath)}`)
}

/** Developer (30) or above may push branches; anything below goes through a fork. */
export function canPush(project: GitLabProject): boolean {
    const levels = [
        project.permissions?.project_access?.access_level ?? 0,
        project.permissions?.group_access?.access_level ?? 0,
    ]
    return Math.max(...levels) >= 30
}

/**
 * The bot's fork of a project it cannot push to: reused when it exists,
 * created otherwise. Fork creation is asynchronous on GitLab, so a fresh fork
 * is polled until its import finished — the only wait in the whole flow, and
 * only ever the first time per target.
 */
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

/** Every blob path under `path` at `ref`, following pagination to the end; empty when the path does not exist. */
export async function listTree(
    client: GitLabClient,
    projectId: number,
    path: string,
    ref: string,
): Promise<string[]> {
    return [...(await listBlobs(client, projectId, path, ref)).keys()]
}

/**
 * Every file under `path` at `ref` with its blob id, git's hash of its
 * content: equal ids mean equal files, so two states of a folder can be
 * compared without reading a single file. Empty when the path does not
 * exist; kept when `ref` is a commit.
 */
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

/** The parents of a commit, first parent first. Kept: a commit never changes. */
export async function commitParents(client: GitLabClient, projectId: number, sha: string): Promise<string[]> {
    const commit = await readOnce(client, `commit|${projectId}|${sha}`, COMMIT_SHA.test(sha), () =>
        gl<{ parent_ids?: string[] }>(client, `/projects/${projectId}/repository/commits/${encode(sha)}`),
    )
    return commit.parent_ids ?? []
}

/**
 * The base branch as it was just before a merged request landed: the first
 * parent of the commit that brought it - the merge commit, the squashed
 * commit, or for a fast-forward the request's own oldest commit. Undefined
 * when GitLab names none of them.
 */
export async function commitBefore(client: GitLabClient, projectId: number, merged: MergeRequestRef): Promise<string | undefined> {
    const landed =
        merged.merge_commit_sha ?? merged.squash_commit_sha ?? (await mergeRequestCommits(client, projectId, merged.iid, true)).at(-1)?.id
    return landed ? (await commitParents(client, projectId, landed))[0] : undefined
}

/** A file's content at `ref`, undefined where it does not exist. Kept when `ref` is a commit. */
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

/** Merge requests into `targetProjectId` from `sourceBranch`, newest first, any state. */
export async function findMergeRequests(
    client: GitLabClient,
    targetProjectId: number,
    sourceBranch: string,
): Promise<MergeRequestRef[]> {
    return gl<MergeRequestRef[]>(
        client,
        `/projects/${targetProjectId}/merge_requests?source_branch=${encode(sourceBranch)}&state=all&order_by=updated_at&sort=desc&per_page=20`,
    )
}

/**
 * Every open merge request into a project, any author: one request for a
 * whole list, where asking per branch would cost one per package.
 */
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

/** The account the token belongs to: the bot every export is proposed by. */
export async function currentUser(client: GitLabClient): Promise<{ id: number; username: string }> {
    return gl<{ id: number; username: string }>(client, '/user')
}

/** Merge requests into `targetProjectId` opened by one author, newest first, any state. */
export async function listMergeRequestsBy(
    client: GitLabClient,
    targetProjectId: number,
    authorId: number,
): Promise<MergeRequestRef[]> {
    return gl<MergeRequestRef[]>(
        client,
        `/projects/${targetProjectId}/merge_requests?author_id=${authorId}&state=all&order_by=updated_at&sort=desc&per_page=50`,
    )
}

/**
 * The commits of a merge request, newest first, as GitLab lists them. Kept
 * for a merged one (`merged`): its commits can no longer change.
 */
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

/**
 * The newest comments on a merge request, newest first, GitLab's own
 * ("closed") among them. Kept per `updatedAt`: a new comment, a reopen or
 * any other change moves it, so the key changes with the answer. Without
 * `updatedAt` nothing is kept.
 */
export function mergeRequestNotes(
    client: GitLabClient,
    projectId: number,
    iid: number,
    updatedAt: string | undefined,
): Promise<{ body: string }[]> {
    return readOnce(client, `mr-notes|${projectId}|${iid}|${updatedAt}`, Boolean(updatedAt), () =>
        gl<{ body: string }[]>(client, `/projects/${projectId}/merge_requests/${iid}/notes?sort=desc&order_by=created_at&per_page=100`),
    )
}

/**
 * The directories directly inside `parent` at `ref`, name to tree id; empty
 * when `parent` or `ref` does not exist. One listing serves every package of
 * a folder, and it is kept when `ref` is a commit.
 */
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

/**
 * The tree id of a directory at a ref: git's own hash over everything below
 * it, and nothing else. Equal ids mean equal contents, whatever happened
 * elsewhere in the repository or to the history around it, so a rebase or a
 * squash leaves it alone. The API names a directory's id only in its
 * parent's listing, which is read here; undefined when the directory does not
 * exist at that ref, or the ref does not.
 */
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
 * Takes back a merge request the bot opened: the close, then a note on whose
 * behalf, then its branch. Withdrawing one's own proposal needs no review on
 * any forge, which is why this is the one write besides proposing. Closing
 * is what counts and comes first, so no note claims a withdrawal that did
 * not happen; the note and the branch are courtesies, whose failure does not
 * fail it - a leftover branch is replaced by the next proposal anyway (see
 * `openMergeRequest`).
 */
export async function withdrawMergeRequest(
    client: GitLabClient,
    projectId: number,
    mr: MergeRequestRef,
    note: string,
): Promise<void> {
    await gl(client, `/projects/${projectId}/merge_requests/${mr.iid}`, { method: 'PUT', body: { state_event: 'close' } })
    await gl(client, `/projects/${projectId}/merge_requests/${mr.iid}/notes`, { method: 'POST', body: { body: note } }).catch(() => undefined)
    await gl(client, `/projects/${mr.source_project_id ?? projectId}/repository/branches/${encode(mr.source_branch)}`, {
        method: 'DELETE',
    }).catch(() => undefined)
}

export type MergeRequestOutcome =
    | { status: 'created'; url: string; iid: number }
    | { status: 'already-open'; url: string; iid: number }

/**
 * Opens a merge request that adds or updates `files` (keyed by repository
 * path), and removes `deletedPaths`, on top of the target's base branch.
 *
 * Direct when the token may push to the target; otherwise the branch lives in
 * the bot's fork and the merge request targets the upstream project. The
 * commit starts at the upstream base head when the fork can see that commit
 * (GitLab forks share objects), and falls back to the fork's own base branch
 * otherwise — a stale fork still yields a reviewable merge request.
 */
export async function openMergeRequest(
    client: GitLabClient,
    input: {
        upstream: GitLabProject
        baseBranch: string
        branch: string
        title: string
        description: string
        files: Record<string, string>
        /** Paths that already exist on the base branch — committed as updates, not creates. */
        existingPaths: Set<string>
        /** Paths on the base branch the merge request removes. */
        deletedPaths?: string[]
    },
): Promise<MergeRequestOutcome> {
    const open = (await findMergeRequests(client, input.upstream.id, input.branch)).find(
        (mr) => mr.state === 'opened',
    )
    if (open) return { status: 'already-open', url: open.web_url, iid: open.iid }

    const source = canPush(input.upstream) ? input.upstream : await ensureFork(client, input.upstream)

    // A leftover branch without an open MR (closed, or a previous run failed
    // after the commit) is replaced, never appended to: the merge request must
    // show exactly this export, not this export on top of an older attempt.
    if (await branchHead(client, source.id, input.branch)) {
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
