import type { BundledDashboard } from '@/lib/catalog/types'
import { dashboardTitle, readDashboardDocument } from '@/lib/superset/bundle'
import { dashboardUrl, supersetPublicUrl } from '@/lib/superset/client'

/**
 * The dashboards of an installed use case, as the platform keeps them.
 *
 * The platform owns them. The install hands each packaged dashboard to it as a
 * dashboard of the installed dataset, with the member's Superset export as its
 * bundle. The platform's saga then creates the dashboard in Superset and
 * imports the bundle once, bound to the dataset. So the marketplace never
 * writes to Superset and needs no account there: its only Superset setting is
 * the public address, for links.
 */

/** Longest name the platform accepts for a visualization. */
const NAME_MAX = 255

/** One page holds every dashboard of a dataset. */
const PAGE_SIZE = 100

/** The body of `POST /v1/datasets/{id}/visualizations` for one packaged dashboard. */
export interface DashboardCreation {
    visualizationType: 'DASHBOARD'
    name: string
    /** Published in Superset, or a draft there. */
    released: boolean
    /** The member's export as it is: each file path without the root folder, mapped to the parsed file. */
    supersetBundle: Record<string, Record<string, unknown>>
}

/**
 * The platform request for one dashboard member. The bundle goes unchanged:
 * the platform binds it to the dataset and to its own database connection.
 * Throws a DashboardDocumentError for a member that is no dashboard export,
 * before anything reaches the platform.
 */
export function dashboardCreation(dashboard: BundledDashboard, released: boolean): DashboardCreation {
    const document = readDashboardDocument(dashboard.content, dashboard.file)
    return {
        visualizationType: 'DASHBOARD',
        name: (dashboardTitle(document) ?? dashboard.file).slice(0, NAME_MAX),
        released,
        supersetBundle: document.files,
    }
}

export interface InstalledDashboardLink {
    /** The platform's id of the dashboard. */
    id: string
    title: string
    /** Published in Superset, not a draft. */
    released: boolean
    /** Superset's id, once the platform's saga has created the dashboard there. */
    externalId?: string
    /** Its address in Superset. Needs the external id and SUPERSET_PUBLIC_URL. */
    url?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function idOf(value: unknown): string | undefined {
    if (typeof value === 'number') return String(value)
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * The dashboards among the visualizations of a dataset. One that Superset no
 * longer serves (`active: false`) keeps its line but loses its link.
 */
export function dashboardLinks(rows: unknown[], publicUrl: string | undefined): InstalledDashboardLink[] {
    return rows.flatMap((row): InstalledDashboardLink[] => {
        if (!isRecord(row) || row.visualizationType !== 'DASHBOARD') return []
        const id = idOf(row.id)
        if (!id) return []
        const externalId = row.active === false ? undefined : idOf(row.externalDashboardId)
        return [
            {
                id,
                title: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Dashboard',
                released: row.released === true,
                ...(externalId ? { externalId } : {}),
                ...(externalId && publicUrl ? { url: dashboardUrl(publicUrl, externalId) } : {}),
            },
        ]
    })
}

/**
 * The dashboards of an installation's dataset, read from the platform with the
 * user's token. Every dashboard of the dataset counts, also one a user added
 * in the portal later: they all show the installation's data.
 *
 * Empty without a dataset or when the platform cannot be read: the page then
 * shows no section rather than no page.
 */
export async function fetchInstalledDashboards(
    dataSetId: string | undefined,
    accessToken: string,
): Promise<InstalledDashboardLink[]> {
    if (!dataSetId) return []
    try {
        const response = await fetch(
            `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/datasets/${encodeURIComponent(dataSetId)}/visualizations?size=${PAGE_SIZE}`,
            { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' },
        )
        if (!response.ok) return []
        const page = (await response.json()) as { content?: unknown[] }
        return dashboardLinks(page.content ?? [], supersetPublicUrl())
    } catch {
        return []
    }
}
