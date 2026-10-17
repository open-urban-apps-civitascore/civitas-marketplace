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

export async function fetchShareRight(): Promise<ShareRight> {
    const me = await fetchMe()
    if (me === undefined) return 'unknown'
    return mayShare(me) ? 'allowed' : 'refused'
}

/** Why no merge request may be opened, or undefined when it may. */
export function shareRefusal(right: ShareRight): string | undefined {
    if (right === 'refused') {
        return (
            'Merge Requests darf nur anlegen, wer auf dieser Instanz Datenstrukturen anlegen und Datasets bearbeiten darf ' +
            '(z. B. Data Owner, Data Architect oder Data Steward). Die Vorschau steht allen offen.'
        )
    }
    if (right === 'unknown') {
        return 'Deine Berechtigung zum Teilen konnte nicht geprüft werden, weil das Portal-Backend nicht antwortet. Die Vorschau funktioniert trotzdem.'
    }
    return undefined
}

/**
 * The name a proposal is made on behalf of. Never the e-mail address: it would
 * be published in a public merge request and in the package README.
 */
export function proposerName(user: { name?: string | null } | undefined): string {
    return user?.name?.trim() || 'unbekannt'
}
