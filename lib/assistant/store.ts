import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { assembleCatalogEntry, parsePackageManifest } from '@/lib/catalog/assemble'
import type { CatalogEntry } from '@/lib/catalog/types'

/**
 * Where the packages the assistant generated are kept. They are in no
 * catalogue, so the install dialog could not name them; here each gets an id
 * of its own (`assistant:<key>`), and resolveCatalogEntry answers that id from
 * this store. Dialog, install, release and demo activation then run unchanged.
 *
 * After the install the marketplace looks a package up by its package id
 * instead, the one the journal records: for the dashboard links, for importing
 * a dashboard again, and for removing it at uninstall. So the store answers
 * that id as well, and it keeps its files in a directory that outlives a
 * restart (`.data/assistant` in the working directory, or ASSISTANT_STORE_DIR,
 * which a cluster points at a volume).
 */

export const ASSISTANT_PREFIX = 'assistant:'

/** The package ids of generated use cases start with this. */
export const ASSISTANT_PACKAGE_PREFIX = 'urn:openurbanapps:usecase:assistent-'

/** Read on every call, so the directory follows the environment the server runs in. */
function storeDirectory(): string {
    return process.env.ASSISTANT_STORE_DIR || path.join(process.cwd(), '.data', 'assistant')
}

export interface StoredPackage {
    manifest: Record<string, unknown>
    files: Record<string, Record<string, unknown>>
}

export function isAssistantEntryId(id: string): boolean {
    return id.startsWith(ASSISTANT_PREFIX)
}

export function isAssistantPackageId(id: string): boolean {
    return id.startsWith(ASSISTANT_PACKAGE_PREFIX)
}

function fileOf(key: string): string {
    if (!/^[a-z0-9]+$/.test(key)) throw new Error(`Ungültige Assistenten-Kennung: ${key}`)
    return path.join(storeDirectory(), `${key}.json`)
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
    await mkdir(storeDirectory(), { recursive: true })
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

/**
 * The stored package with this package id. Goes through the files one by one:
 * the store holds the plans of a demo, a few dozen at most, which costs less
 * than keeping an index in step with them.
 */
export async function loadAssistantEntryByPackageId(packageId: string): Promise<CatalogEntry | undefined> {
    let names: string[]
    try {
        names = await readdir(storeDirectory())
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
    }
    for (const name of names) {
        if (!name.endsWith('.json')) continue
        const pkg = JSON.parse(await readFile(path.join(storeDirectory(), name), 'utf8')) as StoredPackage
        if (pkg.manifest.id === packageId) {
            return assembleStoredPackage(pkg, `${ASSISTANT_PREFIX}${name.slice(0, -'.json'.length)}`)
        }
    }
    return undefined
}
