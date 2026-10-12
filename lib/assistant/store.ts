import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { assembleCatalogEntry, parsePackageManifest } from '@/lib/catalog/assemble'
import type { CatalogEntry } from '@/lib/catalog/types'

/**
 * Where the packages the assistant generated wait for their install. They are
 * in no catalogue, so the install dialog could not name them; here each gets
 * an id of its own (`assistant:<key>`), and resolveCatalogEntry answers that
 * id from this store. Dialog, install, release and demo activation then run
 * unchanged. A file per package in the temp directory survives the dev
 * server's reloads; a restart of the machine clears it, which is fine for
 * plans nobody confirmed.
 */

export const ASSISTANT_PREFIX = 'assistant:'

const DIRECTORY = path.join(tmpdir(), 'oua-marketplace-assistant')

export interface StoredPackage {
    manifest: Record<string, unknown>
    files: Record<string, Record<string, unknown>>
}

export function isAssistantEntryId(id: string): boolean {
    return id.startsWith(ASSISTANT_PREFIX)
}

function fileOf(key: string): string {
    if (!/^[a-z0-9]+$/.test(key)) throw new Error(`Ungültige Assistenten-Kennung: ${key}`)
    return path.join(DIRECTORY, `${key}.json`)
}

/** The stored files assembled like a catalogue package: same checks, same shape. */
export function assembleStoredPackage(pkg: StoredPackage, id: string): CatalogEntry {
    return assembleCatalogEntry(parsePackageManifest(pkg.manifest, id), (file) => {
        const content = pkg.files[file]
        if (!content) throw new Error(`${id}: Datei '${file}' fehlt`)
        return content
    })
}

export async function saveStoredPackage(key: string, pkg: StoredPackage): Promise<string> {
    await mkdir(DIRECTORY, { recursive: true })
    await writeFile(fileOf(key), JSON.stringify(pkg), 'utf8')
    return `${ASSISTANT_PREFIX}${key}`
}

export async function loadAssistantEntry(id: string): Promise<CatalogEntry | undefined> {
    let raw: string
    try {
        raw = await readFile(fileOf(id.slice(ASSISTANT_PREFIX.length)), 'utf8')
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
    }
    return assembleStoredPackage(JSON.parse(raw) as StoredPackage, id)
}
