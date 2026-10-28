import { DECLINE_DAYS, declinedChange, declinedProposal, declineOf, laterDecline, mayBeWithdrawn, presentProposals, type Decline } from '@/lib/export/declines'
import { proposedByOther } from '@/lib/export/merge-request-text'
import type { ShareProposal, SharedPackageRow } from '@/lib/export/share-listing'
import { isNewerVersion, shareProgress, type ShareProgress } from '@/lib/export/share-stages'

export type ShareTab = 'in-progress' | 'published' | 'ended'

/** `unknown` when either side names no instance: such a share is flagged, not hidden. */
export type InstanceMatch = 'this' | 'other' | 'unknown'

/** Every ending of `shareProgress` maps onto one. */
export type ShareOutcome =
    | 'unreadable'
    | 'in-review'
    | 'change-in-review'
    | 'removal-pending'
    | 'accepted'
    /** Accepted, but the folder is not what the review saw. */
    | 'needs-look'
    /** Accepted, but the base branch is missing or the manifest is no JSON. */
    | 'broken'
    | 'no-catalogue'
    | 'entry-in-review'
    /** An open catalogue proposal would bring back what the catalogue team took out. */
    | 'brings-back'
    | 'entry-declined'
    | 'removal-declined'
    /** Accepted, but the whole entry was taken out at an earlier version: nobody can move it on. */
    | 'entry-revoked'
    | 'listed'
    | 'replaced'
    | 'taken-out'
    | 'removed'
    /** Gone from the repository, or set back there, by hand: no removal proposal. */
    | 'gone'
    | 'withdrawn'
    /** Closed any other way, also by hand through the marketplace's account. */
    | 'declined'

/** A "no" to package or entry is listed only while current (`ONLY_WHILE_CURRENT`). */
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

const ONLY_WHILE_CURRENT: ReadonlySet<ShareOutcome> = new Set(['declined', 'entry-declined'])

/** Removal and entry both turned down: only a new version can move it on. */
function entryUsedUp(outcome: ShareOutcome, row: SharedPackageRow): boolean {
    return outcome === 'removal-declined' && row.catalog?.state === 'declined'
}

/** A proposal is open at GitLab: the server refuses a new version of the dataset meanwhile. */
export const OPEN_OUTCOMES: ReadonlySet<ShareOutcome> = new Set(['in-review', 'change-in-review', 'removal-pending', 'entry-in-review', 'brings-back'])

export function rowProgress(row: SharedPackageRow): ShareProgress {
    return shareProgress({ version: row.version, bundleMrState: row.bundleMr.state, bundle: row.bundle, catalog: row.catalog, withdrawn: row.withdrawn })
}

function proposalsOf(row: SharedPackageRow): ShareProposal[] {
    if (row.proposals) return row.proposals
    const iid = (url: string) => Number(url.match(/\/merge_requests\/(\d+)/)?.[1] ?? 0)
    const removal = row.bundle?.removal
    return [
        { kind: 'bundle', iid: iid(row.bundleMr.url), url: row.bundleMr.url, state: row.bundleMr.state },
        ...(removal ? [{ kind: 'removal' as const, iid: iid(removal.mrUrl), url: removal.mrUrl, state: removal.state }] : []),
    ]
}

export function rowOutcome(row: SharedPackageRow, progress: ShareProgress = rowProgress(row)): ShareOutcome {
    if (row.problem) return 'unreadable'
    // A "no" is the review stage too: only one still waiting is in review.
    if (progress.active === 'review' && progress.states.review === 'waiting') {
        const acceptedBefore = presentProposals(proposalsOf(row), 'bundle').some((proposal) => proposal.state === 'merged')
        return acceptedBefore ? 'change-in-review' : 'in-review'
    }
    if (progress.removal === 'pending') return 'removal-pending'
    // Listed pins a commit: what the folder does since no longer matters.
    if (row.bundleMr.state === 'merged' && row.catalog?.state === 'listed') return 'listed'
    if (progress.removal === 'done') return 'removed'

    const { bundle, catalog } = row
    if (bundle?.state === 'on-base') {
        if (catalog?.state === 'withdrawn') return catalog.takenOut && catalog.takenOut.version !== row.version ? 'entry-revoked' : 'taken-out'
        if (catalog?.state === 'mr-open' && catalog.bringsBack) return 'brings-back'
        // A "no" beats the folder; of two the later; an open entry proposal is newer than both.
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
        if (!bundle) return 'unreadable'
        if (bundle.reason === 'other-version' && bundle.onBase && isNewerVersion(bundle.onBase.version, row.version)) return 'replaced'
        if (bundle.reason === 'bad-manifest' || bundle.reason === 'no-base-branch') return 'broken'
        return 'gone'
    }
    // A close without the withdrawal mark is a "no".
    if (row.bundleMr.state === 'closed') return row.withdrawn ? 'withdrawn' : 'declined'
    // Other GitLab states (`locked` while it merges) are still with the catalogue team.
    return 'in-review'
}

const normalised = (instance: string) => instance.trim().replace(/\/+$/, '').toLowerCase()

export function instanceMatch(source: { instance?: string } | undefined, instance: string | undefined): InstanceMatch {
    if (!source?.instance || !instance) return 'unknown'
    return normalised(source.instance) === normalised(instance) ? 'this' : 'other'
}

/** Never without `PORTAL_URL`: a flag on every row would say nothing. */
export function ofUnknownInstance(origin: InstanceMatch, instance: string | undefined): boolean {
    return origin === 'unknown' && Boolean(instance)
}

export function isYourMove(row: SharedPackageRow, progress: ShareProgress, person: string | undefined): boolean {
    return !row.problem && progress.turn === 'you' && !proposedByOther(row.proposedBy, person)
}

export interface TabRow {
    row: SharedPackageRow
    outcome: ShareOutcome
    progress: ShareProgress
    origin: InstanceMatch
    /** For a "no" only while current. */
    mine: boolean
    /** Replaced versions of the same package, lowest first. */
    earlier: string[]
    declinedEarlier: { version: string; kind: TurnedDown }[]
    /** Of `earlier`, those once listed through a merged entry proposal. */
    listedEarlier: string[]
    /** For a listed version: a newer one in progress meanwhile. */
    newer?: { key: string; version: string; declined?: TurnedDown }
    /** `current`: still the sharing side's move. */
    declined?: { decline: Decline; current: boolean }
    declinedChange?: Decline
}

const DECLINE_WINDOW_MS = DECLINE_DAYS * 24 * 60 * 60 * 1000

/** A newer version from another instance does not end a "no": it has no row to go on from. */
export function declineIsCurrent(
    proposal: Pick<ShareProposal, 'kind' | 'closedAt' | 'closedByBot' | 'reason' | 'source'>,
    version: string,
    family: readonly Pick<SharedPackageRow, 'version' | 'source'>[],
    instance: string | undefined,
    now: number,
): boolean {
    const closed = proposal.closedAt ? Date.parse(proposal.closedAt) : NaN
    if (Number.isNaN(closed) || now - closed > DECLINE_WINDOW_MS) return false
    if (mayBeWithdrawn(proposal)) return false
    if (instanceMatch(proposal.source, instance) !== 'this') return false
    return !family.some((other) => instanceMatch(other.source, instance) !== 'other' && isNewerVersion(other.version, version))
}

const DECLINED_KIND: Partial<Record<ShareOutcome, ShareProposal['kind']>> = {
    declined: 'bundle',
    'entry-declined': 'catalog',
    'removal-declined': 'removal',
}

/** `not-accepted` includes a close by hand through the marketplace's account. */
export type Ending = 'withdrawn' | 'not-accepted' | 'removed' | 'taken-out'

/** Never overwritten: a version withdrawn and submitted again keeps its old row. */
export interface EndedEntry {
    key: string
    ending: Ending
    what: ShareProposal['kind'] | 'version'
    row: SharedPackageRow
    version: string
    proposal?: ShareProposal
    at?: string
    reason?: string
    byHand?: boolean
    origin: InstanceMatch
}

export interface ShareTabs {
    inProgress: TabRow[]
    published: TabRow[]
    ended: EndedEntry[]
    /** Other instances' shares (demo, dev and local share one account): counted, not listed. */
    elsewhere: Record<ShareTab, number>
    /** Datasets „Auswählen“ greys out: submitted, not in the catalogue yet; see `FREE_TO_CHOOSE`. */
    busy: ReadonlyMap<string, TabRow[]>
    counts: {
        /** Includes the started shares (`drafts`). */
        inProgress: number
        published: number
    }
}

export interface ShareTabsOptions {
    instance?: string
    /** The name proposals are made for (`proposerName`). */
    person?: string
    drafts?: number
    /** When the listing was read, so the lists do not change between readings. */
    now?: number
}

/** Unreadable: the server checks again on submit; the rest go on only with a new version. */
const FREE_TO_CHOOSE: ReadonlySet<ShareOutcome> = new Set(['unreadable', 'declined', 'entry-declined', 'entry-revoked'])

const REPLACED: ReadonlySet<ShareOutcome> = new Set(['replaced'])

export type TurnedDown = 'package' | 'entry'

export function turnedDown(outcome: ShareOutcome): TurnedDown | undefined {
    return outcome === 'declined' ? 'package' : outcome === 'entry-declined' ? 'entry' : undefined
}

export function declinedKindOf(outcome: ShareOutcome): { declined?: TurnedDown } {
    const kind = turnedDown(outcome)
    return kind ? { declined: kind } : {}
}

/** The index tells what became of the entry: a closed entry proposal is no ending of its own. */
const ENTRY_SAID: ReadonlySet<ShareOutcome> = new Set(['listed', 'taken-out', 'entry-revoked'])

const packageOf = (row: SharedPackageRow) => `${row.targetKey}#${row.slug}`

const highest = (versions: string[]) => versions.reduce<string | undefined>((best, version) => (!best || isNewerVersion(version, best) ? version : best), undefined)

const endedAt = (proposal: ShareProposal) => proposal.mergedAt ?? proposal.closedAt

/** A merge ends only a removal; a row without its proposals knows only its `withdrawn` flag. */
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
        // Without its proposals a row knows its "no" only from its reading, not when it came.
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
            // Maybe an unread withdrawal: never told beside a newer version.
            unsure: proposal ? mayBeWithdrawn(proposal) : false,
            ...(decline ? { declined: { decline, current: proposal ? current(proposal) : false } } : {}),
            ...(change && current(change) ? { declinedChange: declineOf(change) } : {}),
        }
    })
    const shown = (origin: InstanceMatch) => origin !== 'other'
    const onlyWhileCurrent = (entry: (typeof read)[number]) => ONLY_WHILE_CURRENT.has(entry.outcome) || entryUsedUp(entry.outcome, entry.row)
    const tabOf = (entry: (typeof read)[number]) => (onlyWhileCurrent(entry) && !entry.declined?.current ? undefined : TAB_OF[entry.outcome])

    const byPackage = new Map<string, typeof read>()
    for (const entry of read) byPackage.set(packageOf(entry.row), [...(byPackage.get(packageOf(entry.row)) ?? []), entry])
    const tabRow = (entry: (typeof read)[number]): TabRow => {
        const family = byPackage.get(packageOf(entry.row)) ?? []
        const below = (outcomes: ReadonlySet<ShareOutcome>, also: (other: (typeof read)[number]) => boolean = () => true) =>
            family
                .filter((other) => outcomes.has(other.outcome) && !other.unsure && also(other) && isNewerVersion(entry.row.version, other.row.version))
                .map((other) => other.row.version)
                .sort((a, b) => (isNewerVersion(a, b) ? 1 : isNewerVersion(b, a) ? -1 : 0))
        const earlier = below(REPLACED)
        // An entry the team made by hand is no share of this one.
        const listedEarlier = below(REPLACED, (other) => proposalsOf(other.row).some((proposal) => proposal.kind === 'catalog' && proposal.state === 'merged'))
        // Not a maybe-withdrawal („nicht angenommen“ would be a guess), nor another instance's.
        const declinedEarlier = family
            .filter((other) => turnedDown(other.outcome) && !other.unsure && shown(other.origin) && isNewerVersion(entry.row.version, other.row.version))
            .sort((a, b) => (isNewerVersion(a.row.version, b.row.version) ? 1 : isNewerVersion(b.row.version, a.row.version) ? -1 : 0))
            .map((other) => ({ version: other.row.version, kind: turnedDown(other.outcome) as TurnedDown }))
        // Only to a row „In Arbeit“ lists: another instance's would be a link to nowhere.
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
            listedEarlier,
            ...(newer ? { newer: { key: newer.row.key, version: newer.row.version, ...declinedKindOf(newer.outcome) } } : {}),
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
            if (ENTRY_SAID.has(outcome) && proposal.kind === 'catalog' && ending === 'not-accepted') continue
            // Two proposals on one branch may come from two instances.
            const own = proposal.source?.instance ? instanceMatch(proposal.source, instance) : origin
            const at = endedAt(proposal)
            end({ key: `${row.key}#${proposal.kind}!${proposal.iid}`, ending, what: proposal.kind, row, version: row.version, proposal, ...(at ? { at } : {}), origin: own })
        }
        if (outcome === 'gone') end({ key: `${row.key}#gone`, ending: 'removed', what: 'version', row, version: row.version, byHand: true, origin })
    }
    // One „taken out“ entry per package, at the newest version taken out.
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
    // Stable sort: the listing's order among equals, undated last.
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
            published: published.length,
        },
    }
}
