import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { assembleCatalogEntry, parsePackageManifest } from '@/lib/catalog/assemble'
import { isDataStructureEntry } from '@/lib/catalog/types'
import { logicalUrn } from '@/lib/export/urn'

/**
 * Applies a package's geo members (named APIs, styles, map layers) to a dataset an install created
 * without them: the manual path for a platform that cannot install geo members itself yet, and the
 * fallback if the install of geo members fails.
 *
 *   PORTAL_API_URL=http://localhost:9080 PORTAL_TOKEN=<access token> \
 *     pnpm geo:apply <package dir containing core-ir/> <dataset id> [--dry-run]
 *
 * The package is checked with the catalogue's own assembly first, so a member the install would
 * refuse is refused here too. The dataset must still be a DRAFT, as the install leaves it. A layer
 * names its sink by title; the sink's copy is found through the installation journal, which records
 * for every copy the package identity it came from. With --dry-run the script reads everything and
 * prints what it would send, but writes nothing.
 */

type Json = Record<string, unknown>

const [packageDir, datasetId, flag] = process.argv.slice(2)
const dryRun = flag === '--dry-run'
const apiBase = (process.env.PORTAL_API_URL ?? 'http://localhost:9080').replace(/\/+$/, '')
const token = process.env.PORTAL_TOKEN

async function call(method: string, path: string, body?: unknown): Promise<Json> {
    const response = await fetch(`${apiBase}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    if (!response.ok) {
        throw new Error(`${method} ${path}: ${response.status} ${response.statusText} ${text}`)
    }
    return text ? (JSON.parse(text) as Json) : {}
}

/** Sends a write, or prints it under --dry-run and answers with a stand-in id. */
async function write(method: string, path: string, body: unknown, standIn: string): Promise<Json> {
    if (dryRun) {
        console.log(`[dry-run] ${method} ${path}\n${JSON.stringify(body, null, 2)}`)
        return { id: standIn }
    }
    return call(method, path, body)
}

async function main(): Promise<void> {
    if (!packageDir || !datasetId || (flag && !dryRun)) {
        console.error('Usage: pnpm geo:apply <package dir> <dataset id> [--dry-run]')
        process.exit(1)
    }
    if (!token) {
        console.error('PORTAL_TOKEN is not set: an access token of a user who may edit the dataset.')
        process.exit(1)
    }

    const read = (file: string): Json =>
        JSON.parse(readFileSync(join(packageDir, 'core-ir', file), 'utf8')) as Json
    const manifest = parsePackageManifest(read('manifest.json'), packageDir)
    const entry = assembleCatalogEntry(manifest, read)
    if (isDataStructureEntry(entry)) {
        console.error('The package is a data structure entry; it has no dataset to publish.')
        process.exit(1)
    }
    const { apis = [], styles = [], layers = [], dataSinks } = entry.bundle
    if (!apis.length && !styles.length && !layers.length) {
        console.log('The package has no geo members. Nothing to do.')
        return
    }

    // The journal of the install that created the dataset: package identity -> copy.
    const page = await call('GET', '/v1/installations?size=200')
    const installation = ((page.content as Json[] | undefined) ?? []).find(
        (row) => row.dataSetId === datasetId && !row.uninstalledAt,
    )
    if (!installation) {
        throw new Error(`No active installation created dataset ${datasetId}.`)
    }
    const journal = await call('GET', `/v1/installations/${String(installation.id)}`)
    const copies = new Map<string, string>()
    for (const line of (journal.artifacts as Json[] | undefined) ?? []) {
        if (typeof line.origin === 'string' && typeof line.shellId === 'string') {
            copies.set(logicalUrn(line.origin), line.shellId)
        }
    }
    const sinkCopyByTitle = new Map<string, string>()
    for (const sink of dataSinks) {
        const copy =
            typeof sink.document.id === 'string' ? copies.get(logicalUrn(sink.document.id)) : undefined
        if (typeof sink.document.title === 'string' && copy) sinkCopyByTitle.set(sink.document.title, copy)
    }

    if (apis.length) {
        // A PATCH carries only the field it changes; the dataset reconciles its APIs as one list.
        const namedApis = apis.map(({ document }) => ({
            name: document.name,
            slug: document.slug,
            standard: String(document.standard).toUpperCase(),
            ...(document.version === undefined ? {} : { version: document.version }),
            ...(document.description === undefined ? {} : { description: document.description }),
        }))
        await write('PATCH', `/v1/datasets/${datasetId}`, { namedApis }, '')
        console.log(`APIs: ${namedApis.map((api) => String(api.slug)).join(', ')}`)
    }

    const styleIds = new Map<string, string>()
    for (const { document } of styles) {
        const created = await write(
            'POST',
            `/v1/datasets/${datasetId}/styles`,
            { name: document.name, sldContent: document.sldContent },
            `<style ${String(document.name)}>`,
        )
        styleIds.set(String(document.name), String(created.id))
        console.log(`Style: ${String(document.name)}`)
    }

    for (const { document } of layers) {
        const sinkId = sinkCopyByTitle.get(String(document.sinkRef))
        if (!sinkId) {
            throw new Error(
                `Layer '${String(document.layerName)}': the journal holds no copy of the sink '${String(document.sinkRef)}'.`,
            )
        }
        const styleId = (name: unknown): string => {
            const id = styleIds.get(String(name))
            if (!id) throw new Error(`Layer '${String(document.layerName)}': style '${String(name)}' was not created.`)
            return id
        }
        const { sinkRef: _sinkRef, defaultStyleRef, alternativeStyleRefs, ...fields } = document
        await write(
            'POST',
            `/v1/datasets/${datasetId}/layers`,
            {
                ...fields,
                dataSinkId: sinkId,
                ...(defaultStyleRef === undefined ? {} : { defaultStyleId: styleId(defaultStyleRef) }),
                ...(Array.isArray(alternativeStyleRefs)
                    ? { alternativeStyleIds: alternativeStyleRefs.map(styleId) }
                    : {}),
            },
            `<layer ${String(document.layerName)}>`,
        )
        console.log(`Layer: ${String(document.layerName)}`)
    }

    console.log(dryRun ? 'Dry run complete, nothing written.' : 'Done. Release the dataset to publish the layers.')
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})
