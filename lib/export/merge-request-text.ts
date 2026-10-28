import type { MergeRequestNote, MergeRequestRef } from '@/lib/export/gitlab'

// Reads back what the marketplace writes into its merge requests: change both sides together.

const DRAFT_PREFIX = /^\s*(?:draft:|\[draft\]|\(draft\))\s*/i

/** Also behind a "Draft: " a reviewer may set. */
export function displayNameOf(title: string | undefined, version: string): string | undefined {
    const match = title?.replace(DRAFT_PREFIX, '').match(/^Export use case: (.+) (\d+\.\d+\.\d+)$/)
    return match && match[2] === version ? match[1] : undefined
}

/** The domain the parts were re-identified in; the manifest keeps it only inside the URNs. */
export function domainOf(description: string | null | undefined): string | undefined {
    return description?.match(/^Publisher `[a-z0-9]+`, domain `([a-z0-9]{2,40})`$/m)?.[1]
}

/** Undefined also for "unbekannt", the fallback of `proposerName`. */
export function proposerOf(description: string | null | undefined): string | undefined {
    const name = description?.match(/^Proposed by the Open Urban Apps marketplace on behalf of \*\*(.+?)\*\*\./m)?.[1]?.trim()
    return name && name !== 'unbekannt' ? name : undefined
}

/** Reads the note `withdrawalNote` in share-deletion.ts writes. */
export function withdrawerOf(body: string | null | undefined): string | undefined {
    const name = body?.match(/^Withdrawn through the Open Urban Apps marketplace on behalf of \*\*(.+?)\*\*\./m)?.[1]?.trim()
    return name || undefined
}

/** Mark and close come in one request, but two clocks set their times. */
export const MARK_WINDOW_MS = 2 * 60_000

/** The old withdrawal note followed the close as a request of its own. */
export const NOTE_WINDOW_MS = 10 * 60_000

/** Written by the closing request itself, unlike the note, which can fail quietly afterwards. */
export function withdrawalMark(by: string, at: Date): string {
    return `Withdrawn through the Open Urban Apps marketplace on behalf of **${by}** at ${at.toISOString()}.`
}

const MARK_LINE = /^Withdrawn through the Open Urban Apps marketplace on behalf of \*\*(.+?)\*\* at (\S+)\.\r?$/gm

function timeOf(iso: string | null | undefined): number | undefined {
    const time = iso ? Date.parse(iso) : NaN
    return Number.isNaN(time) ? undefined : time
}

/** Only near `closedAt`: a request reopened and closed again by someone else keeps the old mark. */
export function withdrawalMarkIn(description: string | null | undefined, closedAt: string | null | undefined): string | undefined {
    const closed = timeOf(closedAt)
    if (closed === undefined || !description) return undefined
    for (const [, by, at] of [...description.matchAll(MARK_LINE)].reverse()) {
        const time = timeOf(at)
        if (time !== undefined && Math.abs(time - closed) <= MARK_WINDOW_MS && by.trim()) return by.trim()
    }
    return undefined
}

/** The last reopen before the close, else the creation. */
function openedAt(mr: Pick<MergeRequestRef, 'created_at' | 'closed_at'>, notes: readonly MergeRequestNote[]): number | undefined {
    const closed = timeOf(mr.closed_at)
    const reopens = notes
        .filter((note) => note.system && /^reopened\b/i.test(note.body.trim()))
        .map((note) => timeOf(note.created_at))
        .filter((time): time is number => time !== undefined && (closed === undefined || time <= closed))
    return reopens.length ? Math.max(...reopens) : timeOf(mr.created_at)
}

/** The note of older withdrawals; only after the last reopen, so it cannot claim a later close. */
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

/** `unreadable` says nothing about the catalogue team. */
export type DeclineReason = { kind: 'given'; text: string } | { kind: 'none' } | { kind: 'unreadable' }

export const REASON_MAX = 300

export function isMarketplaceLine(body: string): boolean {
    return /^\s*(?:Proposed by|Withdrawn through) the Open Urban Apps marketplace\b/.test(body)
}

function plainReason(body: string): string {
    const text = body.replace(/\s+/g, ' ').trim()
    const characters = Array.from(text)
    return characters.length <= REASON_MAX ? text : `${characters.slice(0, REASON_MAX - 1).join('').trimEnd()}…`
}

export function declineReasonOf(
    mr: Pick<MergeRequestRef, 'created_at' | 'closed_at' | 'closed_by'>,
    notes: readonly MergeRequestNote[],
): DeclineReason {
    const closer = mr.closed_by
    if (!closer) return { kind: 'none' }
    const closed = timeOf(mr.closed_at)
    const since = openedAt(mr, notes)
    const byCloser = (author: MergeRequestNote['author']) =>
        Boolean(author) && (author?.id !== undefined && closer.id !== undefined ? author.id === closer.id : Boolean(closer.username) && author?.username === closer.username)
    const said = notes
        .filter((note) => !note.system && byCloser(note.author) && !isMarketplaceLine(note.body) && note.body.trim())
        .map((note) => ({ note, at: timeOf(note.created_at) }))
        .filter(({ at }) => at !== undefined && (since === undefined || at >= since) && (closed === undefined || at <= closed + NOTE_WINDOW_MS))
        .sort((a, b) => (b.at as number) - (a.at as number))
    return said.length ? { kind: 'given', text: plainReason(said[0].note.body) } : { kind: 'none' }
}

/** By display name, case aside: two people of the same name count as one. */
export function proposedByOther(proposedBy: string | undefined, person: string | undefined): boolean {
    return Boolean(proposedBy && person && proposedBy.trim().toLowerCase() !== person.trim().toLowerCase())
}

/** Never guessed from a name: several instances share one GitLab account and one package id. */
export interface ShareSource {
    kind: 'dataset'
    id?: string
    instance?: string
}

const SOURCE_LINE = /^<!-- oua-share (\{.*\}) -->$/m

/** A hidden HTML comment; `<` and `>` are escaped so no value can end it early. */
export function shareSourceLine(source: ShareSource): string {
    const fields = { kind: source.kind, ...(source.id ? { id: source.id } : {}), ...(source.instance ? { instance: source.instance } : {}) }
    return `<!-- oua-share ${JSON.stringify(fields).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')} -->`
}

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

/** For shares without a source line: parses the sentence `readme` in transform.ts writes. */
export function readmeSourceOf(readme: string | undefined): ShareSource | undefined {
    const match = readme?.match(/^\(dataset `[^`\n]*`, id `([^`\n]+)`(?:, instance ([^\s)]+))?\)\.$/m)
    if (!match) return undefined
    return { kind: 'dataset', id: match[1], ...(match[2] ? { instance: match[2] } : {}) }
}

/** From the sentence `proposeCatalog` writes; the catalogue's branch names no repository. */
export function catalogPinOf(description: string | null | undefined): { repo: string; path: string } | undefined {
    const match = description?.match(/pinned to\s+`[0-9a-f]+` of (\S+) \(path `([^`]+)`\)/)
    return match ? { repo: match[1], path: match[2] } : undefined
}
