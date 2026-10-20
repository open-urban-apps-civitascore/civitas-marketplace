import { describe, expect, it } from 'vitest'

import {
    HISTORY_KEY,
    parseWizardAddress,
    reachableStep,
    resumeHref,
    stepsBack,
    trailOf,
    wizardHref,
    wizardSearch,
    type WizardAddress,
} from '@/lib/export/wizard-address'

const parse = (query: string) => parseWizardAddress(new URLSearchParams(query))

describe('the wizard’s addresses', () => {
    it('reads the dataset, the step and whether to continue', () => {
        expect(parse('')).toEqual({ step: 1 })
        expect(parse('source=dataset:ds-1')).toEqual({ datasetId: 'ds-1', step: 1 })
        expect(parse('source=dataset%3Ads-1&step=steckbrief')).toEqual({ datasetId: 'ds-1', step: 2 })
        expect(parse('source=dataset:ds-1&step=vorschau')).toEqual({ datasetId: 'ds-1', step: 3 })
        expect(parse('source=dataset:ds-1&resume=1')).toEqual({ datasetId: 'ds-1', step: 1, resume: true })
    })

    it('takes what it does not know for „Auswählen“ without a choice, never for an error', () => {
        expect(parse('source=structure:s-1&step=vorschau')).toEqual({ step: 3 })
        expect(parse('source=dataset:&step=steckbrief')).toEqual({ step: 2 })
        expect(parse('source=ds-1')).toEqual({ step: 1 })
        expect(parse('source=dataset:ds-1&step=3')).toEqual({ datasetId: 'ds-1', step: 1 })
        expect(parse('source=dataset:ds-1&resume=yes')).toEqual({ datasetId: 'ds-1', step: 1 })
    })

    it('writes each address in one spelling, the colon readable and the id encoded', () => {
        expect(wizardHref({ step: 1 })).toBe('/export/new')
        expect(wizardHref({ step: 3 })).toBe('/export/new')
        expect(wizardHref({ datasetId: 'ds-1', step: 1 })).toBe('/export/new?source=dataset:ds-1')
        expect(wizardHref({ datasetId: 'ds-1', step: 1, resume: true })).toBe('/export/new?source=dataset:ds-1&resume=1')
        expect(wizardHref({ datasetId: 'ds-1', step: 2, resume: true })).toBe('/export/new?source=dataset:ds-1&step=steckbrief')
        expect(wizardHref({ datasetId: 'ds 1/ä', step: 3 })).toBe('/export/new?source=dataset:ds%201%2F%C3%A4&step=vorschau')
    })

    it('reads back what it writes', () => {
        const addresses: WizardAddress[] = [
            { step: 1 },
            { datasetId: 'ds-1', step: 1 },
            { datasetId: 'ds-1', step: 1, resume: true },
            { datasetId: 'a b&c', step: 2 },
            { datasetId: 'ds-1', step: 3 },
        ]
        for (const address of addresses) expect(parse(wizardSearch(address))).toEqual(address)
    })

    it('leads „Weitermachen“ back to the step a started share was saved at, continued', () => {
        expect(resumeHref({ datasetId: 'ds-1', step: 2 })).toBe('/export/new?source=dataset:ds-1&step=steckbrief')
        expect(resumeHref({ datasetId: 'ds-1', step: 1 })).toBe('/export/new?source=dataset:ds-1&resume=1')
    })
})

describe('the step an address opens', () => {
    const known = { datasetKnown: true, steckbrief: true }

    it('opens the step asked for when the person may be on it', () => {
        expect(reachableStep(1, known)).toBe(1)
        expect(reachableStep(2, known)).toBe(2)
        expect(reachableStep(3, known)).toBe(3)
        expect(reachableStep(2, { datasetKnown: true, steckbrief: false })).toBe(2)
        expect(reachableStep(3, { ...known, ownStructure: true })).toBe(3)
    })

    it('opens the furthest step allowed otherwise', () => {
        // No dataset, or one this person cannot share from here: „Auswählen“.
        expect(reachableStep(3, { datasetKnown: false, steckbrief: true })).toBe(1)
        expect(reachableStep(2, { datasetKnown: false, steckbrief: false })).toBe(1)
        // The preview without a Steckbrief to make it from: the Steckbrief.
        expect(reachableStep(3, { datasetKnown: true, steckbrief: false })).toBe(2)
        // No data structure of its own: the package check would refuse it, so „Auswählen“ says why.
        expect(reachableStep(2, { ...known, ownStructure: false })).toBe(1)
        expect(reachableStep(3, { ...known, ownStructure: false })).toBe(1)
    })

    it('does not hold the person back while the content is still read', () => {
        expect(reachableStep(3, { ...known, ownStructure: undefined })).toBe(3)
    })
})

describe('going back through history', () => {
    const one = wizardSearch({ datasetId: 'ds-1', step: 1, resume: true })
    const two = wizardSearch({ datasetId: 'ds-1', step: 2 })

    it('reads the trail the wizard keeps, and nothing else', () => {
        expect(trailOf({ [HISTORY_KEY]: { trail: [one, two] }, __NA: true })).toEqual([one, two])
        expect(trailOf(null)).toEqual([])
        expect(trailOf({ __NA: true })).toEqual([])
        expect(trailOf({ [HISTORY_KEY]: { trail: [one, 3] } })).toEqual([])
        expect(trailOf({ [HISTORY_KEY]: 'x' })).toEqual([])
    })

    it('counts the entries back to an earlier step of the same dataset', () => {
        // On the preview, reached through „Auswählen“ and the Steckbrief.
        expect(stepsBack([one, two], { datasetId: 'ds-1', step: 2 })).toBe(1)
        expect(stepsBack([one, two], { datasetId: 'ds-1', step: 1 })).toBe(2)
    })

    it('finds none when the wizard was entered at a later step, or for another dataset', () => {
        expect(stepsBack([], { datasetId: 'ds-1', step: 1 })).toBeUndefined()
        expect(stepsBack([two], { datasetId: 'ds-1', step: 1 })).toBeUndefined()
        expect(stepsBack([one, two], { datasetId: 'ds-2', step: 1 })).toBeUndefined()
    })
})
