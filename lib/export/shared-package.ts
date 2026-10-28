import { declinedProposal, mayBeWithdrawn } from '@/lib/export/declines'
import type { ShareProposal, SharedPackageRow } from '@/lib/export/share-listing'
import { isNewerVersion } from '@/lib/export/share-stages'
import { instanceMatch, rowOutcome, type ShareOutcome } from '@/lib/export/share-tabs'

// Kept light, so „Beendet“ needs none of the wizard's catalogue and form code.

export interface VersionFact {
    version: string
    row: SharedPackageRow
    outcome: ShareOutcome
}

/** Every version, highest first, from any instance: a number counts wherever it was shared from. */
export interface SharedPackage {
    targetKey: string
    slug: string
    versions: VersionFact[]
}

/** By name only among this instance's shares unless `anyInstance`: a name alone never claims another's. */
export interface PackageMatch {
    datasetId?: string
    slug?: string
    targetKey?: string
    anyInstance?: boolean
}

export const higherFirst = (a: { version: string }, b: { version: string }) => (isNewerVersion(a.version, b.version) ? -1 : isNewerVersion(b.version, a.version) ? 1 : 0)

const lastProposed = (row: SharedPackageRow) => Math.max(0, ...(row.proposals ?? []).map((proposal) => Date.parse(proposal.createdAt ?? '') || 0))

/** Of two packages a dataset was shared as, the one proposed last. */
export function sharedPackageOf(rows: readonly SharedPackageRow[], match: PackageMatch, instance?: string): SharedPackage | undefined {
    const slug = match.slug?.trim().toLowerCase()
    const notElsewhere = (row: SharedPackageRow) => instanceMatch(row.source, instance) !== 'other'
    const byDataset = match.datasetId ? rows.filter((row) => row.source?.id === match.datasetId && notElsewhere(row)) : []
    const bySlug = slug
        ? rows.filter((row) => row.slug === slug && (!match.targetKey || row.targetKey === match.targetKey) && (match.anyInstance || notElsewhere(row)))
        : []
    const found = byDataset.length ? byDataset : bySlug
    if (!found.length) return undefined
    const newest = found.reduce((best, row) => (lastProposed(row) > lastProposed(best) ? row : best))
    const versions = rows
        .filter((row) => row.targetKey === newest.targetKey && row.slug === newest.slug)
        .map((row) => ({ version: row.version, row, outcome: rowOutcome(row) }))
        .sort(higherFirst)
    return { targetKey: newest.targetKey, slug: newest.slug, versions }
}

/** The number may be proposed again: nothing about it was decided, or it left before the catalogue. */
const NOT_USED_UP: ReadonlySet<ShareOutcome> = new Set(['withdrawn', 'removed', 'gone'])

const UNDECIDED: ReadonlySet<ShareOutcome> = new Set(['withdrawn', 'removed', 'gone', 'unreadable'])

function entryNoOf(row: SharedPackageRow): ShareProposal | undefined {
    const turnedDown = declinedProposal(row.proposals ?? [], 'catalog')
    return turnedDown && !mayBeWithdrawn(turnedDown) ? turnedDown : undefined
}

/** Used up even after leaving the repository: a removal starts the package over, not its entry. */
function entryDecided(row: SharedPackageRow): boolean {
    const listedOnce = (row.proposals ?? []).some((proposal) => proposal.kind === 'catalog' && proposal.state === 'merged')
    return listedOnce || row.catalog?.state === 'declined' || entryNoOf(row) !== undefined
}

/** An unreadable version counts too: a suggestion above it is free either way. */
export function usedVersions(pkg: SharedPackage): string[] {
    const proposed = pkg.versions.filter((fact) => !NOT_USED_UP.has(fact.outcome) || entryDecided(fact.row)).map((fact) => fact.version)
    const takenOut = pkg.versions.flatMap((fact) => (fact.row.catalog?.takenOut ? [fact.row.catalog.takenOut.version] : []))
    return [...new Set([...proposed, ...takenOut])]
}

export function sameVersionAgain(pkg: SharedPackage | undefined, version: string): boolean {
    const fact = pkg?.versions.find((one) => one.version === version)
    return Boolean(pkg && fact && NOT_USED_UP.has(fact.outcome) && !usedVersions(pkg).includes(version))
}

/** For what was taken out every instance's version counts: the catalogue has one entry. */
export function lastDecided(pkg: SharedPackage | undefined, skip: (fact: VersionFact) => boolean = () => false): VersionFact | undefined {
    return pkg?.versions.find((fact) => !skip(fact) && (!UNDECIDED.has(fact.outcome) || (fact.outcome !== 'unreadable' && entryDecided(fact.row))))
}
