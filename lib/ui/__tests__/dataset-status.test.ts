import { describe, expect, it } from 'vitest'

import { datasetStatusLabel } from '@/lib/ui/dataset-status'

describe('datasetStatusLabel', () => {
    it('names a status in the portal’s words', () => {
        expect(datasetStatusLabel('AVAILABLE')).toBe('Freigegeben')
        expect(datasetStatusLabel('DRAFT')).toBe('Entwurf')
    })

    it('lets a running operation say more than the status it will end in', () => {
        expect(datasetStatusLabel('AVAILABLE', 'CREATE')).toBe('Wird freigegeben …')
    })

    it('falls back to the raw value for what it does not know', () => {
        expect(datasetStatusLabel('ARCHIVED')).toBe('ARCHIVED')
        expect(datasetStatusLabel('DRAFT', 'SOMETHING')).toBe('Entwurf')
    })
})
