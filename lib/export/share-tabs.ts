import { DECLINE_DAYS, declinedChange, declinedProposal, declineOf, laterDecline, mayBeWithdrawn, presentProposals, type Decline } from '@/lib/export/declines'
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
 *
 * A "no" of the catalogue team stays in „In Arbeit“ for {@link DECLINE_DAYS}
 * days, or until a newer version has a proposal; then it is only an ending
 * in „Beendet“. "Now" is a parameter, so this stays pure.
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
    /** Accepted, but the catalogue team turned its entry down. */
    | 'entry-declined'
    /** Accepted, and the catalogue team turned its removal down: the package stays. */
    | 'removal-declined'
    /** Accepted, but the whole entry was taken out at an earlier version: nobody can move it on. */
    | 'entry-revoked'
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
    /** Its proposal was closed any other way - by a reviewer, or by hand through the marketplace's account: a "no". */
    | 'declined'

/**
 * Where each outcome is listed; undefined for none of the lists. A "no" to the
 * package or the entry is in „In Arbeit“ only while current ({@link declineIsCurrent});
 * one to a removal stays there, as nobody's move, since the package stays accepted.
 */
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
    'entry-declined': 'in-progress',
    'removal-declined': 'in-progress',
    'entry-revoked': 'in-progress',
    listed: 'published',
    replaced: undefined,
    'taken-out': 'ended',
    removed: 'ended',
    gone: 'ended',
    withdrawn: 'ended',
    declined: 'in-progress',
}

/** A "no" listed in „In Arbeit“ only while current: afterwards nothing is left to move on. */
const ONLY_WHILE_CURRENT: ReadonlySet<ShareOutcome> = new Set(['declined', 'entry-declined'])

/**
 * A removal turned down after the entry was: the package stays, but only a new
 * version can move it on, so the row is listed only while current and makes no dataset busy.
 */
function entryUsedUp(outcome: ShareOutcome, row: SharedPackageRow): boolean {
    return outcome === 'removal-declined' && row.catalog?.state === 'declined'
}

/** Outcomes with a proposal open at GitLab: a new version of the dataset waits for them, and the server refuses it meanwhile. */
export const OPEN_OUTCOMES: ReadonlySet<ShareOutcome> = new Set(['in-review', 'change-in-review', 'removal-pending', 'entry-in-review', 'brings-back'])

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
    // A "no" is the review stage too: only one still waiting is in review.
    if (progress.active === 'review' && progress.states.review === 'waiting') {
        // The version's own merge request was merged once already, and not removed since: the open one changes an accepted package.
        const acceptedBefore = presentProposals(proposalsOf(row), 'bundle').some((proposal) => proposal.state === 'merged')
        return acceptedBefore ? 'change-in-review' : 'in-review'
    }
    if (progress.removal === 'pending') return 'removal-pending'
    // Listed pins a commit, so it stays installable whatever the folder does since; the warnings mean nothing for it.
    if (row.bundleMr.state === 'merged' && row.catalog?.state === 'listed') return 'listed'
    if (progress.removal === 'done') return 'removed'

    const { bundle, catalog } = row
    if (bundle?.state === 'on-base') {
        // A whole entry taken out at an earlier version leaves this one in the repository, with nowhere to go.
        if (catalog?.state === 'withdrawn') return catalog.takenOut && catalog.takenOut.version !== row.version ? 'entry-revoked' : 'taken-out'
        if (catalog?.state === 'mr-open' && catalog.bringsBack) return 'brings-back'
        // The catalogue team's "no" comes before what the folder says; of two, the later one - an open entry proposal is newer than both.
        const entryNo = catalog?.state === 'declined' ? catalog.declined : undefined
        const removalNo = catalog?.state !== 'mr-open' ? bundle.removal?.declined : undefined
        const latest = laterDecline(entryNo, removalNo)
        if (latest) return latest === removalNo ? 'removal-declined' : 'entry-declined'
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
    // Nothing was merged from its branch: a close without the withdrawal mark is a "no".
    if (row.bundleMr.state === 'closed') return row.withdrawn ? 'withdrawn' : 'declined'
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
    /** The person's own move (see {@link isYourMove}), for a "no" only while current: what „Du bist dran“ counts. */
    mine: boolean
    /** Versions of the same package that this one replaced, lowest first: „Frühere Versionen“. */
    earlier: string[]
    /** Lower versions whose package or entry was turned down, lowest first: „nicht angenommen“ among „Frühere Versionen“. */
    declinedEarlier: string[]
    /** For a listed version: the newer version of the same package that is in progress meanwhile. */
    newer?: { key: string; version: string }
    /** The "no" the row stands at (package, entry or removal), and whether it is still the sharing side's move. */
    declined?: { decline: Decline; current: boolean }
    /** A change to this accepted version that the catalogue team did not take: a note while current, no block. */
    declinedChange?: Decline
}

/** How long a "no" is the sharing side's move, in milliseconds. */
const DECLINE_WINDOW_MS = DECLINE_DAYS * 24 * 60 * 60 * 1000

/**
 * Whether a "no" is still the sharing side's move: closed within
 * {@link DECLINE_DAYS} days, proposed from this instance, and no newer
 * version of the package proposed since. Never without a date, nor while it
 * may be an unread withdrawal (`mayBeWithdrawn`).
 */
export function declineIsCurrent(
    proposal: Pick<ShareProposal, 'kind' | 'closedAt' | 'closedByBot' | 'reason' | 'source'>,
    version: string,
    family: readonly Pick<SharedPackageRow, 'version'>[],
    instance: string | undefined,
    now: number,
): boolean {
    const closed = proposal.closedAt ? Date.parse(proposal.closedAt) : NaN
    if (Number.isNaN(closed) || now - closed > DECLINE_WINDOW_MS) return false
    if (mayBeWithdrawn(proposal)) return false
    if (instanceMatch(proposal.source, instance) !== 'this') return false
    return !family.some((other) => isNewerVersion(other.version, version))
}

/** Which of a row's proposals its "no" is, for the outcomes that stand at one. */
const DECLINED_KIND: Partial<Record<ShareOutcome, ShareProposal['kind']>> = {
    declined: 'bundle',
    'entry-declined': 'catalog',
    'removal-declined': 'removal',
}

/**
 * - `withdrawn`: closed through the marketplace, with its mark or note
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
     * again on submit), nor one whose way on is a new version (see
     * `FREE_TO_CHOOSE`).
     */
    busy: ReadonlyMap<string, TabRow[]>
    counts: {
        /** Rows in „In Arbeit“, with the started shares the caller counts in. */
        inProgress: number
        /** Of those, the person's own moves: the group „Du bist dran“. */
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
    /** What a "no" is measured against, in ms: when the listing was read, so the lists do not change between readings. Now by default. */
    now?: number
}

/**
 * Outcomes in „In Arbeit“ that make no dataset busy: one that could not be
 * read (the server checks again on submit), and those whose way on is a new
 * version. A "no" to a removal is busy, unless the entry was turned down too.
 */
const FREE_TO_CHOOSE: ReadonlySet<ShareOutcome> = new Set(['unreadable', 'declined', 'entry-declined', 'entry-revoked'])

/** The outcomes „Frühere Versionen“ lists plainly, and those it lists as „nicht angenommen“. */
const REPLACED: ReadonlySet<ShareOutcome> = new Set(['replaced'])
const TURNED_DOWN: ReadonlySet<ShareOutcome> = new Set(['declined', 'entry-declined'])

/** Outcomes where the catalogue's index says what became of the entry, so a closed entry proposal is no ending of its own. */
const ENTRY_SAID: ReadonlySet<ShareOutcome> = new Set(['listed', 'taken-out', 'entry-revoked'])

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

export function shareTabs(rows: readonly SharedPackageRow[], { instance, person, drafts = 0, now = Date.now() }: ShareTabsOptions = {}): ShareTabs {
    const families = new Map<string, SharedPackageRow[]>()
    for (const row of rows) families.set(packageOf(row), [...(families.get(packageOf(row)) ?? []), row])

    const read = rows.map((row) => {
        const progress = rowProgress(row)
        const outcome = rowOutcome(row, progress)
        const proposals = proposalsOf(row)
        const current = (proposal: ShareProposal) => declineIsCurrent(proposal, row.version, families.get(packageOf(row)) ?? [], instance, now)
        // A row built without its proposals knows its "no" only from its reading, and nothing of its time.
        const kind = DECLINED_KIND[outcome]
        const proposal = kind ? declinedProposal(proposals, kind) : undefined
        const reading = outcome === 'entry-declined' ? row.catalog?.declined : outcome === 'removal-declined' ? row.bundle?.removal?.declined : undefined
        const decline = proposal ? declineOf(proposal) : reading
        const change = declinedChange(proposals)
        return {
            row,
            progress,
            outcome,
            origin: instanceMatch(row.source, instance),
            // May be a withdrawal whose comments could not be read: never told beside a newer version.
            unsure: proposal ? mayBeWithdrawn(proposal) : false,
            ...(decline ? { declined: { decline, current: proposal ? current(proposal) : false } } : {}),
            ...(change && current(change) ? { declinedChange: declineOf(change) } : {}),
        }
    })
    const shown = (origin: InstanceMatch) => origin !== 'other'
    const onlyWhileCurrent = (entry: (typeof read)[number]) => ONLY_WHILE_CURRENT.has(entry.outcome) || entryUsedUp(entry.outcome, entry.row)
    const tabOf = (entry: (typeof read)[number]) => (onlyWhileCurrent(entry) && !entry.declined?.current ? undefined : TAB_OF[entry.outcome])

    // Per package: the versions replaced, and what is in progress, for the cross-links on each row.
    const byPackage = new Map<string, typeof read>()
    for (const entry of read) byPackage.set(packageOf(entry.row), [...(byPackage.get(packageOf(entry.row)) ?? []), entry])
    const tabRow = (entry: (typeof read)[number]): TabRow => {
        const family = byPackage.get(packageOf(entry.row)) ?? []
        const below = (outcomes: ReadonlySet<ShareOutcome>) =>
            family
                .filter((other) => outcomes.has(other.outcome) && !other.unsure && isNewerVersion(entry.row.version, other.row.version))
                .map((other) => other.row.version)
                .sort((a, b) => (isNewerVersion(a, b) ? 1 : isNewerVersion(b, a) ? -1 : 0))
        const earlier = below(REPLACED)
        // A lower "no" is told here, not one that may be an unread withdrawal („nicht angenommen“ would be a guess).
        const declinedEarlier = below(TURNED_DOWN)
        // Only to a row „In Arbeit“ shows: another instance's newer version is counted there, not listed, so a link would lead nowhere.
        const newer = entry.outcome === 'listed'
            ? family.find((other) => tabOf(other) === 'in-progress' && shown(other.origin) && isNewerVersion(other.row.version, entry.row.version))
            : undefined
        return {
            row: entry.row,
            outcome: entry.outcome,
            progress: entry.progress,
            origin: entry.origin,
            // A "no" past its time is told on the row, but asked of nobody.
            mine: isYourMove(entry.row, entry.progress, person) && entry.declined?.current !== false,
            earlier,
            declinedEarlier,
            ...(newer ? { newer: { key: newer.row.key, version: newer.row.version } } : {}),
            ...(entry.declined ? { declined: entry.declined } : {}),
            ...(entry.declinedChange ? { declinedChange: entry.declinedChange } : {}),
        }
    }

    const elsewhere: Record<ShareTab, number> = { 'in-progress': 0, published: 0, ended: 0 }
    const inProgress: TabRow[] = []
    const published: TabRow[] = []
    for (const entry of read) {
        const tab = tabOf(entry)
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
            // Listed or taken out, the index tells what became of the entry: a closed entry proposal adds nothing.
            if (ENTRY_SAID.has(outcome) && proposal.kind === 'catalog' && ending === 'not-accepted') continue
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
        if (!datasetId || FREE_TO_CHOOSE.has(tabbed.outcome) || entryUsedUp(tabbed.outcome, tabbed.row)) continue
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
