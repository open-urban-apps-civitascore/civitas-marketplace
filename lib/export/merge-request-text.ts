import type { MergeRequestNote, MergeRequestRef } from '@/lib/export/gitlab'

/**
 * What the marketplace's own merge requests say about themselves, read back:
 * the titles and descriptions are written by `exportAction`, so the list of
 * shared packages can take names from them instead of asking GitLab for more.
 *
 * And how one of them ended when it was closed without a merge: withdrawn
 * through the marketplace, or a "no" from the catalogue team. Pure;
 * `readClosing` in gitlab.ts reads what these need.
 */

/** GitLab's draft markers in a title, any case: a reviewer may set one. */
const DRAFT_PREFIX = /^\s*(?:draft:|\[draft\]|\(draft\))\s*/i

/** The display name inside an export request's title ("Export use case: <name> <version>"), also behind a "Draft: ". */
export function displayNameOf(title: string | undefined, version: string): string | undefined {
    const match = title?.replace(DRAFT_PREFIX, '').match(/^Export use case: (.+) (\d+\.\d+\.\d+)$/)
    return match && match[2] === version ? match[1] : undefined
}

/** Who a request was proposed for, from its first line; undefined when it does not name anyone. */
export function proposerOf(description: string | null | undefined): string | undefined {
    const name = description?.match(/^Proposed by the Open Urban Apps marketplace on behalf of \*\*(.+?)\*\*\./m)?.[1]?.trim()
    return name && name !== 'unbekannt' ? name : undefined
}

/**
 * Whom a withdrawal was made for, from the note the marketplace leaves on a
 * merge request it closes (`withdrawalNote` in share-deletion.ts); undefined
 * for any other comment. The bot account is also used by hand, so a request
 * it closed counts as withdrawn only with this note - or with the mark its
 * close writes ({@link withdrawalMark}).
 */
export function withdrawerOf(body: string | null | undefined): string | undefined {
    const name = body?.match(/^Withdrawn through the Open Urban Apps marketplace on behalf of \*\*(.+?)\*\*\./m)?.[1]?.trim()
    return name || undefined
}

/** How far the withdrawal mark's time may lie from the close it was written with: the same request, two clocks. */
export const MARK_WINDOW_MS = 2 * 60_000

/** How far an old withdrawal note (from before the mark) may lie from the close: it followed it, as a request of its own. */
export const NOTE_WINDOW_MS = 10 * 60_000

/**
 * The line added to a request's description by the very request that closes
 * it, so a withdrawal cannot lose it the way it lost its note (written
 * afterwards, failing quietly). The time ties it to that close.
 */
export function withdrawalMark(by: string, at: Date): string {
    return `Withdrawn through the Open Urban Apps marketplace on behalf of **${by}** at ${at.toISOString()}.`
}

const MARK_LINE = /^Withdrawn through the Open Urban Apps marketplace on behalf of \*\*(.+?)\*\* at (\S+)\.\r?$/gm

function timeOf(iso: string | null | undefined): number | undefined {
    const time = iso ? Date.parse(iso) : NaN
    return Number.isNaN(time) ? undefined : time
}

/**
 * Whom a request was withdrawn for, from its {@link withdrawalMark}. Counts only
 * within {@link MARK_WINDOW_MS} of `closedAt`: a request reopened and closed
 * again by someone else keeps the old mark.
 */
export function withdrawalMarkIn(description: string | null | undefined, closedAt: string | null | undefined): string | undefined {
    const closed = timeOf(closedAt)
    if (closed === undefined || !description) return undefined
    for (const [, by, at] of [...description.matchAll(MARK_LINE)].reverse()) {
        const time = timeOf(at)
        if (time !== undefined && Math.abs(time - closed) <= MARK_WINDOW_MS && by.trim()) return by.trim()
    }
    return undefined
}

/** When the request's last stretch of being open began: its last reopen before the close, else its creation. */
function openedAt(mr: Pick<MergeRequestRef, 'created_at' | 'closed_at'>, notes: readonly MergeRequestNote[]): number | undefined {
    const closed = timeOf(mr.closed_at)
    const reopens = notes
        .filter((note) => note.system && /^reopened\b/i.test(note.body.trim()))
        .map((note) => timeOf(note.created_at))
        .filter((time): time is number => time !== undefined && (closed === undefined || time <= closed))
    return reopens.length ? Math.max(...reopens) : timeOf(mr.created_at)
}

/**
 * Whom a request was withdrawn for, from the note withdrawals left before the
 * mark existed: within {@link NOTE_WINDOW_MS} of the close and after the last
 * reopen, so an old note does not make a later close by the team a withdrawal.
 */
export function withdrawalNoteIn(mr: Pick<MergeRequestRef, 'created_at' | 'closed_at'>, notes: readonly MergeRequestNote[]): string | undefined {
    const closed = timeOf(mr.closed_at)
    if (closed === undefined) return undefined
    const since = openedAt(mr, notes)
    for (const note of notes) {
        const by = note.system ? undefined : withdrawerOf(note.body)
        const at = timeOf(note.created_at)
        if (by && at !== undefined && Math.abs(at - closed) <= NOTE_WINDOW_MS && (since === undefined || at >= since)) return by
    }
    return undefined
}

/** What the catalogue team said when they did not take a proposal; `unreadable` (comments not readable just now) says nothing about the team. */
export type DeclineReason = { kind: 'given'; text: string } | { kind: 'none' } | { kind: 'unreadable' }

/** How much of the catalogue team's words a row shows; the rest is one link away, at the proposal. */
export const REASON_MAX = 300

/** What the marketplace itself writes on a proposal: never the catalogue team's reason, even when the shared account closed it. */
export function isMarketplaceLine(body: string): boolean {
    return /^\s*(?:Proposed by|Withdrawn through) the Open Urban Apps marketplace\b/.test(body)
}

/** One line of plain text, at most {@link REASON_MAX} characters, cut with "…". */
function plainReason(body: string): string {
    const text = body.replace(/\s+/g, ' ').trim()
    const characters = Array.from(text)
    return characters.length <= REASON_MAX ? text : `${characters.slice(0, REASON_MAX - 1).join('').trimEnd()}…`
}

/**
 * The catalogue team's reason for closing a request: the newest comment of
 * whoever closed it (not GitLab's, not the marketplace's), written after the
 * last reopen and at most {@link NOTE_WINDOW_MS} after the close.
 */
export function declineReasonOf(
    mr: Pick<MergeRequestRef, 'created_at' | 'closed_at' | 'closed_by'>,
    notes: readonly MergeRequestNote[],
): DeclineReason {
    const closer = mr.closed_by
    if (!closer) return { kind: 'none' }
    const closed = timeOf(mr.closed_at)
    const since = openedAt(mr, notes)
    // By id where both have one, else by username: the same person either way.
    const byCloser = (author: MergeRequestNote['author']) =>
        Boolean(author) && (author?.id !== undefined && closer.id !== undefined ? author.id === closer.id : Boolean(closer.username) && author?.username === closer.username)
    const said = notes
        .filter((note) => !note.system && byCloser(note.author) && !isMarketplaceLine(note.body) && note.body.trim())
        .map((note) => ({ note, at: timeOf(note.created_at) }))
        .filter(({ at }) => at !== undefined && (since === undefined || at >= since) && (closed === undefined || at <= closed + NOTE_WINDOW_MS))
        .sort((a, b) => (b.at as number) - (a.at as number))
    return said.length ? { kind: 'given', text: plainReason(said[0].note.body) } : { kind: 'none' }
}

/**
 * Whether a share was proposed for someone else than `person`: both named,
 * and not the same name. A share that names nobody counts as nobody else's.
 * Names are compared as the person sees them (display names, case aside),
 * so two people of the same name count as one (plan of 2026-10-18, risks).
 */
export function proposedByOther(proposedBy: string | undefined, person: string | undefined): boolean {
    return Boolean(proposedBy && person && proposedBy.trim().toLowerCase() !== person.trim().toLowerCase())
}

/**
 * Where a share came from: the dataset it was built from, and the instance
 * that shared it (`thisInstance`). Either may be unknown; nothing is ever
 * guessed from a name, because several instances share one GitLab account
 * and one package id.
 */
export interface ShareSource {
    kind: 'dataset'
    /** The dataset's id on the instance it came from. */
    id?: string
    instance?: string
}

const SOURCE_LINE = /^<!-- oua-share (\{.*\}) -->$/m

/**
 * The hidden line every new proposal carries (plan of 2026-10-18, section
 * 10), at the end of its description: GitLab shows nothing of an HTML
 * comment, and the listing reads it back with {@link shareSourceOf}. Angle
 * brackets in a value are escaped, so no value can end the comment early.
 */
export function shareSourceLine(source: ShareSource): string {
    const fields = { kind: source.kind, ...(source.id ? { id: source.id } : {}), ...(source.instance ? { instance: source.instance } : {}) }
    return `<!-- oua-share ${JSON.stringify(fields).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')} -->`
}

/** The source line of a proposal, read back; undefined for a proposal without one (made before rc.6, or by hand) or a garbled one. */
export function shareSourceOf(description: string | null | undefined): ShareSource | undefined {
    const raw = description?.match(SOURCE_LINE)?.[1]
    if (!raw) return undefined
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return undefined
    }
    if (!parsed || typeof parsed !== 'object') return undefined
    const { kind, id, instance } = parsed as Record<string, unknown>
    if (kind !== 'dataset') return undefined
    const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
    return { kind, ...(text(id) ? { id: text(id) } : {}), ...(text(instance) ? { instance: text(instance) } : {}) }
}

/**
 * The source of an older share, from its package README (`readme` in
 * transform.ts): "(dataset `<name>`, id `<id>`, instance <url>)." The
 * instance is there only where the exporting instance had `PORTAL_URL` set.
 * Undefined when the README says neither, or was changed beyond recognition.
 */
export function readmeSourceOf(readme: string | undefined): ShareSource | undefined {
    const match = readme?.match(/^\(dataset `[^`\n]*`, id `([^`\n]+)`(?:, instance ([^\s)]+))?\)\.$/m)
    if (!match) return undefined
    return { kind: 'dataset', id: match[1], ...(match[2] ? { instance: match[2] } : {}) }
}

/**
 * The repository and folder a catalogue proposal pins, from the sentence
 * `proposeCatalog` writes ("pinned to `<sha>` of <url> (path `<dir>`)");
 * undefined for a proposal that names none. The catalogue's branch names no
 * repository, so this is what tells two targets' packages of one name apart.
 */
export function catalogPinOf(description: string | null | undefined): { repo: string; path: string } | undefined {
    const match = description?.match(/pinned to\s+`[0-9a-f]+` of (\S+) \(path `([^`]+)`\)/)
    return match ? { repo: match[1], path: match[2] } : undefined
}
