import { describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import {
    DashboardDocumentError,
    documentFromExport,
    importZip,
    readDashboardDocument,
} from '@/lib/superset/bundle'
import { createZip, readZip } from '@/lib/superset/zip'

import { sampleDocument } from './fixtures'

/** A ZIP laid out the way Superset writes an export: every file under one root folder. */
function exportZip(files: Record<string, Record<string, unknown>>, root = 'dashboard_export_20261004T100000') {
    return createZip(
        Object.fromEntries(Object.entries(files).map(([path, document]) => [`${root}/${path}`, stringifyYaml(document)])),
    )
}

describe('documentFromExport', () => {
    it('drops the root folder and parses every YAML file', () => {
        const { files } = sampleDocument()
        const document = documentFromExport(exportZip(files), '6.1.0')

        expect(document.tool).toBe('superset')
        expect(document.supersetVersion).toBe('6.1.0')
        expect(Object.keys(document.files).sort()).toEqual(Object.keys(files).sort())
        expect(document.files['datasets/PostgreSQL_geoserver/verkehrsmessung.yaml']).toEqual(
            files['datasets/PostgreSQL_geoserver/verkehrsmessung.yaml'],
        )
    })

    it('refuses a file outside the root folder', () => {
        const zip = createZip({ 'metadata.yaml': 'type: Dashboard\n' })
        expect(() => documentFromExport(zip)).toThrow(DashboardDocumentError)
    })

    it('refuses an export of anything but a dashboard', () => {
        const { files } = sampleDocument()
        const zip = exportZip({ ...files, 'metadata.yaml': { version: '1.0.0', type: 'Slice' } })
        expect(() => documentFromExport(zip)).toThrow(/does not describe a dashboard/)
    })
})

describe('readDashboardDocument', () => {
    it('accepts the package form of an export', () => {
        expect(readDashboardDocument(sampleDocument()).files['metadata.yaml']).toBeDefined()
    })

    it('refuses a document with two dashboards', () => {
        const document = sampleDocument()
        document.files['dashboards/Second_2.yaml'] = { dashboard_title: 'Second', uuid: 'x' }
        expect(() => readDashboardDocument(document)).toThrow(/exactly one dashboard/)
    })

    it('refuses the retired hand-written format', () => {
        expect(() => readDashboardDocument({ tool: 'superset', assets: {} })).toThrow(/'files' is missing/)
    })
})

describe('importZip', () => {
    it('puts every file one folder deep, where Superset expects it', () => {
        const paths = Object.keys(readZip(importZip(sampleDocument().files)))
        expect(paths).toContain('dashboard_export/metadata.yaml')
        expect(paths.every((path) => path.startsWith('dashboard_export/'))).toBe(true)
    })

    it('round-trips through the export form unchanged', () => {
        const { files } = sampleDocument()
        expect(documentFromExport(importZip(files)).files).toEqual(files)
    })

    it('keeps strings that YAML 1.1 would read as booleans as strings', () => {
        const zip = importZip({ 'metadata.yaml': { type: 'Dashboard', answer: 'yes', mode: 'on' } })
        const text = readZip(zip)['dashboard_export/metadata.yaml'].toString('utf-8')
        // PyYAML, which Superset reads with, follows YAML 1.1.
        expect(parseYaml(text, { version: '1.1' })).toEqual({ type: 'Dashboard', answer: 'yes', mode: 'on' })
    })
})
