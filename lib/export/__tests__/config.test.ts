import { describe, expect, it } from 'vitest'

import { bundleBranch, catalogRepoFromEnv, exportReadiness, packageDir, parseExportTargets } from '@/lib/export/config'

describe('parseExportTargets', () => {
    it('parses the JSON list with defaults', () => {
        const { targets, error } = parseExportTargets(
            '[{"label":"Katalog","url":"https://gitlab.com/g/catalog.git","pathPrefix":"/packages/"},{"url":"https://gitlab.com/g/own"}]',
        )
        expect(error).toBeUndefined()
        expect(targets).toEqual([
            { key: 'https://gitlab.com/g/catalog', label: 'Katalog', url: 'https://gitlab.com/g/catalog', baseBranch: 'main', pathPrefix: 'packages' },
            { key: 'https://gitlab.com/g/own', label: 'https://gitlab.com/g/own', url: 'https://gitlab.com/g/own', baseBranch: 'main', pathPrefix: '.' },
        ])
    })

    it('fails the whole list on one bad entry instead of dropping it', () => {
        expect(parseExportTargets('[{"url":"https://gitlab.com/g/ok"},{"url":"ftp://nope"}]').error).toMatch(/\[1\]\.url/)
        expect(parseExportTargets('[{"url":"https://gitlab.com/g/ok","pathPrefix":"../x"}]').error).toMatch(/pathPrefix/)
        expect(parseExportTargets('{').error).toMatch(/JSON/)
        expect(parseExportTargets(undefined)).toEqual({ targets: [] })
    })
})

describe('catalogRepoFromEnv', () => {
    it('derives project and branch from the raw index URL', () => {
        expect(
            catalogRepoFromEnv({
                REPO_LIST_URL: 'https://gitlab.com/civitascore-openurbanapps/civitas-marketplace-catalog/-/raw/main/index.json',
            }),
        ).toEqual({ url: 'https://gitlab.com/civitascore-openurbanapps/civitas-marketplace-catalog', baseBranch: 'main' })
    })

    it('prefers the explicit configuration', () => {
        expect(
            catalogRepoFromEnv({ CATALOG_REPO_URL: 'https://gitlab.com/x/y.git', CATALOG_REPO_BRANCH: 'develop' }),
        ).toEqual({ url: 'https://gitlab.com/x/y', baseBranch: 'develop' })
        expect(catalogRepoFromEnv({})).toBeUndefined()
    })
})

describe('paths and branches', () => {
    it('places the package under the prefix and versions the branch', () => {
        expect(packageDir({ pathPrefix: 'packages' }, 'kiez')).toBe('packages/kiez')
        expect(packageDir({ pathPrefix: '.' }, 'kiez')).toBe('kiez')
        expect(bundleBranch('kiez', '1.0.0')).toBe('export/kiez-1.0.0')
    })

    it('reports readiness in the order an operator has to fix things', () => {
        expect(exportReadiness({ targets: [] })).toBe('missing-targets')
        expect(exportReadiness({ targets: [{ key: 'k', label: 'l', url: 'u', baseBranch: 'main', pathPrefix: '.' }] })).toBe('missing-token')
        expect(exportReadiness({ targets: [{ key: 'k', label: 'l', url: 'u', baseBranch: 'main', pathPrefix: '.' }], token: 't' })).toBe('ready')
    })
})
