import type { AddonPackage, PackageFile } from '@/lib/package-file'
import type { AddonPackageRef } from './listing'

/**
 * Fetches an add-on's deployment package from its own repository at the pinned
 * commit.
 *
 * The pin is resolved to a full commit SHA before anything is fetched, and
 * every file is fetched AT that SHA — fail-closed: a pin that does not
 * resolve refuses the fetch, because content from a mutable ref could differ
 * from what was curated (a moved tag would be vendored silently otherwise).
 *
 * The catalogue never mirrors this content — it only points at it — so the
 * bytes that land in a pull request come from the maintainer's repository at
 * the exact commit the catalogue pins. Two installs of the same listed
 * version are therefore byte-identical, which is the reason the catalogue
 * refuses branch pins in the first place.
 *
 * Read-only and unauthenticated: the add-ons are public. If private add-ons
 * ever need supporting, a token belongs here — never in the catalogue.
 */

const API = 'https://gitlab.com/api/v4/projects'

const COMMIT_SHA = /^[0-9a-f]{40}$/i
const COMMIT_LIKE = /^[0-9a-f]{7,40}$/i

/**
 * Guards against a repository that would blow up a pull request. Generous
 * enough for the real packages (the largest official add-on is ~30 files) and
 * small enough that a mistake fails fast instead of hanging.
 */
const MAX_FILES = 200
const MAX_TOTAL_BYTES = 5 * 1024 * 1024

/**
 * Upper bound on tree entries (files *and* directories) walked while listing a
 * package. Reaching it is an error rather than a stopping point: a partially
 * listed package would be committed as a complete one.
 */
const MAX_TREE_ENTRIES = 2000

export class PackageFetchError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message)
        this.name = 'PackageFetchError'
    }
}

interface TreeEntry {
    path: string
    type: 'blob' | 'tree'
}

/**
 * The full commit SHA the pin stands for. A 40-hex ref IS the answer; anything
 * else (legacy tag pin, short hash) is resolved via the commits API — and a
 * pin that does not resolve is an error, never a fallback: fetching from the
 * raw ref would silently vendor whatever the ref points at TODAY.
 */
export async function resolvePinnedCommit(ref: AddonPackageRef): Promise<string> {
    if (COMMIT_SHA.test(ref.ref)) return ref.ref.toLowerCase()
    // A hash-shaped pin expands through the commits endpoint; anything else
    // must be an actual TAG — the tags endpoint cannot resolve a branch name,
    // so a mutable ref cannot be laundered into a fresh commit here.
    const viaCommits = COMMIT_LIKE.test(ref.ref)
    const endpoint = viaCommits
        ? `/repository/commits/${encodeURIComponent(ref.ref)}`
        : `/repository/tags/${encodeURIComponent(ref.ref)}`
    const body = await gitlab<{ id?: unknown; commit?: { id?: unknown } }>(ref.project, endpoint)
    const id = viaCommits ? body.id : body.commit?.id
    // The prefix check mirrors bundle.ts: the commits endpoint also resolves
    // branch/tag NAMES, so a hex-named branch must not pass as a hash pin.
    if (
        typeof id !== 'string' ||
        !COMMIT_SHA.test(id) ||
        (viaCommits && !id.toLowerCase().startsWith(ref.ref.toLowerCase()))
    ) {
        throw new PackageFetchError(
            `Die Version „${ref.ref}" ließ sich nicht in einen Commit auflösen — ` +
                `ohne eindeutigen Stand wird nichts installiert.`,
            502,
        )
    }
    return id.toLowerCase()
}

async function gitlab<T>(project: string, path: string): Promise<T> {
    const url = `${API}/${encodeURIComponent(project)}${path}`
    let response: Response
    try {
        response = await fetch(url, { cache: 'no-store' })
    } catch (cause) {
        throw new PackageFetchError(`GitLab ist nicht erreichbar: ${String(cause)}`, 0)
    }
    if (!response.ok) {
        throw new PackageFetchError(
            `GitLab antwortete mit ${response.status} für ${project}`,
            response.status,
        )
    }
    return response.json() as Promise<T>
}

/**
 * Lists every file under the package path, following GitLab's pagination to
 * the end. It never stops early: an incomplete list would become a pull request
 * proposing a package with files missing, which is worse than a failed fetch.
 */
async function listFiles(ref: AddonPackageRef): Promise<string[]> {
    const files: string[] = []
    const base = ref.path === '.' ? '' : `&path=${encodeURIComponent(ref.path)}`
    let seen = 0

    for (let page = 1; ; page++) {
        const batch = await gitlab<TreeEntry[]>(
            ref.project,
            `/repository/tree?recursive=true&per_page=100&page=${page}&ref=${encodeURIComponent(ref.ref)}${base}`,
        )

        seen += batch.length
        if (seen > MAX_TREE_ENTRIES) {
            throw new PackageFetchError(
                `Das Verzeichnis in ${ref.project} enthält mehr als ${MAX_TREE_ENTRIES} Einträge — ` +
                    `das ist kein Deployment-Paket.`,
                413,
            )
        }

        files.push(...batch.filter((entry) => entry.type === 'blob').map((entry) => entry.path))
        if (batch.length < 100) break
    }

    return files
}

/**
 * Reads one file as bytes and keeps it as text only when it really is text.
 *
 * Decoding is strict on purpose: a lenient decode would replace invalid bytes
 * with U+FFFD and hand back a string that looks fine and is silently corrupt.
 * A NUL byte also disqualifies a file — some binaries are technically valid
 * UTF-8, and no deployment file legitimately contains one.
 */
async function readPackageFile(
    ref: AddonPackageRef,
    path: string,
): Promise<{ file: PackageFile; bytes: number }> {
    const url =
        `${API}/${encodeURIComponent(ref.project)}/repository/files/` +
        `${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref.ref)}`

    let response: Response
    try {
        response = await fetch(url, { cache: 'no-store' })
    } catch (cause) {
        throw new PackageFetchError(`GitLab ist nicht erreichbar: ${String(cause)}`, 0)
    }
    if (!response.ok) {
        throw new PackageFetchError(
            `Datei ${path} konnte nicht gelesen werden (${response.status})`,
            response.status,
        )
    }

    const buffer = Buffer.from(await response.arrayBuffer())

    // A zero byte settles it before decoding: some binaries are technically
    // valid UTF-8, and no deployment file legitimately contains one.
    if (!buffer.includes(0)) {
        try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
            return { file: { content: text, encoding: 'utf8' }, bytes: buffer.byteLength }
        } catch {
            // Not valid UTF-8 — fall through and keep the bytes as they are.
        }
    }

    return { file: { content: buffer.toString('base64'), encoding: 'base64' }, bytes: buffer.byteLength }
}

export interface FetchedAddonPackage {
    /** The package as `path -> file`, with paths relative to the package root. */
    files: AddonPackage
    /** The commit SHA every file was fetched at — the enforced pin. */
    commit: string
}

export async function fetchAddonPackage(ref: AddonPackageRef): Promise<FetchedAddonPackage> {
    const commit = await resolvePinnedCommit(ref)
    const pinned: AddonPackageRef = { ...ref, ref: commit }

    const prefix = ref.path === '.' ? '' : `${ref.path.replace(/\/+$/, '')}/`
    const paths = await listFiles(pinned)

    if (paths.length === 0) {
        throw new PackageFetchError(
            `Unter ${ref.path} in ${ref.project} (${ref.ref}) liegen keine Dateien.`,
            404,
        )
    }

    if (paths.length > MAX_FILES) {
        throw new PackageFetchError(
            `Das Paket enthält ${paths.length} Dateien — mehr als die zulässigen ${MAX_FILES}.`,
            413,
        )
    }

    const files: AddonPackage = {}
    let total = 0

    // Sequential on purpose: a burst of parallel requests against a public,
    // unauthenticated API is the fastest way to get rate-limited, and a package
    // is a few dozen small files.
    for (const path of paths) {
        const { file, bytes } = await readPackageFile(pinned, path)
        total += bytes
        if (total > MAX_TOTAL_BYTES) {
            throw new PackageFetchError(
                `Das Paket ist größer als ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB.`,
                413,
            )
        }
        files[prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path] = file
    }

    return { files, commit }
}
