import type { CatalogSummary } from '@/lib/catalog/types'
import type { DatasetListing } from '@/lib/export/portal-reader'
import { exportMetadataSchema, type ExportMetadata } from '@/lib/export/metadata'

export interface ExportInstallation {
    dataSetId?: string
    catalogEntryId?: string
    catalogEntryVersion?: string
    uninstalledAt?: string | null
}
export interface ExportSource extends DatasetListing {
    catalog?: { id: string; displayName: string; description: string; version: string; maintainer: string; license: string; keywords: string[]; metadata: ExportMetadata }
    notice?: string
}
/**
 * Only readable local datasets become choices. Names are never used as provenance.
 *
 * What is prefilled, and what deliberately is not. An installed use case's
 * catalogue row describes the PACKAGE (name, description, licence, keywords,
 * subject areas) and also somebody else's DEPLOYMENT of it — who operates it,
 * what it cost them, who to contact there, screenshots of their dashboard.
 *
 * Only the first group is carried over; the second is simply left empty. No
 * notice asks the author to correct it, because there is nothing to correct —
 * prefilling it and then warning about it would put another municipality's
 * operator, cost bands, funding line and named contact into a form whose output
 * is a public, git-mirrored catalogue row, and a warning read once at selection
 * is not consent from the people named in it. Decision D12's line: supplied is
 * not copied.
 */
export function exportSources(datasets: DatasetListing[], installations: ExportInstallation[], catalog: CatalogSummary[]): ExportSource[] {
    return datasets.map((dataset) => {
        const matches = installations.filter((row) => row.dataSetId === dataset.id && !row.uninstalledAt && row.catalogEntryId)
        const ids = new Set(matches.map((row) => row.catalogEntryId))
        if (ids.size > 1) return { ...dataset, notice: 'Mehrere Katalogzuordnungen: bitte die Angaben selbst ergänzen.' }
        const entry = catalog.find((row) => ids.has(row.id) && !row.revoked)
        if (!entry) return { ...dataset, ...(matches.length ? { notice: 'Der ursprüngliche Katalogeintrag ist nicht verfügbar.' } : {}) }
        const { id, displayName, description, version, maintainer, license, keywords, themes } = entry
        return { ...dataset, catalog: { id, displayName, description, version, maintainer, license, keywords,
            // `contact`, `media` and `implementation` are the previous operator's
            // own account of their deployment and start empty — see above.
            metadata: exportMetadataSchema.parse({ themes }),
        }, notice: 'Paketangaben aus dem Katalog vorbelegt.' }
    })
}
