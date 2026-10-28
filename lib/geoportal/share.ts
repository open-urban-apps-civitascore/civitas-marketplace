import { resolveCatalogEntry } from '@/lib/catalog/source'
import { isDataStructureEntry } from '@/lib/catalog/types'
import { extractMasterportalFromDir, geoportalConfigDir } from '@/lib/geoportal/files'
import { MasterportalMemberError, readMasterportalMember, type MasterportalMember } from '@/lib/geoportal/merge'
import { installedDataSet, type DataSetLine } from '@/lib/installation-dataset'
import { readAllInstallations } from '@/lib/installation-list'

/** The Masterportal member a share takes along, where it came from, and what the preview should say about it. */
export interface SharedMasterportal {
    member?: MasterportalMember
    /** The geoportal's files (what this instance shows now) or the package the dataset was installed from. */
    source?: 'geoportal' | 'catalog'
    warnings: string[]
}

interface InstallationRow {
    packageId?: string
    uninstalledAt?: string | null
    artifacts?: DataSetLine[]
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The Masterportal member for a share of one dataset. First what the geoportal shows for it, read
 * back from its files (extract.ts): that is the operator's configuration as it is now, changes
 * included. Without entries there, the member of the package the dataset was installed from, as it
 * came. Neither is a reason to stop the share: most datasets have no map in the geoportal, and a
 * member that cannot be read is named in the preview instead.
 */
export async function masterportalForShare(datasetId: string, accessToken: string): Promise<SharedMasterportal> {
    const warnings: string[] = []
    const dir = geoportalConfigDir()
    if (dir) {
        try {
            const extracted = await extractMasterportalFromDir(dir, datasetId)
            if (extracted) return { member: extracted.member, source: 'geoportal', warnings: extracted.warnings }
        } catch (error) {
            if (!(error instanceof MasterportalMemberError)) throw error
            warnings.push(`Geoportal: Die Einträge des Datensatzes kommen nicht ins Paket (${error.message}).`)
        }
    }
    try {
        const member = await installedPackageMember(datasetId, accessToken)
        return member ? { member, source: 'catalog', warnings } : { warnings }
    } catch (error) {
        warnings.push(`Geoportal: Die Einträge aus dem Katalogeintrag kommen nicht ins Paket (${reason(error)}).`)
        return { warnings }
    }
}

/** The member of the package an active installation made this dataset from; undefined for a dataset made here. */
async function installedPackageMember(datasetId: string, accessToken: string): Promise<MasterportalMember | undefined> {
    const list = await readAllInstallations<InstallationRow>(accessToken)
    if (!list.ok) return undefined
    const row = list.rows.find((candidate) => !candidate.uninstalledAt && installedDataSet(candidate.artifacts).id === datasetId)
    if (!row?.packageId) return undefined
    const entry = await resolveCatalogEntry(row.packageId)
    const document = entry && !isDataStructureEntry(entry) ? entry.bundle.masterportal?.[0] : undefined
    return document ? readMasterportalMember(document.document, document.file) : undefined
}
