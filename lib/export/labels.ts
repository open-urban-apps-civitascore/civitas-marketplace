import type { BundleVerification } from '@/lib/export/status'

// Imported by client components: keep it free of server code.

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
