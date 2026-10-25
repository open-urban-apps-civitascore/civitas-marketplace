import { describe, expect, it } from 'vitest'

import {
    MasterportalMemberError,
    applyMasterportal,
    mergeFolder,
    portalServices,
    readMasterportalMember,
    type GeoportalFiles,
} from '@/lib/geoportal/merge'

const DATASET = 'fafdab96-3859-45ef-ac7e-ba6a7e5164ff'

const MEMBER = readMasterportalMember(
    {
        folder: 'Jungbaumbewässerung Musterbach',
        layers: [
            {
                apiRef: 'sta',
                visibility: true,
                service: { name: 'Jungbäume - Bodenfeuchte', typ: 'SensorThings', styleId: 'jungbaeume_bodenfeuchte' },
            },
            { apiRef: 'karte', visibility: false, service: { name: 'Jungbäume - Baumkataster', typ: 'WMS', layers: 'jungbaeume' } },
        ],
        styles: [{ styleId: 'jungbaeume_bodenfeuchte', rules: [{ style: { type: 'circle' } }] }],
    },
    'jungbaumbewaesserung.masterportal.json',
)

/** The operator's own entries, as the add-on ships them: none of them may change. */
function operatorFiles(): GeoportalFiles {
    return {
        services: [{ id: '300', name: 'Kiez-Baumkataster', typ: 'WMS', groups: ['open_data'] }],
        config: {
            portalConfig: { map: { mapView: { startZoomLevel: 11 } } },
            layerConfig: {
                baselayer: { elements: [{ id: '3', visibility: true }] },
                subjectlayer: { elements: [{ name: 'Kommunale Fachdaten', type: 'folder', elements: [{ id: '300' }] }] },
            },
        },
        styles: [{ styleId: 'unterkuenfte', rules: [] }],
    }
}

describe('portalServices', () => {
    it('gives every layer the identity and address of the installed dataset', () => {
        expect(portalServices(MEMBER, DATASET)).toEqual([
            {
                id: `${DATASET}-sta`,
                name: 'Jungbäume - Bodenfeuchte',
                typ: 'SensorThings',
                styleId: 'jungbaeume_bodenfeuchte',
                url: `\${GEOSERVER_URL}/${DATASET}/sta`,
                groups: ['open_data'],
            },
            {
                id: `${DATASET}-karte`,
                name: 'Jungbäume - Baumkataster',
                typ: 'WMS',
                layers: 'jungbaeume',
                url: `\${GEOSERVER_URL}/${DATASET}/karte`,
                groups: ['open_data'],
            },
        ])
    })
})

describe('applyMasterportal', () => {
    it('adds the use case and keeps every entry of the operator', () => {
        const applied = applyMasterportal(operatorFiles(), MEMBER, DATASET)

        expect(applied.services.map((service) => (service as { id: string }).id)).toEqual([
            '300',
            `${DATASET}-sta`,
            `${DATASET}-karte`,
        ])
        const layerConfig = applied.config.layerConfig as { baselayer: unknown; subjectlayer: { elements: { name: string }[] } }
        expect(layerConfig.subjectlayer.elements.map((element) => element.name)).toEqual([
            'Jungbaumbewässerung Musterbach',
            'Kommunale Fachdaten',
        ])
        expect(layerConfig.subjectlayer.elements[0]).toEqual({
            name: 'Jungbaumbewässerung Musterbach',
            type: 'folder',
            elements: [
                { id: `${DATASET}-sta`, visibility: true },
                { id: `${DATASET}-karte`, visibility: false },
            ],
        })
        expect(layerConfig.baselayer).toEqual({ elements: [{ id: '3', visibility: true }] })
        expect(applied.config.portalConfig).toEqual({ map: { mapView: { startZoomLevel: 11 } } })
        expect(applied.styles.map((style) => (style as { styleId: string }).styleId)).toEqual([
            'unterkuenfte',
            'jungbaeume_bodenfeuchte',
        ])
        expect(applied.stylesChanged).toBe(true)
    })

    it('is the same applied twice as applied once', () => {
        const once = applyMasterportal(operatorFiles(), MEMBER, DATASET)
        const twice = applyMasterportal(once, MEMBER, DATASET)

        expect(twice.services).toEqual(once.services)
        expect(twice.config).toEqual(once.config)
        expect(twice.styles).toEqual(once.styles)
        expect(twice.stylesChanged).toBe(false)
    })

    it('replaces what an earlier version wrote, where it stands', () => {
        const earlier = operatorFiles()
        earlier.services = [
            { id: `${DATASET}-sta`, name: 'Alter Name' },
            { id: `${DATASET}-alt`, name: 'Ebene, die es nicht mehr gibt' },
            { id: '300', name: 'Kiez-Baumkataster' },
        ]
        const config = earlier.config as { layerConfig: { subjectlayer: { elements: unknown[] } } }
        config.layerConfig.subjectlayer.elements.push({
            name: 'Jungbaumbewässerung Musterbach',
            type: 'folder',
            elements: [{ id: `${DATASET}-alt` }],
        })

        const applied = applyMasterportal(earlier, MEMBER, DATASET)

        expect(applied.services).toEqual([
            { id: '300', name: 'Kiez-Baumkataster' },
            ...portalServices(MEMBER, DATASET),
        ])
        const elements = (applied.config.layerConfig as { subjectlayer: { elements: { name: string }[] } }).subjectlayer
            .elements
        // The operator moved the folder below their own: it stays there.
        expect(elements.map((element) => element.name)).toEqual(['Kommunale Fachdaten', 'Jungbaumbewässerung Musterbach'])
    })

    it('keeps the entries of another installation', () => {
        const other = applyMasterportal(operatorFiles(), MEMBER, 'other-dataset')
        const applied = applyMasterportal(other, MEMBER, DATASET)

        expect(applied.services).toHaveLength(5)
    })
})

describe('mergeFolder', () => {
    it('creates the layer tree in a config that has none', () => {
        const merged = mergeFolder({}, MEMBER, DATASET)

        expect((merged.layerConfig as { subjectlayer: { elements: unknown[] } }).subjectlayer.elements).toHaveLength(1)
    })
})

describe('readMasterportalMember', () => {
    it('refuses a service that carries what belongs to the instance', () => {
        expect(() =>
            readMasterportalMember(
                {
                    folder: 'Ordner',
                    layers: [{ apiRef: 'karte', service: { name: 'Karte', url: 'https://example.org/wms', id: '7' } }],
                },
                'x.masterportal.json',
            ),
        ).toThrow(MasterportalMemberError)
    })

    it('refuses a member without layers', () => {
        expect(() => readMasterportalMember({ folder: 'Ordner', layers: [] }, 'x.masterportal.json')).toThrow(
            /at least one layer/,
        )
    })
})
