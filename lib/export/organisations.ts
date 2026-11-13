import type { z } from 'zod'

import { ADMIN_PREFIX } from '@/lib/catalog/organisations'
import { organisationSchema } from '@/lib/catalog/schema'
import type { Organisation } from '@/lib/catalog/types'
import { compactLetters } from '@/lib/export/names'

const PROBLEMS: Record<string, string> = {
    id: 'das Kürzel braucht 2 bis 40 Kleinbuchstaben oder Ziffern',
    name: 'der Name fehlt',
    website: 'die Website braucht eine https-Adresse',
    email: 'die Team-E-Mail ist ungültig',
}

function problemOf(error: z.ZodError): string {
    const at = error.issues[0]?.path.at(-1)
    return (typeof at === 'string' && PROBLEMS[at]) || 'die Angaben sind unvollständig'
}

/** What is wrong with a new organisation, by the catalogue's rules; undefined when nothing is. */
export function organisationProblem(row: unknown): string | undefined {
    const parsed = organisationSchema.safeParse(row)
    return parsed.success ? undefined : problemOf(parsed.error)
}

/** New organisations from the form; a string is the error. */
export function parseOrganisationProposals(raw: string): Organisation[] | string {
    if (!raw) return []
    let rows: unknown
    try {
        rows = JSON.parse(raw)
    } catch {
        rows = undefined
    }
    if (!Array.isArray(rows) || rows.length > 4) return 'Neue Organisation: die Angaben sind ungültig - bitte die Seite neu laden.'
    const proposals: Organisation[] = []
    for (const row of rows) {
        const parsed = organisationSchema.safeParse(row)
        if (!parsed.success) return `Neue Organisation: ${problemOf(parsed.error)}.`
        proposals.push(parsed.data)
    }
    return proposals
}

/** The listed organisation with exactly this name, ignoring case. */
export function organisationNamed(name: string, listed: readonly Organisation[]): Organisation | undefined {
    const wanted = name.trim().toLowerCase()
    return wanted ? listed.find((organisation) => organisation.name.toLowerCase() === wanted) : undefined
}

interface Named {
    maintainer: string
    maintainerOrg?: string
    metadata?: { implementation?: { operator?: string; operatorOrg?: string } }
    organisations?: Organisation[]
}

/**
 * The catalogue's own rules, checked before anything is proposed: a code names
 * a listed or a proposed organisation, and the text beside it is that one's name.
 * Returns the proposals still needed, or the problem.
 */
export function checkOrganisations(options: Named, listed: readonly Organisation[]): Organisation[] | string {
    const proposed = (options.organisations ?? []).filter((organisation) => !listed.some((known) => known.id === organisation.id))
    const nameOf = (code: string) => [...listed, ...proposed].find((organisation) => organisation.id === code)?.name
    const { maintainerOrg } = options
    // Without a list (a catalogue before 4.3.0) the name can only be text.
    if (!maintainerOrg && listed.length) return 'Herausgeber: bitte eine Organisation aus der Liste wählen oder neu vorschlagen.'
    if (maintainerOrg) {
        const name = nameOf(maintainerOrg)
        if (!name) return 'Herausgeber: diese Organisation ist nicht im Katalog. Bitte aus der Liste wählen oder neu vorschlagen.'
        if (options.maintainer !== name) return `Herausgeber: die gewählte Organisation heißt „${name}“.`
    }
    const lead = options.metadata?.implementation
    if (lead?.operatorOrg) {
        const name = nameOf(lead.operatorOrg)
        if (!name) return 'Federführende Organisation: diese Organisation ist nicht im Katalog. Bitte aus der Liste wählen oder neu vorschlagen.'
        if (!lead.operator?.startsWith(name)) return `Federführende Organisation: der Eintrag muss mit „${name}“ beginnen.`
    }
    const used = new Set([maintainerOrg, lead?.operatorOrg])
    return proposed.filter((organisation) => used.has(organisation.id))
}

/** „Wie Herausgeber“: an empty lead organisation is the publisher, filled in when the share is sent. */
export function withLeadDefault(metadata: Record<string, unknown>, publisher: { maintainer: string; maintainerOrg: string }): Record<string, unknown> {
    const implementation = (metadata.implementation ?? {}) as Record<string, unknown>
    const name = publisher.maintainer.trim()
    if (implementation.operator || implementation.operatorOrg || !name) return metadata
    return { ...metadata, implementation: { ...implementation, operator: name, ...(publisher.maintainerOrg ? { operatorOrg: publisher.maintainerOrg } : {}) } }
}

/** The box „Wie Herausgeber“: ticked while the lead is empty, unless it was unticked by hand. */
export function isFollowing(mayFollow: boolean, untickedByHand: boolean, lead: { operator: string; operatorOrg: string }): boolean {
    return mayFollow && !untickedByHand && !lead.operator && !lead.operatorOrg
}

/** „Stadt Musterhausen - Umweltamt“: the organisation's name, then the department if there is one. */
export function composeLead(name: string, department: string): string {
    return department.trim() ? `${name} - ${department.trim()}` : name
}

/** The department after the organisation's name, without the dash. */
export function departmentOf(operator: string, name: string | undefined): string {
    return name && operator.startsWith(name) ? operator.slice(name.length).replace(/^\s*[-–]\s*/, '') : ''
}

/** What the department field shows: as typed, spaces included, while that still makes the lead. */
export function shownDepartment(operator: string, name: string | undefined, typed: string | undefined): string {
    if (!name) return ''
    return typed !== undefined && composeLead(name, typed) === operator ? typed : departmentOf(operator, name)
}

/** The lead after picking an organisation: a department stays only with the same organisation. */
export function leadAfterPick(
    current: { operatorOrg: string; department: string },
    choice: { name: string; code: string },
): { operator: string; operatorOrg: string } {
    if (!choice.code) return { operator: choice.name, operatorOrg: '' }
    return { operator: composeLead(choice.name, choice.code === current.operatorOrg ? current.department : ''), operatorOrg: choice.code }
}

/** As the catalogue writes codes: „Stadt Musterhausen“ → `musterhausen`. Empty when nothing fits. */
export function suggestedCode(name: string): string {
    const code = compactLetters(name.replace(ADMIN_PREFIX, '').trim() || name).slice(0, 40)
    return code.length >= 2 ? code : ''
}

/** A listed organisation the typed name probably means, for „Meinst du …?“. */
export function similarOrganisation(name: string, listed: readonly Organisation[]): Organisation | undefined {
    const typed = suggestedCode(name)
    if (typed.length < 3) return undefined
    return listed.find((organisation) => {
        const known = suggestedCode(organisation.name)
        if (organisation.id === typed || known === typed) return true
        // A short code is part of too many names to mean anything.
        return known.length >= 4 && typed.length >= 4 && (known.includes(typed) || typed.includes(known))
    })
}
