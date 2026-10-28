import { indexRowOf, isListed, maintainerOf } from '@/lib/export/catalog-entry'
import { bundleBranch, catalogBranch, packageDir, parseCatalogBranch, removalBranch, type CatalogRepo, type ExportTarget } from '@/lib/export/config'
import { sinceStart, startedOver, type Decline } from '@/lib/export/declines'
import {
    branchHead,
    currentUser,
    directoryTrees,
    findMergeRequests,
    getProject,
    GitLabError,
    listMergeRequestsBy,
    mergeRequestCommits,
    newestFirst,
    parseProjectUrl,
    readClosing,
    readFile,
    treeIdOf,
    type Closing,
    type GitLabClient,
    type MergeRequestRef,
} from '@/lib/export/gitlab'
import type { DeclineReason } from '@/lib/export/merge-request-text'
import { isNewerVersion } from '@/lib/export/share-stages'

// Where an export stands, read fresh from GitLab every time: the marketplace keeps no bookkeeping.
// The catalogue step waits for the package on the base branch: an entry may only pin a commit there.

/** Base-branch package folder vs. its merge, by tree id, so the catalogue lists what the review saw. */
export interface BundleVerification {
    state: 'verified' | 'changed-after-merge' | 'no-merge-request' | 'unverifiable'
    changedInReview?: boolean
    mergedMrUrl?: string
}

export interface BundleStatus {
    state: 'none' | 'mr-open' | 'on-base'
    mrUrl?: string
    /** The base-branch head: the commit a catalogue entry pins. */
    sha?: string
    packageId?: string
    verification?: BundleVerification
    detail?: string
    reason?: 'no-base-branch' | 'no-package' | 'bad-manifest' | 'other-version'
    onBase?: { id: string; version: string }
    /** The package proposal was turned down, so the version is used up; `mrUrl` names it. */
    declined?: Decline
    /** Newest proposal to remove the version again, any state; not read while a package proposal is open. */
    removal?: { state: string; mrUrl: string; declined?: Decline }
}

/** `withdrawn` (taken out by the catalogue team) and `declined` are final for that version. */
export interface CatalogStatus {
    state: 'unconfigured' | 'none' | 'mr-open' | 'listed' | 'withdrawn' | 'declined'
    mrUrl?: string
    declined?: Decline
    /** A version the catalogue team took out; on `none` another one, so this one may still be proposed. */
    takenOut?: { version: string; reason?: string }
    /** For `mr-open`: merging it would bring back a version taken out. */
    bringsBack?: boolean
    maintainer?: string
}

export interface BundleTrees {
    onBase?: string
    merged?: string
    exported?: string
}

export function judgeBundle(merged: MergeRequestRef | undefined, trees: BundleTrees): BundleVerification {
    if (!merged) return { state: 'no-merge-request' }
    const mergedMrUrl = merged.web_url
    if (!trees.merged || !trees.onBase) return { state: 'unverifiable', mergedMrUrl }
    if (trees.onBase !== trees.merged) return { state: 'changed-after-merge', mergedMrUrl }
    return {
        state: 'verified',
        mergedMrUrl,
        changedInReview: Boolean(trees.exported && trees.exported !== trees.merged),
    }
}

async function readTrees(
    client: GitLabClient,
    projectId: number,
    dir: string,
    treeOnBase: () => Promise<string | undefined>,
    merged: MergeRequestRef | undefined,
): Promise<BundleTrees> {
    if (!merged?.sha) return {}
    const [commits, onBase, mergedTree] = await Promise.all([
        mergeRequestCommits(client, projectId, merged.iid, true).catch(() => []),
        treeOnBase(),
        treeIdOf(client, projectId, dir, merged.sha),
    ])
    // GitLab lists newest first, so the oldest is the commit the export made.
    const exportedSha = commits.at(-1)?.id
    const exported =
        exportedSha && exportedSha !== merged.sha ? await treeIdOf(client, projectId, dir, exportedSha) : undefined
    // An unreadable export commit claims no change: the note must not cry wolf.
    return { onBase, merged: mergedTree, exported: exported ?? mergedTree }
}

export interface BundleInspection {
    status: BundleStatus
    manifestRaw?: string
    merged?: MergeRequestRef
}

/** What a listing reads once for all its packages. */
export interface BundleContext {
    projectId: number
    /** Newest first, any state. */
    requests: MergeRequestRef[]
    head: string | undefined
    treeOnBase: () => Promise<string | undefined>
    removal?: MergeRequestRef
    removalDeclined?: Decline
    /** False skips the check against the merge: a deletion only needs the package to be there. */
    verify?: boolean
}

export function packageFolder(target: Pick<ExportTarget, 'pathPrefix'>, slug: string): { parent: string; name: string } {
    const parts = packageDir(target, slug).split('/')
    const name = parts.pop() as string
    return { parent: parts.join('/'), name }
}

export async function readBaseTrees(
    client: GitLabClient,
    projectId: number,
    target: ExportTarget,
): Promise<{ head: string | undefined; trees: Map<string, string> }> {
    const head = await branchHead(client, projectId, target.baseBranch)
    if (!head) return { head, trees: new Map() }
    return { head, trees: await directoryTrees(client, projectId, packageFolder(target, 'x').parent, head) }
}

/** Unreadable comments on a "no": `throw` where a refusal rests on it (never a guess), `tell` to show. */
export interface DeclineReading {
    unreadable?: 'throw' | 'tell'
}

/** Without `expectedId`, any `…:usecase:<slug>` manifest of the version counts. */
export async function inspectBundle(
    client: GitLabClient,
    target: ExportTarget,
    slug: string,
    version: string,
    expectedId?: string,
    reading: DeclineReading = {},
): Promise<BundleInspection> {
    const project = await getProject(client, parseProjectUrl(target.url).projectPath)
    const [requests, removals] = await Promise.all([
        findMergeRequests(client, project.id, bundleBranch(slug, version)),
        findMergeRequests(client, project.id, removalBranch(slug, version)),
    ])
    // An open request decides alone, so the base branch is not read.
    if (requests.some((mr) => mr.state === 'opened')) {
        return inspectBundleIn(client, target, slug, version, expectedId, { projectId: project.id, requests, head: undefined, treeOnBase: async () => undefined })
    }
    const bot = lazyAccount(client)
    // A removal merged before the package's last merge was undone by it.
    const presentRemovals = presentRequests(removals, requests)
    // 'tell': a removal's "no" stops nothing, so unreadable comments only hide its reason.
    const [head, removalDeclined] = await Promise.all([
        branchHead(client, project.id, target.baseBranch),
        readDecline(client, project.id, presentRemovals, bot, 'tell'),
    ])
    const dir = packageDir(target, slug)
    const inspection = await inspectBundleIn(client, target, slug, version, expectedId, {
        projectId: project.id,
        requests,
        head,
        treeOnBase: () => (head ? treeIdOf(client, project.id, dir, head) : Promise.resolve(undefined)),
        removal: presentRemovals[0],
        ...(removalDeclined ? { removalDeclined } : {}),
    })
    if (inspection.status.state !== 'none') return inspection
    const declined = await readDecline(client, project.id, presentRequests(requests, removals), bot, reading.unreadable)
    return declined ? { ...inspection, status: { ...inspection.status, declined, mrUrl: declined.mrUrl } } : inspection
}

/** {@link inspectBundle} on a context read once for a whole listing. */
export async function inspectBundleIn(
    client: GitLabClient,
    target: ExportTarget,
    slug: string,
    version: string,
    expectedId: string | undefined,
    context: BundleContext,
): Promise<BundleInspection> {
    const { projectId, requests, head } = context
    const open = requests.find((mr) => mr.state === 'opened')
    if (open) return { status: { state: 'mr-open', mrUrl: open.web_url } }

    const declined = context.removalDeclined ? { declined: context.removalDeclined } : {}
    const removal = context.removal ? { removal: { state: context.removal.state, mrUrl: context.removal.web_url, ...declined } } : {}
    if (!head) {
        return { status: { state: 'none', reason: 'no-base-branch', detail: `Im Ablageort ${target.url} fehlt „${target.baseBranch}“`, ...removal } }
    }
    const dir = packageDir(target, slug)
    const manifestRaw = await readFile(client, projectId, `${dir}/core-ir/manifest.json`, head)
    if (!manifestRaw) return { status: { state: 'none', reason: 'no-package', ...removal } }

    let manifest: { id?: unknown; version?: unknown }
    try {
        manifest = JSON.parse(manifestRaw) as { id?: unknown; version?: unknown }
    } catch {
        return { status: { state: 'none', reason: 'bad-manifest', detail: 'Die manifest.json im Ablageort ist kein gültiges JSON', ...removal } }
    }
    const idMatches =
        expectedId !== undefined
            ? manifest.id === expectedId
            : typeof manifest.id === 'string' && manifest.id.endsWith(`:usecase:${slug}`)
    if (!idMatches || manifest.version !== version) {
        return {
            status: {
                state: 'none',
                reason: 'other-version',
                onBase: { id: String(manifest.id), version: String(manifest.version) },
                detail: idMatches ? `Angenommen ist Version ${String(manifest.version)}, nicht ${version}` : 'Im Ablageort liegt unter diesem Kurznamen ein anderes Paket',
                ...removal,
            },
        }
    }

    const merged = requests.find((mr) => mr.state === 'merged')
    const mergedRef = merged ? { merged } : {}
    if (context.verify === false) {
        return { status: { state: 'on-base', sha: head, packageId: String(manifest.id), ...removal }, manifestRaw, ...mergedRef }
    }
    const verification = judgeBundle(merged, await readTrees(client, projectId, dir, context.treeOnBase, merged))
    return {
        status: { state: 'on-base', sha: head, packageId: String(manifest.id), verification, ...removal },
        manifestRaw,
        ...mergedRef,
    }
}

export async function readBundleStatus(
    client: GitLabClient,
    target: ExportTarget,
    slug: string,
    version: string,
    expectedId?: string,
    reading: DeclineReading = {},
): Promise<BundleStatus> {
    return (await inspectBundle(client, target, slug, version, expectedId, reading)).status
}

export interface CatalogInspection {
    status: CatalogStatus
    /** See `catalogFloor`. */
    floor?: string
    /** The `index.json` read, for reuse in the same request. */
    read?: { index: string | undefined }
}

export async function inspectCatalog(
    client: GitLabClient,
    catalog: CatalogRepo | undefined,
    slug: string,
    version: string,
    id: string,
): Promise<CatalogInspection> {
    if (!catalog) return { status: { state: 'unconfigured' } }
    const project = await getProject(client, parseProjectUrl(catalog.url).projectPath)
    const bot = lazyAccount(client)
    const context = await readVersionCatalog(client, project.id, catalog, slug, version, true, bot)
    const floor = catalogFloor(context, id)
    const declined = await readCatalogDecline(client, project.id, context, id, bot)
    return { status: catalogStatusIn(context, slug, version, id, declined), ...(floor ? { floor } : {}), read: { index: context.index } }
}

export async function readCatalogStatus(
    client: GitLabClient,
    catalog: CatalogRepo | undefined,
    slug: string,
    version: string,
    id: string,
): Promise<CatalogStatus> {
    return (await inspectCatalog(client, catalog, slug, version, id)).status
}

/** Reads the index even next to an open proposal, as `bringsBack` depends on it. */
export async function readVersionCatalog(
    client: GitLabClient,
    projectId: number,
    catalog: CatalogRepo,
    slug: string,
    version: string,
    others = true,
    bot: () => Promise<{ id: number }> = lazyAccount(client),
    known?: { index: string | undefined },
): Promise<CatalogContext> {
    const [requests, index, byBot] = await Promise.all([
        findMergeRequests(client, projectId, catalogBranch(slug, version)),
        known ? Promise.resolve(known.index) : readFile(client, projectId, 'index.json', catalog.baseBranch),
        others ? bot().then((account) => listMergeRequestsBy(client, projectId, account.id)) : Promise.resolve([]),
    ])
    const merged = new Map([...requests, ...byBot].filter((mr) => mr.state === 'merged').map((mr) => [mr.iid, mr]))
    return { openRequests: requests.filter((mr) => mr.state === 'opened'), index, merged: [...merged.values()], requests }
}

export interface CatalogContext {
    openRequests: MergeRequestRef[]
    index: string | undefined
    /** Absent when not read: then nothing counts as taken out by hand. */
    merged?: MergeRequestRef[]
    /** One version's reading only: its catalogue branch's requests, newest first. */
    requests?: MergeRequestRef[]
}

export function lazyAccount(client: GitLabClient): () => Promise<{ id: number; username: string }> {
    let account: Promise<{ id: number; username: string }> | undefined
    return () => (account ??= currentUser(client))
}

function declineOfRequest(mr: MergeRequestRef, botId: number, reason: DeclineReason): Decline {
    return {
        iid: mr.iid,
        mrUrl: mr.web_url,
        ...(mr.closed_at ? { closedAt: mr.closed_at } : {}),
        ...(mr.closed_by?.username ? { closedBy: mr.closed_by.username } : {}),
        ...(mr.closed_by?.id === botId ? { viaMarketplace: true } : {}),
        reason,
    }
}

/** `requests` opened after the newest merge in `other` (package vs. removal branch); all when none. */
export function presentRequests(requests: MergeRequestRef[], other: readonly MergeRequestRef[]): MergeRequestRef[] {
    const since = startedOver(other.filter((mr) => mr.state === 'merged').map((mr) => mr.merged_at ?? mr.created_at))
    return since === undefined ? requests : requests.filter((mr) => sinceStart(mr.created_at, since))
}

/**
 * The "no" on a branch: the bot's newest proposal, closed and not withdrawn, while none was merged.
 * Unreadable comments only put a close by the bot in doubt (an old withdrawal): `throw` fails then.
 */
export async function readDecline(
    client: GitLabClient,
    projectId: number,
    requests: MergeRequestRef[],
    bot: () => Promise<{ id: number }>,
    unreadable: 'throw' | 'tell' = 'tell',
): Promise<Decline | undefined> {
    if (requests.some((mr) => mr.state === 'merged') || !requests.some((mr) => mr.state === 'closed')) return undefined
    const { id } = await bot()
    const newest = newestFirst(requests.filter((mr) => mr.author?.id === id))[0]
    if (newest?.state !== 'closed') return undefined
    let closing: Closing
    try {
        closing = await readClosing(client, projectId, newest)
    } catch (error) {
        const byOther = typeof newest.closed_by?.id === 'number' && newest.closed_by.id !== id
        if (!(error instanceof GitLabError) || (unreadable === 'throw' && !byOther)) throw error
        closing = { reason: { kind: 'unreadable' } }
    }
    return closing.withdrawnBy ? undefined : declineOfRequest(newest, id, closing.reason ?? { kind: 'none' })
}

/** The branch names no publisher, so only proposals naming this id (or with no description) count. */
export function readCatalogDecline(
    client: GitLabClient,
    projectId: number,
    context: CatalogContext,
    id: string,
    bot: () => Promise<{ id: number }>,
    unreadable: 'throw' | 'tell' = 'tell',
): Promise<Decline | undefined> {
    const own = (context.requests ?? []).filter((mr) => !mr.description || mr.description.includes(`\`${id}\``))
    return readDecline(client, projectId, own, bot, unreadable)
}

function listedOnce(context: CatalogContext, id: string): string[] {
    return (context.merged ?? []).flatMap((mr) => {
        const branch = parseCatalogBranch(mr.source_branch)
        return branch && mr.description?.includes(`\`${id}\``) ? [branch.version] : []
    })
}

const newest = (versions: string[]): string | undefined =>
    versions
        .filter((candidate) => /^\d+\.\d+\.\d+$/.test(candidate))
        .reduce<string | undefined>((best, candidate) => (!best || isNewerVersion(candidate, best) ? candidate : best), undefined)

/**
 * What the catalogue team took out: a `revoked` row (the whole entry), or a version once listed
 * by a merged proposal of which neither it nor a newer one is listed now (deleted by hand).
 */
export function takenOutIn(
    context: CatalogContext,
    id: string,
    version: string,
): { version: string; reason?: string; thisVersion: boolean } | undefined {
    if (context.index === undefined) return undefined
    const row = indexRowOf(context.index, id)
    if (row === null) return undefined
    if (row?.revoked) return { version: row.version ?? version, ...(row.reason ? { reason: row.reason } : {}), thisVersion: true }
    // Replaced, not taken out: the index lists it, or a newer version of it.
    const listedNow = row?.version
    const out = listedOnce(context, id).filter((candidate) => !(listedNow && (listedNow === candidate || isNewerVersion(listedNow, candidate))))
    if (out.includes(version)) return { version, thisVersion: true }
    const other = newest(out)
    return other ? { version: other, thisVersion: false } : undefined
}

/** Highest version that ever reached the catalogue: it is used up, so a new one must be higher. */
export function catalogFloor(context: CatalogContext, id: string): string | undefined {
    if (context.index === undefined) return undefined
    const row = indexRowOf(context.index, id)
    if (row === null) return undefined
    return newest([...(row?.version ? [row.version] : []), ...listedOnce(context, id)])
}

/** Order: open, listed, taken out, declined, none - so a version taken out never reads as declined. */
export function catalogStatusIn(context: CatalogContext, slug: string, version: string, id: string, declined?: Decline): CatalogStatus {
    const out = takenOutIn(context, id, version)
    const takenOut = out ? { takenOut: { version: out.version, ...(out.reason ? { reason: out.reason } : {}) } } : {}
    const branch = catalogBranch(slug, version)
    const open = context.openRequests.find((mr) => mr.source_branch === branch && mr.state === 'opened')
    if (open) return { state: 'mr-open', mrUrl: open.web_url, ...takenOut, ...(out?.thisVersion ? { bringsBack: true } : {}) }
    if (context.index && isListed(context.index, id, version)) {
        const maintainer = maintainerOf(context.index, id)
        return { state: 'listed', ...(maintainer ? { maintainer } : {}) }
    }
    if (out?.thisVersion) return { state: 'withdrawn', ...takenOut }
    if (declined) return { state: 'declined', mrUrl: declined.mrUrl, declined, ...takenOut }
    return { state: 'none', ...takenOut }
}
