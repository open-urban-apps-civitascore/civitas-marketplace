import { describe, expect, it } from 'vitest'

import { extractMasterportal } from '@/lib/geoportal/extract'
import {
    MasterportalMemberError,
    applyMasterportal,
    readMasterportalMember,
    type GeoportalFiles,
} from '@/lib/geoportal/merge'

const DATASET = 'ba379d1a-1369-4b5e-8f66-768c4e14da38'

/** The member of Jungbaumbewässerung 1.1.5, shortened to the fields that matter here. */
const MEMBER = readMasterportalMember(
    {
        folder: 'Jungbaumbewässerung Musterbach',
        layers: [
            {
                apiRef: 'sta',
                visibility: true,
                service: {
                    name: 'Jungbäume - Bodenfeuchte',
                    typ: 'SensorThings',
                    version: '1.1/..',
                    urlParameter: { root: 'Things', expand: 'Locations,Datastreams/Observations($top=1)' },
                    styleId: 'jungbaeume_bodenfeuchte',
                    gfiAttributes: { name: 'Baum', dataStreamValue: 'Bodenfeuchte in %' },
                },
            },
            {
                apiRef: 'karte',
                visibility: false,
                service: { name: 'Jungbäume - Baumkataster', typ: 'WMS', layers: 'jungbaeume', format: 'image/png' },
            },
        ],
        styles: [
            {
                styleId: 'jungbaeume_bodenfeuchte',
                rules: [{ conditions: { properties: { dataStreamValue: [null, 15] } }, style: { circleFillColor: [215, 48, 39, 1] } }],
            },
        ],
    },
    'jungbaumbewaesserung.masterportal.json',
)

function operatorFiles(): GeoportalFiles {
    return {
        services: [
            { id: '300', name: 'Kiez-Baumkataster', typ: 'WMS', styleId: 'unterkuenfte', groups: ['open_data'] },
        ],
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

type Tree = { subjectlayer: { elements: { name: string; type: string; elements: Record<string, unknown>[] }[] } }

const treeOf = (files: { config: unknown }) => (files.config as { layerConfig: Tree }).layerConfig

describe('extractMasterportal', () => {
    it('gives back the member that was applied', () => {
        const applied = applyMasterportal(operatorFiles(), MEMBER, DATASET)

        const extracted = extractMasterportal(applied, DATASET)

        expect(extracted?.member).toEqual(MEMBER)
        expect(extracted?.warnings).toEqual([])
    })

    it('carries what the operator changed in the files, and nothing of this instance', () => {
        // A copy: the applied style is the member's own object, and the test changes its colour.
        const files = structuredClone(applyMasterportal(operatorFiles(), MEMBER, DATASET))
        const folder = treeOf(files).subjectlayer.elements[0]
        folder.name = 'Jungbäume Rundweg'
        // The map first and visible, the soil moisture hidden.
        folder.elements = [
            { id: `${DATASET}-karte`, visibility: true },
            { id: `${DATASET}-sta`, visibility: false },
        ]
        const style = files.styles[1] as { rules: { style: { circleFillColor: number[] } }[] }
        style.rules[0].style.circleFillColor = [0, 0, 0, 1]

        const member = extractMasterportal(files, DATASET)?.member

        expect(member?.folder).toBe('Jungbäume Rundweg')
        expect(member?.layers.map((layer) => [layer.apiRef, layer.visibility])).toEqual([
            ['karte', true],
            ['sta', false],
        ])
        expect(member?.styles).toEqual([
            {
                styleId: 'jungbaeume_bodenfeuchte',
                rules: [{ conditions: { properties: { dataStreamValue: [null, 15] } }, style: { circleFillColor: [0, 0, 0, 1] } }],
            },
        ])
        const json = JSON.stringify(member)
        expect(json).not.toContain(DATASET)
        expect(json).not.toContain('GEOSERVER_URL')
        expect(json).not.toContain('open_data')
    })

    it('reads the folder where the operator moved it, and leaves the operator\'s style out', () => {
        const files = applyMasterportal(operatorFiles(), MEMBER, DATASET)
        const tree = treeOf(files)
        const [own, operator] = tree.subjectlayer.elements
        tree.subjectlayer.elements = [{ ...operator, elements: [...operator.elements, own] }]

        const member = extractMasterportal(files, DATASET)?.member

        expect(member).toEqual(MEMBER)
        expect(member?.styles.map((style) => style.styleId)).toEqual(['jungbaeume_bodenfeuchte'])
    })

    it('reads only its own dataset when two installations show the same package', () => {
        const both = applyMasterportal(applyMasterportal(operatorFiles(), MEMBER, 'other-dataset'), MEMBER, DATASET)
        treeOf(both).subjectlayer.elements[1].name = 'Andere Installation'

        expect(extractMasterportal(both, DATASET)?.member.folder).toBe('Jungbaumbewässerung Musterbach')
        expect(extractMasterportal(both, 'other-dataset')?.member.folder).toBe('Andere Installation')
    })

    it('names what the member cannot carry', () => {
        const files = applyMasterportal(operatorFiles(), MEMBER, DATASET)
        const folder = treeOf(files).subjectlayer.elements[0]
        folder.elements = [
            { id: `${DATASET}-sta`, visibility: true, transparency: 30 },
            { id: '300', visibility: false },
        ]
        files.styles = (files.styles as { styleId: string }[]).filter((style) => style.styleId !== 'jungbaeume_bodenfeuchte')

        const extracted = extractMasterportal(files, DATASET)

        expect(extracted?.member.layers.map((layer) => layer.apiRef)).toEqual(['sta'])
        expect(extracted?.warnings).toEqual([
            'Geoportal: Bei der Ebene „Jungbäume - Bodenfeuchte“ reisen transparency aus dem Themenbaum nicht mit, nur die Sichtbarkeit.',
            'Geoportal: Die Ebene 300 im Ordner „Jungbaumbewässerung Musterbach“ gehört nicht zu diesem Datensatz und kommt nicht ins Paket.',
            `Geoportal: Der Dienst ${DATASET}-karte steht nicht im Ordner „Jungbaumbewässerung Musterbach“ und kommt nicht ins Paket.`,
            'Geoportal: Der Stil jungbaeume_bodenfeuchte fehlt in style_v3.json.',
        ])
    })

    it('finds nothing for a dataset without entries', () => {
        expect(extractMasterportal(operatorFiles(), DATASET)).toBeUndefined()
    })

    it('refuses services of the dataset that no folder shows', () => {
        const files = operatorFiles()
        files.services = [...(files.services as unknown[]), { id: `${DATASET}-sta`, name: 'Ohne Ordner', typ: 'SensorThings' }]

        expect(() => extractMasterportal(files, DATASET)).toThrow(MasterportalMemberError)
    })
})
