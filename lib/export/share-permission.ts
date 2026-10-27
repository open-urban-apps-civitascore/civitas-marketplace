import { fetchMe } from '@/lib/me'
import { hasTenantPermission } from '@/lib/permissions'

/**
 * Who may have the marketplace's GitLab account propose a package. Every
 * signed-in person may preview; the merge requests carry the instance's name
 * into a public repository, so only those who build use cases may open them.
 *
 * `GET /v1/users/me` names no role, only permissions, so the rule is written in
 * permissions: create data structures and change datasets across the tenant.
 * With the default roles that is Data Owner, Data Architect and Data Steward;
 * Data Consumer, Data Gatekeeper and Tenant Admin may preview only.
 */
export const SHARE_PERMISSIONS = ['DATASTRUCTURE_CREATE', 'DATASET_UPDATE'] as const

export function mayShare(me: unknown): boolean {
    return SHARE_PERMISSIONS.every((permission) => hasTenantPermission(me, permission))
}

/** 'unknown' when the platform cannot be asked; the bot then proposes nothing either. */
export type ShareRight = 'allowed' | 'refused' | 'unknown'

/** `accessToken` for a route handler, which checks the session without a redirect; pages and actions leave it out. */
export async function fetchShareRight(accessToken?: string): Promise<ShareRight> {
    const me = await fetchMe(accessToken)
    if (me === undefined) return 'unknown'
    return mayShare(me) ? 'allowed' : 'refused'
}

/** Why this person may not submit (have the bot open merge requests), or undefined when they may. */
export function shareRefusal(right: ShareRight): string | undefined {
    if (right === 'refused') {
        return (
            'Einreichen darf hier nur, wer auf dieser Instanz Datenstrukturen anlegen und Datensätze bearbeiten darf, ' +
            'zum Beispiel Data Owner, Data Architect oder Data Steward. Die Vorschau steht allen offen.'
        )
    }
    if (right === 'unknown') {
        return 'Deine Berechtigung zum Teilen konnte nicht geprüft werden, weil das Portal-Backend nicht antwortet. Die Vorschau funktioniert trotzdem.'
    }
    return undefined
}

/** The share routes' answer where the session is gone or its token cannot be renewed. */
export const SIGNED_OUT = 'Deine Anmeldung ist abgelaufen - bitte lade die Seite neu und melde dich wieder an.'

/**
 * Why what was submitted stays hidden from this person, in the words of the
 * pages that list it (and of `GET /api/shares`). The share page's refusal
 * texts end with a remark about its preview, which those do not have.
 */
export const LISTING_HIDDEN_BECAUSE: Record<Exclude<ShareRight, 'allowed'>, string> = {
    refused:
        'Was eingereicht ist, sehen nur Personen, die auf dieser Instanz Datenstrukturen anlegen und Datensätze bearbeiten dürfen, zum Beispiel Data Owner, Data Architect oder Data Steward.',
    unknown: 'Deine Berechtigung konnte nicht geprüft werden, weil das Portal-Backend nicht antwortet. Bitte lade die Seite später neu.',
}

/**
 * The name a proposal is made on behalf of. Never the e-mail address: it would
 * be published in a public merge request and in the package README.
 */
export function proposerName(user: { name?: string | null } | undefined): string {
    return user?.name?.trim() || 'unbekannt'
}
