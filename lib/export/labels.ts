import type { BundleVerification, CatalogStatus } from '@/lib/export/status'

/** How the export pages name the states of a share. Pure, for client components. */

export function verificationLabel(verification: BundleVerification): string {
    switch (verification.state) {
        case 'verified':
            return verification.changedInReview ? 'wie geprüft, in der Prüfung geändert' : 'wie geprüft'
        case 'changed-after-merge':
            return 'nach der Prüfung geändert'
        case 'no-merge-request':
            return 'nicht über diesen Marktplatz geteilt'
        default:
            return 'nicht prüfbar'
    }
}

export function mergeRequestStateLabel(state: string): string {
    return state === 'opened' ? 'in Prüfung' : state === 'merged' ? 'angenommen' : state === 'closed' ? 'nicht angenommen' : state
}

export function catalogStateLabel(state: CatalogStatus['state']): string {
    return state === 'listed'
        ? 'im Katalog'
        : state === 'mr-open'
          ? 'Eintrag in Prüfung'
          : state === 'unconfigured'
            ? 'Katalog nicht eingerichtet'
            : state === 'withdrawn'
              ? 'aus dem Katalog genommen'
              : 'noch nicht im Katalog'
}
