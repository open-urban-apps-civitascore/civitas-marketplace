import { proposedByOther } from '@/lib/export/merge-request-text'
import type { ShareProposal, SharedPackageRow } from '@/lib/export/share-listing'
import { isNewerVersion, shareProgress, type ShareProgress } from '@/lib/export/share-stages'

/**
 * Which of the three lists of "Teilen" a shared version belongs in - „In
 * Arbeit“, „Veröffentlicht“, „Beendet“ - and what the page needs around
 * them: the instance filter, the counts in the tab bar and the datasets that
 * are busy (plan of 2026-10-18, sections 4-6 and 10). One rule set, pure, for
 * the server and the client alike; tested like the stage rules it builds on.
 *
 * - „In Arbeit“: everything submitted that is not in the catalogue yet and
 *   that someone can still move on - including a version whose state could
 *   not be read, so it is not lost.
 * - „Veröffentlicht“: listed in the catalogue's index, not withdrawn, put
 *   there through this marketplace's proposal of exactly that version.
 * - „Beendet“: one entry per ended proposal (withdrawn, not accepted, a
 *   removal accepted), plus a version gone from the repository by hand and
 *   the version the catalogue team took out. Replaced versions are no ending:
 *   they show as earlier versions on the row that replaced them.
 *
 * Each list holds what came from this instance; a share of an unknown
 * instance (older ones whose README names none) is shown with a flag, one of
 * another instance only counted (demo, dev and local share one account).
 */

export type ShareTab = 'in-progress' | 'published' | 'ended'

/**
 * Where a share came from, compared with this instance: `unknown` when
 * either side names no instance - then nothing can be told, and the share is
 * shown with a flag rather than hidden.
 */
export type InstanceMatch = 'this' | 'other' | 'unknown'

/** What became of one version, as the tabs sort it; every ending of `shareProgress` maps onto one. */
export type ShareOutcome =
    /** GitLab could not be read for it. */
    | 'unreadable'
    /** Its package proposal waits for the catalogue team. */
    | 'in-review'
    /** A proposal is open on a version that was accepted already (bodenfeuchte on the demo). */
    | 'change-in-review'
    /** Its removal waits for the catalogue team. */
    | 'removal-pending'
    /** Accepted; proposing the catalogue entry is the person's move. */
    | 'accepted'
    /** Accepted, but the folder is not what the review saw. */
    | 'needs-look'
    /** Accepted, but the repository cannot tell: its base branch is missing, or the manifest is no JSON. */
    | 'broken'
    /** Accepted, and this instance has no catalogue to propose it to. */
    | 'no-catalogue'
    /** Its catalogue entry waits for the catalogue team. */
    | 'entry-in-review'
    /** An open catalogue proposal would bring back what the catalogue team took out. */
    | 'brings-back'
    /** In the catalogue. */
    | 'listed'
    /** A newer version of the package took its place in the repository. */
    | 'replaced'
    /** The catalogue team took it out of the catalogue. */
    | 'taken-out'
    /** Its removal was accepted. */
    | 'removed'
    /** Gone from the repository, or set back there, by hand: no removal proposal. */
    | 'gone'
    /** Its proposal was withdrawn through the marketplace. */
    | 'withdrawn'
    /** Its proposal was closed any other way. */
    | 'not-accepted'

/** Where each outcome is listed; undefined for none of the lists. */
export const TAB_OF: Readonly<Record<ShareOutcome, ShareTab | undefined>> = {
    unreadable: 'in-progress',
    'in-review': 'in-progress',
    'change-in-review': 'in-progress',
    'removal-pending': 'in-progress',
    accepted: 'in-progress',
    'needs-look': 'in-progress',
    broken: 'in-progress',
    'no-catalogue': 'in-progress',
    'entry-in-review': 'in-progress',
    'brings-back': 'in-progress',
    listed: 'published',
    replaced: undefined,
    'taken-out': 'ended',
    removed: 'ended',
    gone: 'ended',
    withdrawn: 'ended',
    'not-accepted': 'ended',
}

/** Where a listed version stands, from everything the list read about it. */
export function rowProgress(row: SharedPackageRow): ShareProgress {
    return shareProgress({ version: row.version, bundleMrState: row.bundleMr.state, bundle: row.bundle, catalog: row.catalog, withdrawn: row.withdrawn })
}

/** The proposals of a row, or for one built without them, what its own fields say. */
function proposalsOf(row: SharedPackageRow): ShareProposal[] {
    if (row.proposals) return row.proposals
    const iid = (url: string) => Number(url.match(/\/merge_requests\/(\d+)/)?.[1] ?? 0)
    const removal = row.bundle?.removal
    return [
        { kind: 'bundle', iid: iid(row.bundleMr.url), url: row.bundleMr.url, state: row.bundleMr.state },
        ...(removal ? [{ kind: 'removal' as const, iid: iid(removal.mrUrl), url: removal.mrUrl, state: removal.state }] : []),
    ]
}

/** What became of one version (see {@link ShareOutcome}), in the order `shareProgress` decides, with "listed" first among the endings of a merge. */
export function rowOutcome(row: SharedPackageRow, progress: ShareProgress = rowProgress(row)): ShareOutcome {
    if (row.problem) return 'unreadable'
    if (progress.active === 'review') {
        // The version's own merge request was merged once already: the open one changes an accepted package.
        const acceptedBefore = proposalsOf(row).some((proposal) => proposal.kind === 'bundle' && proposal.state === 'merged')
        return acceptedBefore ? 'change-in-review' : 'in-review'
    }
    if (progress.removal === 'pending') return 'removal-pending'
    // Listed pins a commit, so it stays installable whatever the folder does since; the warnings mean nothing for it.
    if (row.bundleMr.state === 'merged' && row.catalog?.state === 'listed') return 'listed'
    if (progress.removal === 'done') return 'removed'

    const { bundle, catalog } = row
    if (bundle?.state === 'on-base') {
        if (catalog?.state === 'withdrawn') return 'taken-out'
        if (catalog?.state === 'mr-open' && catalog.bringsBack) return 'brings-back'
        if (bundle.verification && bundle.verification.state !== 'verified') return 'needs-look'
        if (catalog?.state === 'mr-open') return 'entry-in-review'
        if (catalog?.state === 'unconfigured') return 'no-catalogue'
        return 'accepted'
    }
    if (row.bundleMr.state === 'merged') {
        // Not read, and no reason given why: as good as unreadable.
        if (!bundle) return 'unreadable'
        if (bundle.reason === 'other-version' && bundle.onBase && isNewerVersion(bundle.onBase.version, row.version)) return 'replaced'
        if (bundle.reason === 'bad-manifest' || bundle.reason === 'no-base-branch') return 'broken'
        return 'gone'
    }
    if (row.bundleMr.state === 'closed') return row.withdrawn ? 'withdrawn' : 'not-accepted'
    // Any other state GitLab names (`locked` while it merges) is still in the catalogue team's hands.
    return 'in-review'
}

const normalised = (instance: string) => instance.trim().replace(/\/+$/, '').toLowerCase()

/** Where a share came from, compared with this instance (see {@link InstanceMatch}). */
export function instanceMatch(source: { instance?: string } | undefined, instance: string | undefined): InstanceMatch {
    if (!source?.instance || !instance) return 'unknown'
    return normalised(source.instance) === normalised(instance) ? 'this' : 'other'
}

/** The person's own move: their stage, on a share proposed for them or for nobody named - never for a colleague (plan, section 4). */
export function isYourMove(row: SharedPackageRow, progress: ShareProgress, person: string | undefined): boolean {
    return !row.problem && progress.turn === 'you' && !proposedByOther(row.proposedBy, person)
}

export interface TabRow {
    row: SharedPackageRow
    outcome: ShareOutcome
    progress: ShareProgress
    origin: InstanceMatch
    /** The person's own move (see {@link isYourMove}): what „1 bei dir“ counts. */
    mine: boolean
    /** Versions of the same package that this one replaced, lowest first: „Frühere Versionen“. */
    earlier: string[]
    /** For a listed version: the newer version of the same package that is in progress meanwhile. */
    newer?: { key: string; version: string }
}

/**
 * - `withdrawn`: closed through the marketplace, with its note
 * - `not-accepted`: closed any other way - by a reviewer, or by hand through the marketplace's account
 * - `removed`: a removal accepted, or the folder gone without one (`byHand`)
 * - `taken-out`: the catalogue team took the version out of the catalogue
 */
export type Ending = 'withdrawn' | 'not-accepted' | 'removed' | 'taken-out'

/** One row of „Beendet“. Never overwritten: a version withdrawn and submitted again keeps its old row. */
export interface EndedEntry {
    key: string
    ending: Ending
    /** What ended: a proposal of the package, of its catalogue entry or of its removal - or the version itself. */
    what: ShareProposal['kind'] | 'version'
    row: SharedPackageRow
    version: string
    /** The proposal that ended; absent for a version gone by hand or taken out of the catalogue. */
    proposal?: ShareProposal
    /** When it ended, as GitLab says; absent when nobody can tell. */
    at?: string
    /** For `taken-out`: the catalogue team's reason, when they gave one. */
    reason?: string
    /** For `removed`: done by hand at GitLab, without a proposal. */
    byHand?: boolean
    origin: InstanceMatch
}

export interface ShareTabs {
    /** „In Arbeit“, in the listing's order (newest first). */
    inProgress: TabRow[]
    /** „Veröffentlicht“: one row per catalogue entry, at its listed version. */
    published: TabRow[]
    /** „Beendet“, newest ending first; endings without a date last. */
    ended: EndedEntry[]
    /** What other instances shared through the same account: counted per list, not listed. */
    elsewhere: Record<ShareTab, number>
    /**
     * The datasets something is submitted for and not in the catalogue yet,
     * with the rows that make them busy - for „Auswählen“ to grey them out.
     * From this instance or an unknown one, as „In Arbeit“ shows them; a row
     * whose state could not be read makes nothing busy (the server checks
     * again on submit).
     */
    busy: ReadonlyMap<string, TabRow[]>
    counts: {
        /** Rows in „In Arbeit“, with the started shares the caller counts in. */
        inProgress: number
        /** Of those, the person's own moves: „1 bei dir“. */
        mine: number
        published: number
    }
}

export interface ShareTabsOptions {
    /** This instance, as the listing names it (`ShareListing.instance`). */
    instance?: string
    /** Who is looking, by the name proposals are made for (`proposerName`). */
    person?: string
    /** Shares started in this browser: in „In Arbeit“, and always the person's own move. */
    drafts?: number
}

const packageOf = (row: SharedPackageRow) => `${row.targetKey}#${row.slug}`

/** The highest of plain x.y.z versions. */
const highest = (versions: string[]) => versions.reduce<string | undefined>((best, version) => (!best || isNewerVersion(version, best) ? version : best), undefined)

/** When a proposal ended, as GitLab says. */
const endedAt = (proposal: ShareProposal) => proposal.mergedAt ?? proposal.closedAt

/**
 * How one proposal of `row` ended, or undefined while it has not, or for a
 * merge that is no ending (a package's, a catalogue entry's). A row built
 * without its proposals knows of its own package proposal only that it was
 * withdrawn (`withdrawn`), not by whom.
 */
function endingOf(proposal: ShareProposal, row: SharedPackageRow): Ending | undefined {
    if (proposal.state === 'closed') {
        const withdrawn = proposal.withdrawnBy !== undefined || (!row.proposals && proposal.kind === 'bundle' && row.withdrawn)
        return withdrawn ? 'withdrawn' : 'not-accepted'
    }
    if (proposal.state === 'merged' && proposal.kind === 'removal') return 'removed'
    return undefined
}

export function shareTabs(rows: readonly SharedPackageRow[], { instance, person, drafts = 0 }: ShareTabsOptions = {}): ShareTabs {
    const read = rows.map((row) => {
        const progress = rowProgress(row)
        return { row, progress, outcome: rowOutcome(row, progress), origin: instanceMatch(row.source, instance) }
    })
    const shown = (origin: InstanceMatch) => origin !== 'other'

    // Per package: the versions replaced, and what is in progress, for the cross-links on each row.
    const byPackage = new Map<string, typeof read>()
    for (const entry of read) byPackage.set(packageOf(entry.row), [...(byPackage.get(packageOf(entry.row)) ?? []), entry])
    const tabRow = (entry: (typeof read)[number]): TabRow => {
        const family = byPackage.get(packageOf(entry.row)) ?? []
        const earlier = family
            .filter((other) => other.outcome === 'replaced' && isNewerVersion(entry.row.version, other.row.version))
            .map((other) => other.row.version)
            .sort((a, b) => (isNewerVersion(a, b) ? 1 : isNewerVersion(b, a) ? -1 : 0))
        // Only to a row „In Arbeit“ shows: another instance's newer version is counted there, not listed, so a link would lead nowhere.
        const newer = entry.outcome === 'listed'
            ? family.find((other) => TAB_OF[other.outcome] === 'in-progress' && shown(other.origin) && isNewerVersion(other.row.version, entry.row.version))
            : undefined
        return {
            row: entry.row,
            outcome: entry.outcome,
            progress: entry.progress,
            origin: entry.origin,
            mine: isYourMove(entry.row, entry.progress, person),
            earlier,
            ...(newer ? { newer: { key: newer.row.key, version: newer.row.version } } : {}),
        }
    }

    const elsewhere: Record<ShareTab, number> = { 'in-progress': 0, published: 0, ended: 0 }
    const inProgress: TabRow[] = []
    const published: TabRow[] = []
    for (const entry of read) {
        const tab = TAB_OF[entry.outcome]
        if (tab !== 'in-progress' && tab !== 'published') continue
        if (!shown(entry.origin)) {
            elsewhere[tab]++
            continue
        }
        ;(tab === 'in-progress' ? inProgress : published).push(tabRow(entry))
    }

    const ended: EndedEntry[] = []
    const end = (entry: EndedEntry) => {
        if (shown(entry.origin)) ended.push(entry)
        else elsewhere.ended++
    }
    for (const { row, outcome, origin } of read) {
        for (const proposal of proposalsOf(row)) {
            const ending = endingOf(proposal, row)
            if (!ending) continue
            // A proposal names its own instance where it can: two proposals on one branch may come from two instances.
            const own = proposal.source?.instance ? instanceMatch(proposal.source, instance) : origin
            const at = endedAt(proposal)
            end({ key: `${row.key}#${proposal.kind}!${proposal.iid}`, ending, what: proposal.kind, row, version: row.version, proposal, ...(at ? { at } : {}), origin: own })
        }
        if (outcome === 'gone') end({ key: `${row.key}#gone`, ending: 'removed', what: 'version', row, version: row.version, byHand: true, origin })
    }
    // One entry per package for what the catalogue team took out: the version its rows report, the newest one out.
    for (const family of byPackage.values()) {
        const out = highest(family.flatMap(({ row }) => (row.catalog?.takenOut ? [row.catalog.takenOut.version] : [])))
        if (!out) continue
        const reporting = family.find(({ row }) => row.catalog?.takenOut?.version === out && row.catalog.takenOut.reason)
        const holder = family.find(({ row }) => row.version === out) ?? family[0]
        const reason = reporting?.row.catalog?.takenOut?.reason
        end({
            key: `${packageOf(holder.row)}@${out}#taken-out`,
            ending: 'taken-out',
            what: 'version',
            row: holder.row,
            version: out,
            ...(reason ? { reason } : {}),
            origin: holder.origin,
        })
    }
    // Newest first; a stable sort keeps the listing's order among equals and puts what has no date last.
    ended.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))

    const busy = new Map<string, TabRow[]>()
    for (const tabbed of inProgress) {
        const datasetId = tabbed.row.source?.id
        if (!datasetId || tabbed.outcome === 'unreadable') continue
        busy.set(datasetId, [...(busy.get(datasetId) ?? []), tabbed])
    }

    return {
        inProgress,
        published,
        ended,
        elsewhere,
        busy,
        counts: {
            inProgress: inProgress.length + drafts,
            mine: inProgress.filter((tabbed) => tabbed.mine).length + drafts,
            published: published.length,
        },
    }
}
