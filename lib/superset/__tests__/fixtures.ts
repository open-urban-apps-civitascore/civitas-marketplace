import type { SupersetDashboardDocument } from '@/lib/superset/bundle'

/**
 * A dashboard document shaped like a real Superset 6 export, cut down to the
 * fields the conversions touch: one dashboard, one chart, one table dataset,
 * one database connection, and every UUID reference between them.
 */
export const DASHBOARD_UUID = '11111111-1111-4111-8111-111111111111'
export const CHART_UUID = '22222222-2222-4222-8222-222222222222'
export const DATASET_UUID = '33333333-3333-4333-8333-333333333333'
export const DATABASE_UUID = '44444444-4444-4444-8444-444444444444'

export function sampleDocument(): SupersetDashboardDocument {
    return {
        tool: 'superset',
        supersetVersion: '6.1.0',
        files: {
            'metadata.yaml': {
                version: '1.0.0',
                type: 'Dashboard',
                timestamp: '2026-10-04T10:00:00.000000+00:00',
            },
            'dashboards/Verkehrszahlung_Live-Monitoring_1.yaml': {
                dashboard_title: 'Verkehrszählung Live-Monitoring',
                slug: 'verkehrszaehlung-live',
                uuid: DASHBOARD_UUID,
                position: {
                    'CHART-abc123': {
                        type: 'CHART',
                        id: 'CHART-abc123',
                        meta: { chartId: 7, uuid: CHART_UUID, width: 6, height: 50 },
                    },
                },
                metadata: {
                    refresh_frequency: 0,
                    native_filter_configuration: [
                        { id: 'NATIVE_FILTER-1', targets: [{ datasetUuid: DATASET_UUID, column: { name: 'stationId' } }] },
                    ],
                },
                version: '1.0.0',
            },
            'charts/Fahrzeuge_pro_Zahlstelle_7.yaml': {
                slice_name: 'Fahrzeuge pro Zählstelle',
                viz_type: 'echarts_timeseries_line',
                params: { metrics: [{ aggregate: 'SUM', column: { column_name: 'vehicleCount' } }], groupby: ['stationId'] },
                uuid: CHART_UUID,
                dataset_uuid: DATASET_UUID,
                version: '1.0.0',
            },
            'datasets/PostgreSQL_geoserver/verkehrsmessung.yaml': {
                table_name: 'verkehrsmessung',
                catalog: 'geoserver',
                schema: 'ds_3529ec95_f50a_49fe_99e6_e6a634ca8020',
                sql: null,
                uuid: DATASET_UUID,
                database_uuid: DATABASE_UUID,
                columns: [{ column_name: 'observedAt', is_dttm: true, type: 'TIMESTAMP WITH TIME ZONE' }],
                version: '1.0.0',
            },
            'databases/PostgreSQL_geoserver.yaml': {
                database_name: 'PostgreSQL geoserver',
                sqlalchemy_uri: 'postgresql://geoserver:XXXXXXXXXX@civitas-geoserver-db:5432/geoserver',
                uuid: DATABASE_UUID,
                version: '1.0.0',
            },
        },
    }
}
