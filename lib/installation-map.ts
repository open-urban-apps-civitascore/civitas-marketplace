import { resolveCatalogEntry } from '@/lib/catalog/source'
import { isDataStructureEntry } from '@/lib/catalog/types'
import { readAllInstallations } from '@/lib/installation-list'
import { getAccessToken } from '@/lib/session'

/**
 * The map an installed use case publishes, for the map page: its OWS API and
 * the layer on it, taken from the package. Works for catalogue packages (the
 * Kiez-Baumkataster) and generated ones alike, since both resolve through
 * resolveCatalogEntry.
 */

export interface BoundingBox {
    minX: number
    minY: number
    maxX: number
    maxY: number
}

export interface PackageMap {
    apiSlug: string
    layerName: string
    layerTitle: string
    bbox: BoundingBox | null
}

export interface InstallationMap extends PackageMap {
    installationId: string
    datasetId: string
    title: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boxOf(value: unknown): BoundingBox | null {
    if (!isRecord(value)) return null
    const { minX, minY, maxX, maxY } = value
    return [minX, minY, maxX, maxY].every((part) => typeof part === 'number')
        ? { minX: minX as number, minY: minY as number, maxX: maxX as number, maxY: maxY as number }
        : null
}

/** The package's first OWS API and first layer; null when it has none or cannot be read. */
export async function packageMapOf(packageId: string): Promise<PackageMap | null> {
    try {
        const entry = await resolveCatalogEntry(packageId)
        if (!entry || isDataStructureEntry(entry)) return null
        const api = (entry.bundle.apis ?? []).find(
            ({ document }) => document.standard === 'OWS' && typeof document.slug === 'string',
        )
        const layer = (entry.bundle.layers ?? []).find(({ document }) => typeof document.layerName === 'string')
        if (!api || !layer) return null
        const layerName = layer.document.layerName as string
        return {
            apiSlug: api.document.slug as string,
            layerName,
            layerTitle: typeof layer.document.title === 'string' ? layer.document.title : layerName,
            bbox: boxOf(layer.document.latLonBoundingBox),
        }
    } catch {
        return null
    }
}

interface InstallationRow {
    id: string
    packageId?: string
    uninstalledAt?: string | null
    dataSetId?: string
    dataSetName?: string
}

/** Null when the installation is unknown, uninstalled, has no dataset, or publishes no map. */
export async function loadInstallationMap(installationId: string): Promise<InstallationMap | null> {
    const list = await readAllInstallations<InstallationRow>(await getAccessToken())
    if (!list.ok) return null
    const row = list.rows.find((candidate) => candidate.id === installationId && !candidate.uninstalledAt)
    if (!row?.dataSetId || !row.packageId) return null
    const map = await packageMapOf(row.packageId)
    if (!map) return null
    return { ...map, installationId: row.id, datasetId: row.dataSetId, title: row.dataSetName ?? map.layerTitle }
}

/** The map page of an installation. */
export function installationMapHref(installationId: string): string {
    return `/karte/${encodeURIComponent(installationId)}`
}
