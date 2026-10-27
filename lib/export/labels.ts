import type { BundleVerification } from '@/lib/export/status'

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
