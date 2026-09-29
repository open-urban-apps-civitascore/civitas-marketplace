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
 * Everything here only ever PROPOSES. No code path merges.
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
    sha?: string
    merge_commit_sha?: string | null
    squash_commit_sha?: string | null
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
    let response: Response
    try {
        response = await doFetch(`${client.apiBase}${path}`, {
            method: init?.method ?? 'GET',
            headers: {
                'PRIVATE-TOKEN': client.token,
                ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
            cache: 'no-store',
        })
    } catch (cause) {
        throw new GitLabError(`GitLab ist nicht erreichbar: ${String(cause)}`, 0)
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
    return (await response.json()) as T
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
            throw new GitLabError('Der Fork des Zielrepos konnte nicht angelegt werden', 500)
        }
        if (Date.now() > deadline) {
            throw new GitLabError('Der Fork des Zielrepos ist nach 60 s noch nicht bereit — bitte erneut versuchen', 504)
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
    const files: string[] = []
    for (let page = 1; ; page++) {
        let batch: { path: string; type: string }[]
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
        files.push(...batch.filter((entry) => entry.type === 'blob').map((entry) => entry.path))
        if (batch.length < 100) break
        if (files.length > 5000) {
            throw new GitLabError('Das Zielverzeichnis enthält mehr als 5000 Dateien — das ist kein Paketordner', 413)
        }
    }
    return files
}

export async function readFile(
    client: GitLabClient,
    projectId: number,
    path: string,
    ref: string,
): Promise<string | undefined> {
    const doFetch = client.fetchImpl ?? fetch
    let response: Response
    try {
        response = await doFetch(
            `${client.apiBase}/projects/${projectId}/repository/files/${encode(path)}/raw?ref=${encode(ref)}`,
            { headers: { 'PRIVATE-TOKEN': client.token }, cache: 'no-store' },
        )
    } catch (cause) {
        throw new GitLabError(`GitLab ist nicht erreichbar: ${String(cause)}`, 0)
    }
    if (response.status === 404) return undefined
    if (!response.ok) {
        throw new GitLabError(`Datei ${path} konnte nicht gelesen werden (${response.status})`, response.status)
    }
    return response.text()
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

export type MergeRequestOutcome =
    | { status: 'created'; url: string; iid: number }
    | { status: 'already-open'; url: string; iid: number }

/**
 * Opens a merge request that adds or updates `files` (keyed by repository
 * path) on top of the target's base branch.
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

    const actions = Object.entries(input.files).map(([path, content]) => ({
        action: input.existingPaths.has(path) ? 'update' : 'create',
        file_path: path,
        content,
    }))
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
