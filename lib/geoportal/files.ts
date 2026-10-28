import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { extractMasterportal, type ExtractedMember } from '@/lib/geoportal/extract'
import {
    applyMasterportal,
    MasterportalMemberError,
    removeMasterportal,
    type GeoportalFiles,
    type MasterportalMember,
    type RemovedGeoportal,
} from '@/lib/geoportal/merge'

/**
 * The geoportal add-on's config files in a directory the marketplace can write: the backend's
 * input folder (`input/civitas-default` in the backend image) and the portal's `style_v3.json`
 * next to it. Local deployments only: on a cluster the files are ConfigMaps, which this does not
 * reach.
 */
export function geoportalConfigDir(): string | undefined {
    return process.env.GEOPORTAL_CONFIG_DIR?.trim() || undefined
}

/** Where people open the geoportal, for the link on the use case page. */
export function geoportalUrl(): string | undefined {
    return process.env.GEOPORTAL_URL?.trim() || undefined
}

/**
 * Where a copy of the three files goes before each change, one folder `backup-<time>` per change.
 * Unset, no copy is made. For local work, where nothing else keeps the operator's files.
 */
function geoportalBackupDir(): string | undefined {
    return process.env.GEOPORTAL_BACKUP_DIR?.trim() || undefined
}

const FILES = { services: 'service.json', config: 'config.json', styles: 'style_v3.json' } as const

async function readJson(dir: string, file: string): Promise<unknown> {
    let text: string
    try {
        text = await readFile(path.join(dir, file), 'utf8')
    } catch (error) {
        throw new MasterportalMemberError(
            `cannot read ${file} in ${dir}: ${error instanceof Error ? error.message : String(error)}`,
        )
    }
    try {
        return JSON.parse(text)
    } catch {
        throw new MasterportalMemberError(`${file} in ${dir} is not valid JSON`)
    }
}

/** The three files as they are now. */
async function readGeoportalFiles(dir: string): Promise<GeoportalFiles> {
    return {
        services: await readJson(dir, FILES.services),
        config: await readJson(dir, FILES.config),
        styles: await readJson(dir, FILES.styles),
    }
}

/**
 * In place, not as a new file renamed over the old one: the geoportal containers mount these files
 * one by one, and a single-file mount keeps the file it was given at start.
 */
async function writeJson(dir: string, file: string, value: unknown): Promise<void> {
    await writeFile(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** Copies the three files aside before a change, when a backup folder is set. No copy, no change. */
async function backUp(dir: string): Promise<void> {
    const root = geoportalBackupDir()
    if (!root) return
    const target = path.join(root, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    try {
        await mkdir(target, { recursive: true })
        for (const file of Object.values(FILES)) await copyFile(path.join(dir, file), path.join(target, file))
    } catch (error) {
        throw new MasterportalMemberError(
            `no backup in ${target}, so nothing changed: ${error instanceof Error ? error.message : String(error)}`,
        )
    }
}

/**
 * Writes the member into the three files for one dataset. Styles first and the layer tree last,
 * so the tree never names a service that is not written yet.
 */
export async function applyMasterportalToDir(
    dir: string,
    member: MasterportalMember,
    datasetId: string,
): Promise<{ stylesChanged: boolean }> {
    const applied = applyMasterportal(await readGeoportalFiles(dir), member, datasetId)
    await backUp(dir)
    await writeJson(dir, FILES.styles, applied.styles)
    await writeJson(dir, FILES.services, applied.services)
    await writeJson(dir, FILES.config, applied.config)
    return { stylesChanged: applied.stylesChanged }
}

/** What the geoportal shows for one dataset, as a package member (extract.ts); undefined without entries. */
export async function extractMasterportalFromDir(dir: string, datasetId: string): Promise<ExtractedMember | undefined> {
    return extractMasterportal(await readGeoportalFiles(dir), datasetId)
}

/**
 * Takes one dataset's entries out of the three files (removeMasterportal), and writes nothing when
 * there are none. The layer tree first, so it never names a service that is gone.
 */
export async function removeMasterportalFromDir(dir: string, datasetId: string): Promise<RemovedGeoportal['removed']> {
    const result = removeMasterportal(await readGeoportalFiles(dir), datasetId)
    if (!result.changed) return result.removed
    await backUp(dir)
    await writeJson(dir, FILES.config, result.config)
    await writeJson(dir, FILES.services, result.services)
    await writeJson(dir, FILES.styles, result.styles)
    return result.removed
}
