import { describe, expect, it } from 'vitest'

import {
    bindToInstallation,
    datasetSchema,
    DashboardBindingError,
    deriveInstallUuid,
} from '@/lib/superset/rebind'

import { CHART_UUID, DASHBOARD_UUID, DATABASE_UUID, DATASET_UUID, sampleDocument } from './fixtures'

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const INSTANCE_DATABASE = '99999999-9999-4999-8999-999999999999'
const binding = {
    installationId: '7f3c2a10-5b6d-4e8f-9a1b-2c3d4e5f6a7b',
    datasetId: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
    databaseUuid: INSTANCE_DATABASE,
}

const DASHBOARD = 'dashboards/Verkehrszahlung_Live-Monitoring_1.yaml'
const CHART = 'charts/Fahrzeuge_pro_Zahlstelle_7.yaml'
const DATASET = 'datasets/PostgreSQL_geoserver/verkehrsmessung.yaml'
const DATABASE = 'databases/PostgreSQL_geoserver.yaml'

describe('deriveInstallUuid', () => {
    it('gives a valid UUID that differs from the original', () => {
        const uuid = deriveInstallUuid(binding.installationId, CHART_UUID)
        expect(uuid).toMatch(UUID_FORMAT)
        expect(uuid).not.toBe(CHART_UUID)
    })

    it('gives different UUIDs to different installations and to different objects', () => {
        const other = deriveInstallUuid('another-installation', CHART_UUID)
        expect(deriveInstallUuid(binding.installationId, CHART_UUID)).not.toBe(other)
        expect(deriveInstallUuid(binding.installationId, DATASET_UUID)).not.toBe(
            deriveInstallUuid(binding.installationId, CHART_UUID),
        )
    })

    // Derived on purpose: a retried import has to hit the objects of the first attempt.
    it('gives the same UUID when the same installation asks again', () => {
        expect(deriveInstallUuid(binding.installationId, CHART_UUID)).toBe(
            deriveInstallUuid(binding.installationId, CHART_UUID),
        )
    })
})

describe('bindToInstallation', () => {
    const bound = () => bindToInstallation(sampleDocument(), binding)

    it('gives dashboard, chart and dataset new UUIDs and keeps every reference consistent', () => {
        const { files } = bound()
        const dashboard = files[DASHBOARD]
        const chart = files[CHART]
        const dataset = files[DATASET]

        for (const uuid of [dashboard.uuid, chart.uuid, dataset.uuid]) expect(uuid).toMatch(UUID_FORMAT)
        // No reference to a package UUID survives, anywhere in the bundle.
        for (const original of [DASHBOARD_UUID, CHART_UUID, DATASET_UUID]) {
            expect(JSON.stringify(files)).not.toContain(original)
        }
        expect(chart.dataset_uuid).toBe(dataset.uuid)

        const layout = dashboard.position as Record<string, { meta: { uuid: string } }>
        expect(layout['CHART-abc123'].meta.uuid).toBe(chart.uuid)
        const filters = (dashboard.metadata as { native_filter_configuration: { targets: { datasetUuid: string }[] }[] })
            .native_filter_configuration
        expect(filters[0].targets[0].datasetUuid).toBe(dataset.uuid)
    })

    it("points the dataset and the database file at the instance's connection", () => {
        const { files } = bound()
        expect(files[DATABASE].uuid).toBe(INSTANCE_DATABASE)
        expect(files[DATASET].database_uuid).toBe(INSTANCE_DATABASE)
        expect(JSON.stringify(files)).not.toContain(DATABASE_UUID)
    })

    it("moves the dataset to the new dataset's schema and to the connection's own database", () => {
        const dataset = bound().files[DATASET]
        expect(dataset.schema).toBe(datasetSchema(binding.datasetId))
        expect(datasetSchema(binding.datasetId)).toBe('ds_0a1b2c3d_4e5f_4a6b_8c7d_8e9f0a1b2c3d')
        expect(dataset.catalog).toBeNull()
    })

    it('derives a slug from the title when the export has none', () => {
        const document = sampleDocument()
        document.files[DASHBOARD].slug = null
        document.files[DASHBOARD].dashboard_title = 'Verkehrszählung'
        const result = bindToInstallation(document, binding)
        expect(result.slug).toBe('verkehrszaehlung-7f3c2a10')
        expect(result.files[DASHBOARD].slug).toBe(result.slug)
    })

    it('makes the slug unique per installation and reports title, slug and UUID', () => {
        const result = bound()
        expect(result.slug).toBe('verkehrszaehlung-live-7f3c2a10')
        expect(result.files[DASHBOARD].slug).toBe(result.slug)
        expect(result.title).toBe('Verkehrszählung Live-Monitoring')
        expect(result.uuid).toBe(result.files[DASHBOARD].uuid)
    })

    it('leaves the package document untouched', () => {
        const document = sampleDocument()
        bindToInstallation(document, binding)
        expect(document).toEqual(sampleDocument())
    })

    it('gives two installations disjoint objects', () => {
        const first = bound()
        const second = bindToInstallation(sampleDocument(), { ...binding, installationId: 'b2c3d4e5-0000-4000-8000-000000000000' })
        expect(second.uuid).not.toBe(first.uuid)
        expect(second.files[DATASET].uuid).not.toBe(first.files[DATASET].uuid)
        expect(second.slug).not.toBe(first.slug)
    })

    it('refuses a SQL dataset, whose schema sits inside its SQL', () => {
        const document = sampleDocument()
        document.files[DATASET].sql = 'SELECT * FROM ds_3529ec95_f50a_49fe_99e6_e6a634ca8020.verkehrsmessung'
        expect(() => bindToInstallation(document, binding)).toThrow(DashboardBindingError)
    })

    it('refuses a dashboard that reads more than one database', () => {
        const document = sampleDocument()
        document.files['databases/Other.yaml'] = { database_name: 'Other', uuid: '55555555-5555-4555-8555-555555555555' }
        expect(() => bindToInstallation(document, binding)).toThrow(/2 databases/)
    })
})
