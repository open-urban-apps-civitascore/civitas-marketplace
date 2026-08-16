import type { DeploymentRepoConfig } from './config'

/**
 * The GitHub side of proposing an install: read the current environment file,
 * then write branch + commit + pull request.
 *
 * Kept behind a narrow surface (`readFile`, `openPullRequest`) because the
 * forge is per-instance configuration, not an assumption — German
 * municipalities largely run GitLab or OpenCode, and a second implementation
 * should only have to satisfy these two functions. GitLab in particular can do
 * branch, files and commit in a single request.
 *
 * Everything here only ever PROPOSES. There is no code path that merges, and
 * the token is deliberately scoped so there could not be one.
 */
const API = 'https://api.github.com'

export class ForgeError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message)
        this.name = 'ForgeError'
    }
}

async function gh<T>(
    config: DeploymentRepoConfig,
    path: string,
    init?: { method: string; body: unknown },
): Promise<T> {
    let response: Response
    try {
        response = await fetch(`${API}/repos/${config.repo}${path}`, {
            method: init?.method ?? 'GET',
            headers: {
                Authorization: `Bearer ${config.token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                ...(init ? { 'Content-Type': 'application/json' } : {}),
            },
            body: init ? JSON.stringify(init.body) : undefined,
            cache: 'no-store',
        })
    } catch (cause) {
        // DNS failure, offline, blocked egress — never a 4xx/5xx.
        throw new ForgeError(`GitHub is unreachable: ${String(cause)}`, 0)
    }

    if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as { message?: string } | null
        throw new ForgeError(
            problem?.message ?? `${response.status} ${response.statusText}`,
            response.status,
        )
    }

    return (await response.json()) as T
}

/** Current content of a file on the base branch. */
export async function readFile(config: DeploymentRepoConfig, path: string): Promise<string> {
    const file = await gh<{ content: string; encoding: string }>(
        config,
        `/contents/${path}?ref=${encodeURIComponent(config.baseBranch)}`,
    )
    if (file.encoding !== 'base64') {
        throw new ForgeError(`Unexpected encoding "${file.encoding}" for ${path}`, 0)
    }
    return Buffer.from(file.content, 'base64').toString('utf8')
}

export type PullRequestOutcome =
    | { status: 'created'; url: string; number: number }
    | { status: 'already-open'; url: string; number: number }

export async function openPullRequest(
    config: DeploymentRepoConfig,
    input: { branch: string; title: string; body: string; files: Record<string, string> },
): Promise<PullRequestOutcome> {
    const owner = config.repo.split('/')[0]

    // Independent reads, so they wait on each other for nothing: whether a pull
    // request is already open, and where the base branch currently points. The
    // rest of the sequence is genuinely chained (tree -> commit -> ref -> PR).
    // On the early-exit path the ref read is discarded, which is a cheap trade
    // for a round trip off the one call users watch a spinner for.
    const [existing, baseRef] = await Promise.all([
        // Clicking install twice must not open a second pull request.
        gh<{ html_url: string; number: number }[]>(
            config,
            `/pulls?state=open&head=${encodeURIComponent(`${owner}:${input.branch}`)}`,
        ),
        gh<{ object: { sha: string } }>(config, `/git/ref/heads/${config.baseBranch}`),
    ])
    if (existing.length > 0) {
        return { status: 'already-open', url: existing[0].html_url, number: existing[0].number }
    }

    const baseSha = baseRef.object.sha
    const baseCommit = await gh<{ tree: { sha: string } }>(config, `/git/commits/${baseSha}`)

    const tree = await gh<{ sha: string }>(config, '/git/trees', {
        method: 'POST',
        body: {
            base_tree: baseCommit.tree.sha,
            tree: Object.entries(input.files).map(([path, content]) => ({
                path,
                mode: '100644',
                type: 'blob',
                content,
            })),
        },
    })

    const commit = await gh<{ sha: string }>(config, '/git/commits', {
        method: 'POST',
        body: { message: input.title, tree: tree.sha, parents: [baseSha] },
    })

    // A leftover branch without an open PR (the PR was closed, or a previous run
    // failed here) would otherwise fail with an opaque 422.
    try {
        await gh(config, '/git/refs', {
            method: 'POST',
            body: { ref: `refs/heads/${input.branch}`, sha: commit.sha },
        })
    } catch (error) {
        if (error instanceof ForgeError && error.status === 422) {
            await gh(config, `/git/refs/heads/${input.branch}`, {
                method: 'PATCH',
                body: { sha: commit.sha, force: true },
            })
        } else {
            throw error
        }
    }

    const pull = await gh<{ html_url: string; number: number }>(config, '/pulls', {
        method: 'POST',
        body: {
            title: input.title,
            head: input.branch,
            base: config.baseBranch,
            body: input.body,
        },
    })

    return { status: 'created', url: pull.html_url, number: pull.number }
}
