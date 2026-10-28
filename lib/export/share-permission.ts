import { fetchMe } from '@/lib/me'
import { hasTenantPermission } from '@/lib/permissions'

/** `/v1/users/me` names no roles. The texts below name the default roles holding both: keep in step. */
export const SHARE_PERMISSIONS = ['DATASTRUCTURE_CREATE', 'DATASET_UPDATE'] as const

export function mayShare(me: unknown): boolean {
    return SHARE_PERMISSIONS.every((permission) => hasTenantPermission(me, permission))
}

/** `unknown`: the platform could not be asked, and the bot proposes nothing either. */
export type ShareRight = 'allowed' | 'refused' | 'unknown'

/** Route handlers pass `accessToken`; pages and actions leave it out. */
export async function fetchShareRight(accessToken?: string): Promise<ShareRight> {
    const me = await fetchMe(accessToken)
    if (me === undefined) return 'unknown'
    return mayShare(me) ? 'allowed' : 'refused'
}

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

export const SIGNED_OUT = 'Deine Anmeldung ist abgelaufen - bitte lade die Seite neu und melde dich wieder an.'

/** Like `shareRefusal`, without its remark about the preview, which the listing pages lack. */
export const LISTING_HIDDEN_BECAUSE: Record<Exclude<ShareRight, 'allowed'>, string> = {
    refused:
        'Was eingereicht ist, sehen nur Personen, die auf dieser Instanz Datenstrukturen anlegen und Datensätze bearbeiten dürfen, zum Beispiel Data Owner, Data Architect oder Data Steward.',
    unknown: 'Deine Berechtigung konnte nicht geprüft werden, weil das Portal-Backend nicht antwortet. Bitte lade die Seite später neu.',
}

/** Never the e-mail address: it would be published in a public merge request. */
export function proposerName(user: { name?: string | null } | undefined): string {
    return user?.name?.trim() || 'unbekannt'
}
