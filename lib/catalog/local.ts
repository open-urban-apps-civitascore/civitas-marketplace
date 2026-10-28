import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { assembleCatalogEntry, parsePackageManifest } from '@/lib/catalog/assemble'
import type { CatalogEntry, CatalogSummary, PackageManifest, PackageMember } from '@/lib/catalog/types'

/**
 * A catalogue shelf on this machine, for local work and demos: a package shared with „Lokal in
 * den Katalog“ lands here instead of in GitLab, one directory per version in the layout of a
 * package repository (`core-ir/manifest.json`, its members, `ci/validate-bundle.py`, `README.md`),
 * so the repository's own validator runs in it. The catalogue lists these packages next to its
 * own entries and installs them through the same assembly; a local package replaces a catalogue
 * row with the same id, and among local versions of one id the highest counts.
 *
 * There only when LOCAL_CATALOG_DIR is set. Nobody reviews what lands here, so the catalogue
 * shows these packages as unreviewed, with the source „lokal“.
 */

export function localCatalogDir(): string | undefined {
    return process.env.LOCAL_CATALOG_DIR?.trim() || undefined
}

/** The pin url of a local package: no repository to link, the directory's name to recognise it. */
export const LOCAL_PIN_PREFIX = 'local:'

/** Directory and member file names: no path of their own, no hidden files. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

interface LocalPackage {
    manifest: PackageManifest
    dir: string
    /** Over all member files, so a package saved again under the same version reads anew. */
    contentHash: string
}

/** Every member file the manifest lists, of every kind. */
function memberFiles(manifest: PackageManifest): string[] {
    const kinds = Object.values(manifest.members) as (PackageMember[] | undefined)[]
    return kinds.flatMap((members) => (members ?? []).map((member) => member.file))
}

async function readPackage(dir: string): Promise<LocalPackage | undefined> {
    let raw: string
    try {
        raw = await readFile(path.join(dir, 'core-ir', 'manifest.json'), 'utf8')
    } catch {
        return undefined
    }
    const manifest = parsePackageManifest(JSON.parse(raw), `${LOCAL_PIN_PREFIX}${path.basename(dir)}`)
    const hash = createHash('sha256').update(raw)
    for (const file of memberFiles(manifest)) {
        if (SAFE_NAME.test(file)) hash.update(await readFile(path.join(dir, 'core-ir', file)).catch(() => Buffer.alloc(0)))
    }
    return { manifest, dir, contentHash: hash.digest('hex').slice(0, 12) }
}

/** Compares "1.10.0" and "1.9.2" by their numbers; text that is no version counts as 0. */
function compareVersions(a: string, b: string): number {
    const parts = (version: string) => version.split('.').map((part) => Number.parseInt(part, 10) || 0)
    const [left, right] = [parts(a), parts(b)]
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0)
        if (difference !== 0) return difference
    }
    return 0
}

/**
 * The newest local version of every package id. A directory that does not hold a readable package
 * is left out: one broken shelf must not take the catalogue down.
 */
async function readLocalPackages(): Promise<LocalPackage[]> {
    const root = localCatalogDir()
    if (!root) return []
    let names: string[]
    try {
        names = await readdir(root)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
    }
    const newest = new Map<string, LocalPackage>()
    for (const name of names.filter((candidate) => SAFE_NAME.test(candidate))) {
        const pkg = await readPackage(path.join(root, name)).catch(() => undefined)
        if (!pkg) continue
        const known = newest.get(pkg.manifest.id)
        if (!known || compareVersions(pkg.manifest.version, known.manifest.version) > 0) newest.set(pkg.manifest.id, pkg)
    }
    return [...newest.values()]
}

function summaryOf(pkg: LocalPackage): CatalogSummary {
    return {
        ...pkg.manifest,
        deploymentRef: {
            url: `${LOCAL_PIN_PREFIX}${path.basename(pkg.dir)}`,
            ref: pkg.contentHash,
            releaseTag: 'lokal',
            path: '.',
        },
    }
}

/** The local packages of one type, as catalogue rows. */
export async function localSummaries(type: 'usecase' | 'datastructure'): Promise<CatalogSummary[]> {
    return (await readLocalPackages()).filter((pkg) => pkg.manifest.type === type).map(summaryOf)
}

/** The catalogue's rows with the local ones: a local row replaces the row of its id where it stands, the rest come after. */
export function withLocalRows(rows: CatalogSummary[], local: CatalogSummary[]): CatalogSummary[] {
    const byId = new Map(local.map((row) => [row.id, row]))
    const merged = rows.map((row) => byId.get(row.id) ?? row)
    const listed = new Set(rows.map((row) => row.id))
    return [...merged, ...local.filter((row) => !listed.has(row.id))]
}

export async function findLocalSummary(id: string): Promise<CatalogSummary | undefined> {
    const pkg = (await readLocalPackages()).find((candidate) => candidate.manifest.id === id)
    return pkg && summaryOf(pkg)
}

/** The assembled entry of a local package, the same way a fixture or a fetched package is assembled. */
export async function resolveLocalEntry(id: string): Promise<CatalogEntry | undefined> {
    const pkg = (await readLocalPackages()).find((candidate) => candidate.manifest.id === id)
    if (!pkg) return undefined
    const contents = new Map<string, Record<string, unknown>>()
    for (const file of memberFiles(pkg.manifest)) {
        if (!SAFE_NAME.test(file)) throw new Error(`${pkg.dir}: unsafe member file name '${file}'`)
        contents.set(file, JSON.parse(await readFile(path.join(pkg.dir, 'core-ir', file), 'utf8')) as Record<string, unknown>)
    }
    return assembleCatalogEntry(pkg.manifest, (file) => {
        const content = contents.get(file)
        if (!content) throw new Error(`${pkg.dir}: member file '${file}' is missing`)
        return content
    })
}

/**
 * Puts a package on the shelf as directory `name` (`<slug>-<version>`), replacing one of the same
 * name: the files are the package as the export made it, paths relative to its directory.
 * Returns the directory.
 */
export async function saveLocalPackage(name: string, files: Record<string, string>): Promise<string> {
    const root = localCatalogDir()
    if (!root) throw new Error('LOCAL_CATALOG_DIR is not set')
    if (!SAFE_NAME.test(name)) throw new Error(`'${name}' is no directory name for a package`)
    const dir = path.resolve(root, name)
    const targets = Object.entries(files).map(([relative, content]) => {
        const target = path.resolve(dir, relative)
        if (!target.startsWith(`${dir}${path.sep}`)) throw new Error(`'${relative}' leaves the package directory`)
        return [target, content] as const
    })
    await rm(dir, { recursive: true, force: true })
    for (const [target, content] of targets) {
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, content, 'utf8')
    }
    return dir
}
