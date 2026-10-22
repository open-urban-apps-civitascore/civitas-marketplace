import { z } from 'zod'

/**
 * The catalogue's controlled vocabularies: the closed sets of values a
 * categorical field may take, with the German labels the UI renders.
 */
export const themeSchema = z.enum([
    'umwelt-klima',
    'mobilitaet-verkehr',
    'planen-bauen',
    'tourismus-kultur',
    'verwaltung-buergerservices',
    'katastrophenschutz-sicherheit',
    'energie-netze',
    'inklusion-barrierefreiheit',
])
export type Theme = z.infer<typeof themeSchema>

export const THEME_ORDER = themeSchema.options

export const THEME_LABELS: Record<Theme, string> = {
    'umwelt-klima': 'Umwelt & Klima',
    'mobilitaet-verkehr': 'Mobilität & Verkehr',
    'planen-bauen': 'Planen, Bauen & Immobilien',
    'tourismus-kultur': 'Tourismus & Kultur',
    'verwaltung-buergerservices': 'Verwaltung & Bürgerservices',
    'katastrophenschutz-sicherheit': 'Katastrophenschutz & Sicherheit',
    'energie-netze': 'Energie & Netze',
    'inklusion-barrierefreiheit': 'Inklusion & Barrierefreiheit',
}

export const costBandSchema = z.enum(['s', 'm', 'l', 'xl'])
export const effortBandSchema = z.enum(['s', 'm', 'l'])
export type CostBand = z.infer<typeof costBandSchema>
export type EffortBand = z.infer<typeof effortBandSchema>

export const COST_BAND_LABELS: Record<CostBand, string> = {
    s: 'unter 1.000 €',
    m: 'unter 10.000 €',
    l: 'unter 100.000 €',
    xl: 'über 100.000 €',
}

export const EFFORT_BAND_LABELS: Record<EffortBand, string> = {
    s: 'unter 10 Tage',
    m: 'unter 50 Tage',
    l: 'unter 100 Tage',
}

export const COST_BAND_SHORT: Record<CostBand, string> = { s: 'S', m: 'M', l: 'L', xl: 'XL' }
export const EFFORT_BAND_SHORT: Record<EffortBand, string> = { s: 'S', m: 'M', l: 'L' }

export const useCaseStatusSchema = z.enum([
    'idee',
    'entwurf',
    'in-entwicklung',
    'prototyp',
    'produktiv',
    'review',
    'archiviert',
])
export type UseCaseStatus = z.infer<typeof useCaseStatusSchema>

export const USE_CASE_STATUS_LABELS: Record<UseCaseStatus, string> = {
    idee: 'Idee',
    entwurf: 'Entwurf',
    'in-entwicklung': 'In Entwicklung',
    prototyp: 'Prototyp',
    produktiv: 'Produktiv',
    review: 'Review',
    archiviert: 'Archiviert',
}

/** The explaining half-sentence the submission form supplies with each option. */
export const USE_CASE_STATUS_HINTS: Record<UseCaseStatus, string> = {
    idee: 'Die Idee ist beschrieben, aber noch nicht ausgearbeitet.',
    entwurf: 'Ein Konzept liegt vor, die Umsetzung hat noch nicht begonnen.',
    'in-entwicklung': 'Die Umsetzung läuft.',
    prototyp: 'Die erste Entwicklung ist umgesetzt und wird getestet.',
    produktiv: 'Im Regelbetrieb und dauerhaft in Nutzung.',
    review: 'Die Umsetzung wird überprüft oder überarbeitet.',
    archiviert: 'Nicht mehr in Betrieb.',
}

export const curationTierSchema = z.enum(['experimental', 'community', 'verified'])
export type CurationTier = z.infer<typeof curationTierSchema>

export const CURATION_TIER_LABELS: Record<CurationTier, string> = {
    experimental: 'Experimentell',
    community: 'Community',
    verified: 'Verifiziert',
}

export const CURATION_TIER_HINTS: Record<CurationTier, string> = {
    experimental: 'Formal gültig, aber noch nicht inhaltlich geprüft.',
    community: 'Gegen die Kuratierungs-Checkliste geprüft.',
    verified: 'Geprüft und mit einer festen Version gelistet.',
}

export const FIELD_LABELS = {
    themes: 'Themengebiet',
    keywords: 'Schlagworte',
    totalCost: 'Geschätzte Gesamtkosten (36 Monate)',
    status: 'Use Case Status',
    operator: 'Federführende Organisation',
    stakeholders: 'Relevante Stakeholder',
    serviceProviders: 'Dienstleister',
    stack: 'Eingesetzte Technik',
    setupCost: 'Aufbaukosten (einmalig)',
    runningCost: 'Laufende Kosten (jährlich)',
    effort: 'Ressourceneinsatz',
    funding: 'Finanzierung',
    note: 'Anmerkung zu Ressourceneinsatz',
    collaboration: 'Kooperationsbedarf',
    contact: 'Kontakt',
    reference: 'Ausführliche Beschreibung',
} as const

export const LOGIC_MODEL_STEPS = [
    {
        key: 'input',
        label: 'Input',
        gloss: 'Was hineingeht',
        hint: 'Geräte, Infrastruktur, Personal und Geld, die eingesetzt wurden.',
    },
    {
        key: 'output',
        label: 'Output',
        gloss: 'Was entsteht',
        hint: 'Das unmittelbare Ergebnis - das Produkt, das man öffnen kann.',
    },
    {
        key: 'outcome',
        label: 'Outcome',
        gloss: 'Was sich ändert',
        hint: 'Wie sich die Arbeit der beteiligten Stellen dadurch ändert.',
    },
    {
        key: 'impact',
        label: 'Impact',
        gloss: 'Was es bewirkt',
        hint: 'Welche längerfristige Wirkung in der Kommune entsteht.',
    },
] as const
