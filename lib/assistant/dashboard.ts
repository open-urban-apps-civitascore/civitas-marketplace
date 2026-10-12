import type { SupersetDashboardDocument } from '@/lib/superset/bundle'
import { deriveInstallUuid } from '@/lib/superset/rebind'

/**
 * A starter dashboard for a generated use case, derived from its fields by
 * fixed rules: the model designs nothing here. One bar chart counts the
 * messages per minute, which shows at a glance that data arrives; one line
 * chart per measured value follows it over time, a line per station. Counts
 * are summed and readings averaged, so a count never appears as an average.
 * A text tile says that this is a starting point to adapt in Superset.
 *
 * Shaped like the export of the Verkehrszählung dashboard (Superset 6.1),
 * cut down to what the import reads. The install binds the database file to
 * the instance's own connection (see lib/superset/rebind), and Superset then
 * keeps that connection as it is: the address below is a placeholder only.
 */

export interface DashboardField {
    key: string
    type: 'string' | 'number' | 'integer' | 'boolean'
    dateTime?: boolean
    description: string
    generator: { kind: string }
    /** What the model says the value is: an amount per send interval (sum) or a state (average). */
    aggregate?: 'sum' | 'average'
}

export interface StarterDashboardInput {
    /** Unique per package, so that no two packages share a Superset object. */
    seed: string
    title: string
    tableName: string
    fields: DashboardField[]
    now: number
}

export interface StarterDashboard {
    document: SupersetDashboardDocument
    /** The chart names, for the plan the chat shows. */
    charts: string[]
}

/** More would crowd the first screen; the rest is a click away in Superset. */
const MAX_MEASURES = 4
/** Seconds between two refreshes, and how long a chart's data may come from the cache. */
const REFRESH_SECONDS = 10

const STARTER_NOTE = '_Automatisch erzeugtes Start-Dashboard: ein erster Blick auf die Daten, zum Anpassen in Superset._'

type Aggregate = 'SUM' | 'AVG'

/**
 * How a field is charted, or undefined when it is no measured value (time,
 * station, coordinates, labels). Which fields are measured values follows the
 * demo-data generator, which the model chooses reliably. Whether a value is
 * summed or averaged follows its meaning, which the generator does not carry:
 * rainfall per interval fluctuates like a reading but has to be summed. So the
 * model's `aggregate` decides, and the generator is only the fallback.
 */
function aggregateOf(field: DashboardField): Aggregate | undefined {
    if (field.dateTime || (field.type !== 'number' && field.type !== 'integer')) return undefined
    if (field.generator.kind !== 'dailyProfile' && field.generator.kind !== 'randomWalk') return undefined
    if (field.aggregate) return field.aggregate === 'sum' ? 'SUM' : 'AVG'
    return field.generator.kind === 'dailyProfile' ? 'SUM' : 'AVG'
}

/** The column type the PostGIS sink gives the field, as Superset names it. */
function columnType(field: DashboardField): string {
    if (field.dateTime) return 'TIMESTAMP WITH TIME ZONE'
    switch (field.type) {
        case 'integer':
            return 'INTEGER'
        case 'number':
            return 'DOUBLE PRECISION'
        case 'boolean':
            return 'BOOLEAN'
        default:
            return 'TEXT'
    }
}

/** A file name segment from a chart name, like Superset's own export names. */
function fileSegment(name: string, index: number): string {
    const ascii = name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
    return `${ascii || 'Chart'}_${index}`
}

interface ChartSpec {
    name: string
    vizType: 'echarts_timeseries_bar' | 'echarts_timeseries_line'
    metric: Record<string, unknown>
}

export function buildStarterDashboard(input: StarterDashboardInput): StarterDashboard | undefined {
    const time = input.fields.find((field) => field.dateTime)
    // Every chart runs along time; without a time field there is nothing to draw.
    if (!time) return undefined
    const station = input.fields.find((field) => field.generator.kind === 'station' && !field.dateTime)
    const perStation = station ? ' je Station' : ''

    const uuid = (name: string) => deriveInstallUuid(`assistant#${input.seed}`, name)
    const dashboardUuid = uuid('dashboard')
    const datasetUuid = uuid('dataset')
    const databaseUuid = uuid('database')

    const charts: ChartSpec[] = [
        {
            name: `Nachrichten pro Minute${perStation}`,
            vizType: 'echarts_timeseries_bar',
            metric: {
                expressionType: 'SQL',
                sqlExpression: 'COUNT(*)',
                label: 'Nachrichten',
                hasCustomLabel: true,
                optionName: 'metric_nachrichten',
            },
        },
    ]
    for (const field of input.fields) {
        const aggregate = aggregateOf(field)
        if (!aggregate || charts.length > MAX_MEASURES) continue
        const how = aggregate === 'SUM' ? 'Summe' : 'Durchschnitt'
        const what = field.description.trim().slice(0, 80) || field.key
        charts.push({
            name: `${what} (${how} pro Minute${perStation})`,
            vizType: 'echarts_timeseries_line',
            metric: {
                expressionType: 'SIMPLE',
                aggregate,
                column: { column_name: field.key, type: columnType(field) },
                label: `${how} ${field.key}`,
                hasCustomLabel: true,
                optionName: `metric_${field.key}`,
            },
        })
    }

    const files: Record<string, Record<string, unknown>> = {
        'metadata.yaml': {
            version: '1.0.0',
            type: 'Dashboard',
            timestamp: new Date(input.now).toISOString(),
        },
    }

    // Two charts side by side per row, under a full-width row for the note.
    const position: Record<string, unknown> = {
        DASHBOARD_VERSION_KEY: 'v2',
        ROOT_ID: { type: 'ROOT', id: 'ROOT_ID', children: ['GRID_ID'] },
        HEADER_ID: { type: 'HEADER', id: 'HEADER_ID', meta: { text: input.title } },
        'ROW-starter-note': {
            type: 'ROW',
            id: 'ROW-starter-note',
            children: ['MARKDOWN-starter-note'],
            parents: ['ROOT_ID', 'GRID_ID'],
            meta: { background: 'BACKGROUND_TRANSPARENT' },
        },
        'MARKDOWN-starter-note': {
            type: 'MARKDOWN',
            id: 'MARKDOWN-starter-note',
            children: [],
            parents: ['ROOT_ID', 'GRID_ID', 'ROW-starter-note'],
            meta: { width: 12, height: 8, code: STARTER_NOTE },
        },
    }
    const rows: string[] = ['ROW-starter-note']

    charts.forEach((chart, index) => {
        const chartUuid = uuid(`chart#${index}`)
        const rowId = `ROW-charts-${Math.floor(index / 2)}`
        if (index % 2 === 0) {
            rows.push(rowId)
            position[rowId] = {
                type: 'ROW',
                id: rowId,
                children: [],
                parents: ['ROOT_ID', 'GRID_ID'],
                meta: { background: 'BACKGROUND_TRANSPARENT' },
            }
        }
        const chartId = `CHART-starter-${index}`
        ;(position[rowId] as { children: string[] }).children.push(chartId)
        position[chartId] = {
            type: 'CHART',
            id: chartId,
            children: [],
            parents: ['ROOT_ID', 'GRID_ID', rowId],
            meta: { chartId: index + 1, uuid: chartUuid, sliceName: chart.name, width: 6, height: 50 },
        }

        files[`charts/${fileSegment(chart.name, index + 1)}.yaml`] = {
            slice_name: chart.name,
            description: null,
            certified_by: null,
            certification_details: null,
            viz_type: chart.vizType,
            params: {
                // The import points this at the dataset it creates.
                datasource: '1__table',
                viz_type: chart.vizType,
                x_axis: time.key,
                time_grain_sqla: 'PT1M',
                metrics: [chart.metric],
                groupby: station ? [station.key] : [],
                adhoc_filters: [
                    {
                        clause: 'WHERE',
                        comparator: 'No filter',
                        expressionType: 'SIMPLE',
                        operator: 'TEMPORAL_RANGE',
                        subject: time.key,
                    },
                ],
                row_limit: 10000,
                order_desc: true,
                truncate_metric: true,
                show_legend: true,
                legendType: 'scroll',
                legendOrientation: 'top',
                rich_tooltip: true,
                x_axis_time_format: 'smart_date',
                y_axis_format: 'SMART_NUMBER',
                color_scheme: 'supersetColors',
                extra_form_data: {},
            },
            query_context: null,
            cache_timeout: REFRESH_SECONDS,
            uuid: chartUuid,
            version: '1.0.0',
            dataset_uuid: datasetUuid,
        }
    })

    position.GRID_ID = { type: 'GRID', id: 'GRID_ID', children: rows, parents: ['ROOT_ID'] }

    files[`dashboards/${fileSegment(input.title, 1)}.yaml`] = {
        dashboard_title: input.title,
        description: null,
        css: '',
        slug: null,
        certified_by: '',
        certification_details: '',
        published: false,
        uuid: dashboardUuid,
        position,
        metadata: {
            refresh_frequency: REFRESH_SECONDS,
            timed_refresh_immune_slices: [],
            expanded_slices: {},
            color_scheme: '',
            label_colors: {},
            shared_label_colors: [],
            color_scheme_domain: [],
            native_filter_configuration: [],
            cross_filters_enabled: false,
            default_filters: '{}',
        },
        theme_uuid: null,
        version: '1.0.0',
    }

    files[`datasets/CIVITAS_Payload/${input.tableName}.yaml`] = {
        table_name: input.tableName,
        main_dttm_col: time.key,
        currency_code_column: null,
        description: null,
        default_endpoint: null,
        offset: 0,
        cache_timeout: REFRESH_SECONDS,
        catalog: null,
        // The install replaces this with the schema of the installation's dataset.
        schema: 'public',
        sql: '',
        params: null,
        template_params: null,
        filter_select_enabled: true,
        fetch_values_predicate: null,
        extra: null,
        normalize_columns: false,
        always_filter_main_dttm: false,
        folders: null,
        uuid: datasetUuid,
        metrics: [
            {
                metric_name: 'count',
                verbose_name: 'COUNT(*)',
                metric_type: 'count',
                expression: 'COUNT(*)',
                description: null,
                d3format: null,
                currency: null,
                extra: { warning_markdown: '' },
                warning_text: null,
            },
        ],
        columns: input.fields.map((field) => ({
            column_name: field.key,
            verbose_name: null,
            is_dttm: Boolean(field.dateTime),
            is_active: true,
            type: columnType(field),
            advanced_data_type: null,
            groupby: true,
            filterable: true,
            expression: '',
            description: field.description || null,
            python_date_format: null,
            datetime_format: null,
            extra: { warning_markdown: null },
        })),
        version: '1.0.0',
        database_uuid: databaseUuid,
    }

    files['databases/CIVITAS_Payload.yaml'] = {
        database_name: 'CIVITAS Payload (Platzhalter)',
        sqlalchemy_uri: 'postgresql+psycopg2://payload:XXXXXXXXXX@platzhalter:5432/payload',
        cache_timeout: null,
        expose_in_sqllab: true,
        allow_run_async: false,
        allow_ctas: false,
        allow_cvas: false,
        allow_dml: false,
        allow_file_upload: false,
        extra: { allows_virtual_table_explore: true },
        impersonate_user: false,
        configuration_method: 'dynamic_form',
        uuid: databaseUuid,
        version: '1.0.0',
    }

    return {
        document: { tool: 'superset', supersetVersion: '6.1.0', files },
        charts: charts.map((chart) => chart.name),
    }
}
