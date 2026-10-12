import type { UseCaseProposal } from '@/lib/assistant/usecase'

/**
 * How the demo data fill a field, in words: for the plan step on demo data and
 * for the field table on the chat's plan card. Free of server imports, so the
 * card can use it in the browser.
 */
export function describeGenerator(field: UseCaseProposal['fields'][number]): string {
    const g = field.generator
    if (field.dateTime || g.kind === 'now') return 'Zeitpunkt des Sendens'
    switch (g.kind) {
        case 'station':
            return 'Kennung der Station'
        case 'stationLat':
        case 'stationLon':
            return 'Koordinate der Station'
        case 'enum':
            return `einer aus ${(g.values ?? []).join(', ')}`
        case 'constant':
            return `immer ${String(g.value)}`
        case 'sequence':
            return 'fortlaufend'
        case 'dailyProfile':
            return `${g.min ?? 0}-${g.max ?? '?'} mit Tagesspitzen`
        default:
            return `${g.min ?? 0}-${g.max ?? '?'}, schwankend`
    }
}
