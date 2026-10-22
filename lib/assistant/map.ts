/**
 * The map of a generated use case, after the pattern of Kiez-Baumkataster
 * 1.1.0: the target structure gains a point geometry, the mapping builds it
 * from the station's coordinates with `geoPoint`, and the package brings an
 * OWS API, a style and a layer that publish the sink's table. The install
 * path binds these like any catalogue package's: the layer names its sink by
 * title and its style by name.
 *
 * The bounding box comes from the coordinates the demo data send, so the map
 * opens where the points are. A box written by hand can miss them (the Kiez
 * package's box covers Münster while the cluster's demo trees stand in
 * Wuppertal), and GeoServer takes the declared box at release.
 */

export interface MapField {
    key: string
    generator: { kind: string }
}

export interface MapInput {
    title: string
    /** The data sink's title: the layer refers to its sink by title. */
    sinkTitle: string
    fields: MapField[]
    /** Each station's coordinates exactly as the demo data send them. */
    stations: { lat: number; lon: number }[]
}

export interface BoundingBox {
    minX: number
    minY: number
    maxX: number
    maxY: number
}

export interface UseCaseMap {
    /** The target structure's geometry field. */
    positionKey: string
    /** The JSON Schema property of that field. */
    positionProperty: Record<string, unknown>
    /** The mapping entry that builds it. */
    positionMapping: Record<string, unknown>
    files: Record<string, Record<string, unknown>>
    members: {
        apis: { file: string }[]
        styles: { file: string }[]
        layers: { file: string }[]
    }
    layerName: string
    bbox: BoundingBox
}

const API_SLUG = 'karte'
const LAYER_NAME = 'stationen'
const STYLE_NAME = 'stationen'
/** Around a degree's hundredth on each side: a few hundred metres of street around the outer stations. */
const MARGIN_DEGREES = 0.01

function round(value: number): number {
    return Math.round(value * 1e6) / 1e6
}

/** The stations' extent plus a margin, so that a single station still gets a box. */
export function boundingBoxOf(stations: { lat: number; lon: number }[]): BoundingBox {
    const lats = stations.map((station) => station.lat)
    const lons = stations.map((station) => station.lon)
    return {
        minX: round(Math.min(...lons) - MARGIN_DEGREES),
        minY: round(Math.min(...lats) - MARGIN_DEGREES),
        maxX: round(Math.max(...lons) + MARGIN_DEGREES),
        maxY: round(Math.max(...lats) + MARGIN_DEGREES),
    }
}

function pointStyle(name: string, title: string): string {
    return (
        '<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" ' +
        'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
        'xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">' +
        `<NamedLayer><Name>${name}</Name><UserStyle><Title>${title}</Title><FeatureTypeStyle><Rule>` +
        '<PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>' +
        '<Fill><CssParameter name="fill">#1565C0</CssParameter></Fill>' +
        '<Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">2</CssParameter></Stroke>' +
        '</Mark><Size>14</Size></Graphic></PointSymbolizer>' +
        '</Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>'
    )
}

/** Undefined when the message carries no coordinates: there is nothing to put on a map. */
export function buildUseCaseMap(input: MapInput): UseCaseMap | undefined {
    const lat = input.fields.find((field) => field.generator.kind === 'stationLat')
    const lon = input.fields.find((field) => field.generator.kind === 'stationLon')
    if (!lat || !lon || input.stations.length === 0) return undefined

    // "position" as in the Kiez package, unless the message already has a field of that name.
    const positionKey = input.fields.some((field) => field.key === 'position') ? 'geometrie' : 'position'
    const bbox = boundingBoxOf(input.stations)

    const files: Record<string, Record<string, unknown>> = {
        'karte.api.json': {
            name: `${input.title} Karte`,
            slug: API_SLUG,
            standard: 'OWS',
            description: `${input.title} als Kartendienst (WMS und WFS).`,
        },
        'stationen.style.json': {
            name: STYLE_NAME,
            sldContent: pointStyle(STYLE_NAME, 'Stationen'),
        },
        'stationen.layer.json': {
            layerName: LAYER_NAME,
            title: `${input.title}: Stationen`,
            description: `Die Stationen von „${input.title}“ mit ihren Messwerten.`,
            keywords: ['stationen', 'messnetz'],
            sinkRef: input.sinkTitle,
            attribute: [...input.fields.map((field) => field.key), positionKey],
            geometryColumnRef: positionKey,
            defaultStyleRef: STYLE_NAME,
            crs: 'EPSG:4326',
            nativeBoundingBox: bbox,
            latLonBoundingBox: bbox,
        },
    }

    return {
        positionKey,
        positionProperty: {
            $ref: 'https://geojson.org/schema/Point.json',
            crs: 'EPSG:4326',
            description: 'Standort der Station als Punkt (WGS84), Grundlage der Karte',
        },
        positionMapping: { op: 'geoPoint', lon: `$.${lon.key}`, lat: `$.${lat.key}` },
        files,
        members: {
            apis: [{ file: 'karte.api.json' }],
            styles: [{ file: 'stationen.style.json' }],
            layers: [{ file: 'stationen.layer.json' }],
        },
        layerName: LAYER_NAME,
        bbox,
    }
}
