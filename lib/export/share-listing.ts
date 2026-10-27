import { expireCatalogIfOlder } from '@/lib/catalog/source'
import { mapWithLimit } from '@/lib/concurrency'
import {
    catalogBranch,
    catalogRepoFromEnv,
    exportConfig,
    exportReadiness,
    packageDir,
    parseBundleBranch,
    parseCatalogBranch,
    parseRemovalBranch,
    thisInstance,
    type CatalogRepo,
    type ExportConfig,
    type ExportTarget,
} from '@/lib/export/config'
import { declinedProposal, declineOf, type Decline } from '@/lib/export/declines'
import {
    AUTHOR_PAGES,
    clientFor,
    currentUser,
    getProject,
    GitLabError,
    gitlabMessage,
    listMergeRequestsBy,
    listOpenMergeRequests,
    parseProjectUrl,
    readClosing,
    readFile,
    type Closing,
    type GitLabClient,
    type GitLabProject,
    type MergeRequestRef,
} from '@/lib/export/gitlab'
import { catalogPinOf, displayNameOf, proposerOf, readmeSourceOf, shareSourceOf, type DeclineReason, type ShareSource } from '@/lib/export/merge-request-text'
import { SHARE_READS } from '@/lib/export/share-cache'
import { catalogStatusIn, inspectBundleIn, packageFolder, presentRequests, readBaseTrees, type BundleStatus, type CatalogContext, type CatalogStatus } from '@/lib/export/status'

/**
 * What this marketplace's GitLab account has proposed, and where each shared
 * version stands: the one reading behind "In Arbeit", "Veröffentlicht" and
 * "Beendet" (plan of 2026-10-18, section 10). Read from GitLab every time,
 * like the status: the account's merge requests on `export/…`, `catalog/…`
 * and `remove/…` branches are the record, no marketplace bookkeeping. Which
 * tab a version belongs in is decided apart from this, in `share-tabs.ts`.
 *
 * Served by `GET /api/shares` rather than by a server action: Next runs a
 * page's server actions one at a time, so a listing that takes seconds would
 * hold up reading a dataset's content, proposing an entry or withdrawing.
 *
 * Asked the way that keeps the page quick (it took about half a minute with
 * nine merged packages, Ewa 2026-10-14): what every row shares - the
 * project, the base branch with its package folders, the catalogue's open
 * merge requests and index - is read once per visit; the rows are then
 * checked side by side; and what a commit, a merged request or a closed one
 * holds is kept in memory (`SHARE_READS`), because it cannot change. So are
 * the projects and the account, which do not change either. A visit after
 * the first asks GitLab four times when nothing moved.
 */

/** One proposal the marketplace's account made about a shared version: of its package, its catalogue entry or its removal. */
export interface ShareProposal {
    kind: 'bundle' | 'catalog' | 'removal'
    iid: number
    url: string
    /** As GitLab names it: `opened`, `merged`, `closed` … */
    state: string
    createdAt?: string
    closedAt?: string
    mergedAt?: string
    /** Who closed it without a merge, by GitLab username: reviewers are named that way (plan of 2026-10-18, section 6). */
    closedBy?: string
    /** Who merged it, by GitLab username. */
    mergedBy?: string
    /** The marketplace's own account closed it: through "Zurückziehen" (then `withdrawnBy` is set), or someone by hand through that account. */
    closedByBot?: boolean
    /** Whom it was proposed for, from its first line. */
    proposedBy?: string
    /** Whom the marketplace withdrew it for, from its withdrawal mark (older ones: from its note). */
    withdrawnBy?: string
    /** Closed and not withdrawn: what the catalogue team said (`declineReasonOf`), or that it could not be read. */
    reason?: DeclineReason
    /** How many comments people wrote on it. */
    comments?: number
    /** Its own source line; absent on proposals made before rc.6. */
    source?: ShareSource
}

/** One shared package version in one target repository. */
export interface SharedPackageRow {
    /** `<target url>#<branch>`. */
    key: string
    targetKey: string
    targetLabel: string
    slug: string
    version: string
    displayName: string
    /** The version's open merge request, else its merged one, else its newest. */
    bundleMr: { url: string; state: string }
    /** Closed through "Zurückziehen", as the marketplace's withdrawal mark (or older note) on it says: taken back, not turned down. */
    withdrawn?: boolean
    /** Read for a merged bundle only; with the version's removal, if one was proposed. */
    bundle?: BundleStatus
    /**
     * Read for a merged bundle that is on the base branch, or that a newer
     * version of the same package replaced there: an older version can stay
     * listed while the newer one is reviewed.
     */
    catalog?: CatalogStatus
    /** The package id the catalogue knows, from the base branch (also where a newer version took its place): for „Im Katalog ansehen“. */
    packageId?: string
    /** Why the state could not be read completely; the row then shows its merge request only. */
    problem?: string
    /**
     * The package folder's history on the base branch at GitLab: where a change
     * made after the review shows („Änderung ansehen“). Absent on a row built by hand.
     */
    folderUrl?: string
    /**
     * Where the share came from: the source line of the version's merge
     * request, or for an older share its package README at that request's
     * last commit. Absent when neither says.
     */
    source?: ShareSource
    /** Whom the version was proposed for, from its merge request's first line. */
    proposedBy?: string
    /**
     * Every proposal of the account about this version, newest first: the
     * package's (more than one where it was proposed again), the catalogue
     * entry's and the removal's. Absent only on a row built by hand.
     */
    proposals?: ShareProposal[]
}

export interface ShareListing {
    rows: SharedPackageRow[]
    /** This instance as its proposals name it (`thisInstance`); absent when `PORTAL_URL` is not set. */
    instance?: string
    /** For „Ältere in GitLab ansehen“ under „Beendet“: set only where the listing stopped at `AUTHOR_PAGES` pages, else nothing older exists. */
    older?: string
    /** Why nothing could be listed. */
    error?: string
}

/** The account's proposals in one project at GitLab, any state - by its name, so others' proposals stay out. */
export function olderProposalsUrl(projectUrl: string, account: string): string {
    return `${projectUrl.replace(/\/+$/, '')}/-/merge_requests?scope=all&state=all&author_username=${encodeURIComponent(account)}`
}

/** How many packages are checked at once: side by side, but not every request at the same moment. */
const ROW_CONCURRENCY = 5

/**
 * What one visit of the list asks GitLab once, however many targets and the
 * catalogue need it: the projects, the account, and its merge requests per
 * project - target and catalogue are often the same repository.
 */
interface Visit {
    project: (client: GitLabClient, url: string) => Promise<GitLabProject>
    bot: (client: GitLabClient) => Promise<{ id: number; username: string }>
    /** The account's merge requests into one project, newest created first, any state. */
    botRequests: (client: GitLabClient, project: GitLabProject) => Promise<MergeRequestRef[]>
    /** Projects where the account has more proposals than are read: project address to account name. */
    cut: Map<string, string>
}

function newVisit(): Visit {
    const asked = new Map<string, Promise<unknown>>()
    const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
        let answer = asked.get(key) as Promise<T> | undefined
        if (!answer) {
            answer = load()
            asked.set(key, answer)
        }
        return answer
    }
    const visit: Visit = {
        // Kept for the server's life, not only the visit: neither a project's id nor the token's account changes.
        project: (client, url) => {
            const path = parseProjectUrl(url).projectPath
            return SHARE_READS.read(`${client.apiBase}|project|${path}`, () => getProject(client, path))
        },
        bot: (client) => SHARE_READS.read(`${client.apiBase}|bot`, () => currentUser(client)),
        botRequests: (client, project) =>
            once(`${client.apiBase}|requests|${project.id}`, async () => {
                const bot = await visit.bot(client)
                const requests = await listMergeRequestsBy(client, project.id, bot.id)
                // Every page read was full: there may be more, which only GitLab shows.
                if (requests.length >= AUTHOR_PAGES * 100) visit.cut.set(project.web_url, bot.username)
                return requests
            }),
        cut: new Map(),
    }
    return visit
}

/** Where „Ältere in GitLab ansehen“ leads: the first cut package target (most endings are about packages), else the catalogue. */
function olderOf(visit: Visit, targets: readonly ExportTarget[]): string | undefined {
    const cut = [...visit.cut]
    const [url, account] = cut.find(([project]) => targets.some((target) => sameProjectUrl(project, target.url))) ?? cut[0] ?? []
    return url && account ? olderProposalsUrl(url, account) : undefined
}

/** The catalogue repository as one listing reads it, for every row at once. */
interface CatalogSide {
    context: CatalogContext
    client: GitLabClient
    projectId: number
    /** The account's proposals into the catalogue repository, newest created first, any state. */
    byBot: MergeRequestRef[]
    botId: number
}

/** What every row of one target shares. */
interface TargetContext {
    target: ExportTarget
    client: GitLabClient
    projectId: number
    botId: number
    base: Promise<{ head: string | undefined; trees: Map<string, string> }>
    catalog: Promise<CatalogSide | undefined>
    /** The account's removal proposals per `<slug>@<version>`, newest first. */
    removals: Map<string, MergeRequestRef[]>
}

/**
 * Everything shared through this marketplace's account, newest first, with
 * where each version stands. Checks no session or right: the route that
 * serves it does (`app/api/shares/route.ts`).
 */
export async function readShareListing(config: ExportConfig = exportConfig()): Promise<ShareListing> {
    const instance = thisInstance()
    const named = instance ? { instance } : {}
    if (exportReadiness(config) !== 'ready') return { rows: [], ...named }
    const token = config.token as string
    const visit = newVisit()

    // Started at once, awaited by the rows that need it; a failure there is reported per row.
    const catalog = readCatalogSide(config.catalog, token, visit)
    catalog.catch(() => {})

    try {
        const rows: SharedPackageRow[] = []
        for (const target of config.targets) rows.push(...(await sharedRowsOf(target, token, visit, catalog)))
        // The catalogue's proposals count too; a failure there is the rows' to tell.
        await catalog.catch(() => undefined)
        const older = olderOf(visit, config.targets)
        return { rows, ...named, ...(older ? { older } : {}) }
    } catch (error) {
        if (error instanceof GitLabError) return { rows: [], ...named, error: gitlabMessage(error) }
        throw error
    }
}

/**
 * One target's shared packages, every version the account ever proposed
 * (up to `AUTHOR_PAGES` pages of proposals). The account's merge requests and
 * the base branch with its package folders are asked once, side by side;
 * then the rows.
 */
async function sharedRowsOf(target: ExportTarget, token: string, visit: Visit, catalog: Promise<CatalogSide | undefined>): Promise<SharedPackageRow[]> {
    const client: GitLabClient = { ...clientFor(target.url, token), cache: SHARE_READS }
    const [project, bot] = await Promise.all([visit.project(client, target.url), visit.bot(client)])
    const base = readBaseTrees(client, project.id, target)
    base.catch(() => {})
    const requests = await visit.botRequests(client, project)

    // Newest first, so a branch's first request is the newest. The account names
    // the export branches, so its own requests are all there are from them:
    // asking GitLab once more per branch would add nothing. The same holds for
    // the removals "Zurückziehen" proposes, which belong to the row of their version.
    const byBranch = new Map<string, MergeRequestRef[]>()
    const removals = new Map<string, MergeRequestRef[]>()
    const add = <K>(map: Map<K, MergeRequestRef[]>, key: K, mr: MergeRequestRef) => {
        const known = map.get(key)
        if (known) known.push(mr)
        else map.set(key, [mr])
    }
    for (const mr of requests) {
        const removal = parseRemovalBranch(mr.source_branch)
        if (removal) add(removals, `${removal.slug}@${removal.version}`, mr)
        else if (parseBundleBranch(mr.source_branch)) add(byBranch, mr.source_branch, mr)
    }
    const context: TargetContext = { target, client, projectId: project.id, botId: bot.id, base, catalog, removals }
    return mapWithLimit([...byBranch.values()], ROW_CONCURRENCY, (branchRequests) => sharedPackageRow(context, branchRequests))
}

async function sharedPackageRow(context: TargetContext, requests: MergeRequestRef[]): Promise<SharedPackageRow> {
    const { target } = context
    const version = parseBundleBranch(requests[0].source_branch) as { slug: string; version: string }
    const removals = context.removals.get(`${version.slug}@${version.version}`) ?? []
    // An open request is the version's present; else a merge, which a later closed duplicate does not undo.
    // After a merged removal, only what was proposed since counts.
    const present = presentRequests(requests, removals)
    const pool = present.length ? present : requests
    const mr = pool.find((request) => request.state === 'opened') ?? pool.find((request) => request.state === 'merged') ?? pool[0]
    // Side by side: where the version stands, how each of its proposals ended, and where it came from.
    // The state waits for the proposals only where a "no" among them decides it.
    const ended = proposalsOf(context, version, requests, removals)
    const [state, proposals, source] = await Promise.all([
        // The newest removal since the package was last merged: an older one, merged, was undone by that merge.
        stateOf(context, version, requests, presentRequests(removals, requests)[0], mr, ended),
        ended,
        sourceOf(context, version.slug, mr),
    ])
    const own = proposals.find((proposal) => proposal.kind === 'bundle' && proposal.iid === mr.iid)
    return {
        key: `${target.key}#${mr.source_branch}`,
        targetKey: target.key,
        targetLabel: target.label,
        slug: version.slug,
        version: version.version,
        displayName: displayNameOf(mr.title, version.version) ?? version.slug,
        bundleMr: { url: mr.web_url, state: mr.state },
        folderUrl: folderHistoryUrl(target, version.slug),
        // Closed by the account, which is also used by hand: withdrawn only with the marketplace's mark or note.
        ...(mr.state === 'closed' && own?.withdrawnBy ? { withdrawn: true } : {}),
        ...state,
        ...(source ? { source } : {}),
        ...(proposerOf(mr.description) ? { proposedBy: proposerOf(mr.description) } : {}),
        proposals,
    }
}

/** The commits that touched a package's folder on the base branch, at GitLab: built from what is known, no call. */
function folderHistoryUrl(target: ExportTarget, slug: string): string {
    const encoded = (path: string) => path.split('/').map(encodeURIComponent).join('/')
    return `${target.url.replace(/\/+$/, '')}/-/commits/${encoded(target.baseBranch)}/${encoded(packageDir(target, slug))}`
}

/** The id of the same package in the version that took this one's place on the base branch, if it is the same package. */
function samePackageOnBase(bundle: BundleStatus, slug: string): string | undefined {
    const id = bundle.reason === 'other-version' ? bundle.onBase?.id : undefined
    return id?.endsWith(`:usecase:${slug}`) ? id : undefined
}

/** The "no" among a version's proposals of `kind`. */
function declineAmong(proposals: ShareProposal[], kind: ShareProposal['kind']): Decline | undefined {
    const declined = declinedProposal(proposals, kind)
    return declined ? declineOf(declined) : undefined
}

/**
 * Where a merged version stands in the repository and the catalogue; nothing
 * to read for any other. A "no" to its removal or entry comes from `ended`.
 */
async function stateOf(
    context: TargetContext,
    { slug, version }: { slug: string; version: string },
    requests: MergeRequestRef[],
    removal: MergeRequestRef | undefined,
    mr: MergeRequestRef,
    ended: Promise<ShareProposal[]>,
): Promise<Pick<SharedPackageRow, 'bundle' | 'catalog' | 'packageId' | 'problem'>> {
    if (mr.state !== 'merged') return {}
    const { target, client, projectId } = context
    try {
        const [{ head, trees }, proposals] = await Promise.all([context.base, ended])
        const removalDeclined = declineAmong(proposals, 'removal')
        const { status: bundle } = await inspectBundleIn(client, target, slug, version, undefined, {
            projectId,
            requests,
            head,
            treeOnBase: async () => trees.get(packageFolder(target, slug).name),
            removal,
            ...(removalDeclined ? { removalDeclined } : {}),
        })
        // A replaced version is asked about too: musterbach 1.1.3 stays listed while 1.1.4 waits for its entry.
        const packageId = bundle.packageId ?? samePackageOnBase(bundle, slug)
        if (!packageId) return { bundle }
        const side = await context.catalog
        return {
            bundle,
            catalog: side ? catalogStatusIn(side.context, slug, version, packageId, declineAmong(proposals, 'catalog')) : { state: 'unconfigured' },
            packageId,
        }
    } catch (error) {
        // One package GitLab cannot answer for does not take the list down with it.
        if (error instanceof GitLabError) return { problem: gitlabMessage(error) }
        throw error
    }
}

/**
 * Every proposal about one version: its package's, its removals' and its
 * catalogue entries'. The catalogue's branch names no repository, so an
 * entry that pins another target's folder belongs to that target's row.
 */
async function proposalsOf(
    context: TargetContext,
    { slug, version }: { slug: string; version: string },
    bundles: MergeRequestRef[],
    removals: MergeRequestRef[],
): Promise<ShareProposal[]> {
    // Without the catalogue the version still has its package's proposals; its state says the rest.
    const side = await context.catalog.catch(() => undefined)
    const branch = catalogBranch(slug, version)
    const dir = packageDir(context.target, slug)
    const entries = (side?.byBot ?? []).filter((mr) => mr.source_branch === branch && pinsHere(mr, context.target, dir))
    const here = { client: context.client, projectId: context.projectId, botId: context.botId }
    const proposals = await Promise.all([
        ...bundles.map((mr) => proposalOf('bundle', mr, here)),
        ...removals.map((mr) => proposalOf('removal', mr, here)),
        ...(side ? entries.map((mr) => proposalOf('catalog', mr, side)) : []),
    ])
    // Stable, so proposals without a date keep the order GitLab gave.
    return proposals.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

const sameProjectUrl = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase()

/** Whether a catalogue proposal pins this folder of this target, or names no pin at all. */
function pinsHere(mr: MergeRequestRef, target: ExportTarget, dir: string): boolean {
    const pin = catalogPinOf(mr.description)
    return !pin || (sameProjectUrl(pin.repo, target.url) && pin.path === dir)
}

async function proposalOf(
    kind: ShareProposal['kind'],
    mr: MergeRequestRef,
    where: { client: GitLabClient; projectId: number; botId: number },
): Promise<ShareProposal> {
    const closedByBot = mr.state === 'closed' && mr.closed_by?.id === where.botId
    const merger = mr.merge_user ?? mr.merged_by
    // Read for every close, a reviewer's as well: a "no" carries the catalogue team's words.
    const closing = mr.state === 'closed' ? await closingOf(where.client, where.projectId, mr) : undefined
    return {
        kind,
        iid: mr.iid,
        url: mr.web_url,
        state: mr.state,
        ...(mr.created_at ? { createdAt: mr.created_at } : {}),
        ...(mr.state === 'closed' && mr.closed_at ? { closedAt: mr.closed_at } : {}),
        ...(mr.state === 'merged' && mr.merged_at ? { mergedAt: mr.merged_at } : {}),
        ...(mr.state === 'closed' && mr.closed_by?.username ? { closedBy: mr.closed_by.username } : {}),
        ...(mr.state === 'merged' && merger?.username ? { mergedBy: merger.username } : {}),
        ...(closedByBot ? { closedByBot } : {}),
        ...(proposerOf(mr.description) ? { proposedBy: proposerOf(mr.description) } : {}),
        ...(closing?.withdrawnBy ? { withdrawnBy: closing.withdrawnBy } : {}),
        ...(closing?.reason ? { reason: closing.reason } : {}),
        ...(typeof mr.user_notes_count === 'number' ? { comments: mr.user_notes_count } : {}),
        ...(shareSourceOf(mr.description) ? { source: shareSourceOf(mr.description) } : {}),
    }
}

/**
 * How a closed request ended (`readClosing`), read once until the request
 * changes. Unreadable comments leave it not withdrawn, as GitLab shows it,
 * with the reason "unreadable"; the next visit asks again.
 */
async function closingOf(client: GitLabClient, projectId: number, mr: MergeRequestRef): Promise<Closing> {
    try {
        return await readClosing(client, projectId, mr)
    } catch (error) {
        if (error instanceof GitLabError) return { reason: { kind: 'unreadable' } }
        throw error
    }
}

/**
 * Where a version came from: its merge request's source line, or for an
 * older share the package README at the request's last commit, which GitLab
 * keeps after the merge. Read only without a line, and kept: a commit does
 * not change. Unreadable counts as unknown, and the next visit asks again.
 * Nothing is guessed from a name (plan of 2026-10-18, section 10).
 */
async function sourceOf(context: TargetContext, slug: string, mr: MergeRequestRef): Promise<ShareSource | undefined> {
    const line = shareSourceOf(mr.description)
    if (line) return line
    if (!mr.sha || (mr.state !== 'merged' && mr.state !== 'opened')) return undefined
    try {
        return readmeSourceOf(await readFile(context.client, context.projectId, `${packageDir(context.target, slug)}/README.md`, mr.sha))
    } catch (error) {
        if (error instanceof GitLabError) return undefined
        throw error
    }
}

/**
 * The catalogue repository's open merge requests, its index and the
 * account's proposals there - the merged ones tell what was listed once, to
 * tell a version the catalogue team took out - for every row of a listing at
 * once. A newer index than the catalogue pages hold makes them read theirs
 * again, where both read the same one.
 */
async function readCatalogSide(repo: CatalogRepo | undefined, token: string, visit: Visit): Promise<CatalogSide | undefined> {
    if (!repo) return undefined
    const client: GitLabClient = { ...clientFor(repo.url, token), cache: SHARE_READS }
    const project = await visit.project(client, repo.url)
    const [openRequests, index, byBot, bot] = await Promise.all([
        listOpenMergeRequests(client, project.id),
        readFile(client, project.id, 'index.json', repo.baseBranch),
        visit.botRequests(client, project),
        visit.bot(client),
    ])
    if (index !== undefined && servesSameIndex(repo)) expireCatalogIfOlder(index)
    return {
        context: { openRequests, index, merged: byBot.filter((mr) => mr.state === 'merged' && parseCatalogBranch(mr.source_branch)) },
        client,
        projectId: project.id,
        byBot,
        botId: bot.id,
    }
}

/**
 * Whether the catalogue pages read the same index: `REPO_LIST_URL` names the
 * same project and branch. Otherwise a newer index here says nothing about
 * theirs (plan of 2026-10-18, section 5).
 */
export function servesSameIndex(repo: CatalogRepo, env: Record<string, string | undefined> = process.env): boolean {
    const served = catalogRepoFromEnv({ REPO_LIST_URL: env.REPO_LIST_URL })
    return Boolean(served && sameProjectUrl(served.url, repo.url) && served.baseBranch === repo.baseBranch)
}
