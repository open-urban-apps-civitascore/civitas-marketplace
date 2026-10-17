import type { BundleVerification, CatalogStatus } from '@/lib/export/status'

/** How the export pages name the states of a share. Pure, for client components. */

export function verificationLabel(verification: BundleVerification): string {
    switch (verification.state) {
        case 'verified':
            return verification.changedInReview ? 'gemergter Stand, im Review geändert' : 'gemergter Stand'
        case 'changed-after-merge':
            return 'nach dem Merge geändert'
        case 'no-merge-request':
            return 'kein Export-Merge-Request'
        default:
            return 'nicht prüfbar'
    }
}

export function mergeRequestStateLabel(state: string): string {
    return state === 'opened' ? 'MR offen' : state === 'merged' ? 'gemergt' : state === 'closed' ? 'geschlossen' : state
}

export function catalogStateLabel(state: CatalogStatus['state']): string {
    return state === 'listed'
        ? 'gelistet'
        : state === 'mr-open'
          ? 'MR offen'
          : state === 'unconfigured'
            ? 'nicht konfiguriert'
            : 'nicht gelistet'
}
