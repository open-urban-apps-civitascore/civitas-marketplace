import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { applyMasterportal, MasterportalMemberError, type MasterportalMember } from '@/lib/geoportal/merge'

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

/**
 * Writes the member into the three files for one dataset. In place, not as a new file renamed
 * over the old one: the geoportal containers mount these files one by one, and a single-file
 * mount keeps the file it was given at start. Styles first and the layer tree last, so the tree
 * never names a service that is not written yet.
 */
export async function applyMasterportalToDir(
    dir: string,
    member: MasterportalMember,
    datasetId: string,
): Promise<{ stylesChanged: boolean }> {
    const files = {
        services: await readJson(dir, FILES.services),
        config: await readJson(dir, FILES.config),
        styles: await readJson(dir, FILES.styles),
    }
    const applied = applyMasterportal(files, member, datasetId)
    const write = (file: string, value: unknown) =>
        writeFile(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await write(FILES.styles, applied.styles)
    await write(FILES.services, applied.services)
    await write(FILES.config, applied.config)
    return { stylesChanged: applied.stylesChanged }
}
