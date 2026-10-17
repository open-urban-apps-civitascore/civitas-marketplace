import { getCatalogSummary, resolveCatalogEntry } from '@/lib/catalog/source'
import { isDataStructureEntry } from '@/lib/catalog/types'
import { readDashboardDocument, type SupersetDashboardDocument } from '@/lib/superset/bundle'
import { dashboardUrl, supersetPublicUrl } from '@/lib/superset/client'
import { installedDashboardIdentity } from '@/lib/superset/rebind'

export interface InstalledDashboardLink {
    title: string
    url: string
    /** The slug the import gave the dashboard; the uninstall finds it by this. */
    slug: string
}

/**
 * The dashboard documents of a package, by its pin. A pin is a commit SHA, so
 * the content it names never changes, and the detail page does not have to
 * fetch the whole package again on every view.
 */
const documentsByPin = new Map<string, { file: string; document: SupersetDashboardDocument }[]>()

async function dashboardDocuments(entryId: string) {
    const pin = (await getCatalogSummary(entryId))?.deploymentRef?.ref
    const key = pin ? `${entryId}@${pin}` : undefined
    const cached = key ? documentsByPin.get(key) : undefined
    if (cached) return cached

    const entry = await resolveCatalogEntry(entryId)
    if (!entry || isDataStructureEntry(entry)) return []
    const documents = (entry.bundle.dashboards ?? []).flatMap((dashboard) => {
        try {
            return [{ file: dashboard.file, document: readDashboardDocument(dashboard.content) }]
        } catch {
            return []
        }
    })
    if (key) documentsByPin.set(key, documents)
    return documents
}

/**
 * The dashboards an installation brought, each with its link into Superset.
 *
 * Computed, not stored: the import derives a dashboard's slug from the package
 * and the installation id, so the same derivation finds it again. The package
 * is the one in the catalogue now; a dashboard renamed in a later package
 * version would get a link the older installation does not have.
 *
 * Empty when no Superset address is configured, when the entry brings no
 * dashboard, or when the package cannot be read: the page then shows no
 * section rather than no page. A dashboard whose import failed still gets its
 * link; checking each one would cost a Superset login per page view.
 */
export async function fetchInstalledDashboards(
    entryId: string,
    installationId: string,
): Promise<InstalledDashboardLink[]> {
    const publicUrl = supersetPublicUrl()
    if (!publicUrl) return []
    try {
        return (await dashboardDocuments(entryId)).flatMap(({ file, document }) => {
            try {
                const identity = installedDashboardIdentity(document, installationId)
                return [
                    { title: identity.title ?? file, url: dashboardUrl(publicUrl, identity.slug), slug: identity.slug },
                ]
            } catch {
                return []
            }
        })
    } catch {
        return []
    }
}
