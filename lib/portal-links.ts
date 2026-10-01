/**
 * Links into the portal frontend, where an installed use case is administered.
 * The base is `PORTAL_URL` (see `.env.example`); unset, it is the portal of the
 * dev stack.
 */

const DEFAULT_PORTAL_URL = 'http://localhost:3000'

export function portalUrl(): string {
    const configured = process.env.PORTAL_URL?.trim()
    return (configured || DEFAULT_PORTAL_URL).replace(/\/+$/, '')
}

/** The portal page of one datapool. */
export function datapoolHref(datapoolId: string): string {
    return `${portalUrl()}/datapools/${encodeURIComponent(datapoolId)}`
}
