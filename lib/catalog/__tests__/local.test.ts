import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findLocalSummary, localSummaries, resolveLocalEntry, saveLocalPackage, withLocalRows } from '@/lib/catalog/local'
import type { CatalogSummary } from '@/lib/catalog/types'

/**
 * The local shelf: what the export puts there is listed and installable like a catalogue entry,
 * the newest version of an id counts, and it replaces the catalogue's row of the same id.
 */

const STRUCTURE = {
    $id: 'urn:core:standard:openurbanapps:datastructure:environment:jungbaum:f1i2sjhgvq',
    title: 'Jungbaum',
    type: 'object',
}

function packageFiles(version: string, extra: Record<string, unknown> = {}): Record<string, string> {
    const manifest = {
        id: 'urn:openurbanapps:usecase:jungbaum-rundweg',
        type: 'usecase',
        displayName: 'Jungbäume Rundweg',
        description: 'Jungbäume mit Karte',
        version,
        maintainer: 'Open Urban Apps',
        license: 'EUPL-1.2',
        keywords: [],
        members: { dataStructures: [{ file: 'jungbaum.datastructure.json' }] },
        dependencies: [],
        ...extra,
    }
    return {
        'core-ir/manifest.json': JSON.stringify(manifest),
        'core-ir/jungbaum.datastructure.json': JSON.stringify(STRUCTURE),
        'ci/validate-bundle.py': '# the validator\n',
        'README.md': '# Jungbäume Rundweg\n',
    }
}

let root: string

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'local-catalog-'))
    process.env.LOCAL_CATALOG_DIR = root
})

afterEach(() => {
    delete process.env.LOCAL_CATALOG_DIR
    rmSync(root, { recursive: true, force: true })
})

describe('the local catalogue shelf', () => {
    it('lists and assembles what was saved, with a pin that says where it is from', async () => {
        const dir = await saveLocalPackage('jungbaum-rundweg-1.1.6', packageFiles('1.1.6'))

        expect(existsSync(join(dir, 'ci', 'validate-bundle.py'))).toBe(true)
        const [summary] = await localSummaries('usecase')
        expect(summary).toMatchObject({
            id: 'urn:openurbanapps:usecase:jungbaum-rundweg',
            version: '1.1.6',
            deploymentRef: { url: 'local:jungbaum-rundweg-1.1.6', releaseTag: 'lokal', path: '.' },
        })
        expect(await localSummaries('datastructure')).toEqual([])
        const entry = await resolveLocalEntry('urn:openurbanapps:usecase:jungbaum-rundweg')
        expect(entry?.manifest.version).toBe('1.1.6')
    })

    it('counts the newest version of an id, by number', async () => {
        await saveLocalPackage('jungbaum-rundweg-1.9.0', packageFiles('1.9.0'))
        await saveLocalPackage('jungbaum-rundweg-1.10.0', packageFiles('1.10.0'))

        expect((await findLocalSummary('urn:openurbanapps:usecase:jungbaum-rundweg'))?.version).toBe('1.10.0')
    })

    it('reads a package saved again under the same version anew', async () => {
        await saveLocalPackage('jungbaum-rundweg-1.1.6', packageFiles('1.1.6'))
        const before = (await localSummaries('usecase'))[0].deploymentRef?.ref
        await saveLocalPackage('jungbaum-rundweg-1.1.6', packageFiles('1.1.6', { keywords: ['karte'] }))

        expect((await localSummaries('usecase'))[0].deploymentRef?.ref).not.toBe(before)
    })

    it('refuses a name or a path that would leave the shelf', async () => {
        await expect(saveLocalPackage('../elsewhere', packageFiles('1.0.0'))).rejects.toThrow()
        await expect(saveLocalPackage('ok-1.0.0', { '../../escape.json': '{}' })).rejects.toThrow()
    })

    it('is empty without LOCAL_CATALOG_DIR', async () => {
        delete process.env.LOCAL_CATALOG_DIR
        expect(await localSummaries('usecase')).toEqual([])
        expect(await resolveLocalEntry('urn:openurbanapps:usecase:jungbaum-rundweg')).toBeUndefined()
    })
})

describe('withLocalRows', () => {
    const row = (id: string, version: string) => ({ id, version }) as CatalogSummary

    it('replaces the catalogue row of the same id where it stands and adds the others after', () => {
        expect(withLocalRows([row('a', '1.0.0'), row('b', '1.0.0')], [row('b', '2.0.0'), row('c', '1.0.0')])).toEqual([
            row('a', '1.0.0'),
            row('b', '2.0.0'),
            row('c', '1.0.0'),
        ])
    })
})
