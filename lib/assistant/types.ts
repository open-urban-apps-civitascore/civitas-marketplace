import type { StructureProposal } from '@/lib/assistant/proposal'
import type { PlanStep, UseCaseProposal } from '@/lib/assistant/usecase'

/**
 * What the assistant's tools hand to the chat. Shared by the agent (server) and
 * the chat (client); nothing here may import server code.
 */

/** A generated use case, stored and ready for the marketplace's install dialog. */
export interface UseCasePlan {
    /** `assistant:<key>`: the id the install dialog sends, answered by the assistant's store. */
    entryId: string
    title: string
    version: string
    proposal: UseCaseProposal
    steps: PlanStep[]
}

export interface Recommendation {
    id: string
    type: 'usecase' | 'datastructure'
    title: string
    description: string
    /** The entry's page in the marketplace, built from its id, never by the model. */
    href: string
    fit: 'passt' | 'teilweise'
    reason: string
}

type Failure = { ok: false; error: string }

export type UseCaseToolOutput = { ok: true; reply: string; plan: UseCasePlan } | Failure
export type StructureToolOutput = { ok: true; reply: string; proposal: StructureProposal } | Failure
export type RecommendationToolOutput = { ok: true; reply: string; recommendation: Recommendation } | Failure

/** The tools that end a turn with a card for the person to act on. */
export const FINAL_TOOLS = ['use_case_vorschlagen', 'datenstruktur_vorschlagen', 'katalog_empfehlen'] as const

/** German labels for the read tools, shown while and after the assistant looks something up. */
export const READ_TOOL_LABELS: Record<string, string> = {
    katalog_eintrag_lesen: 'Katalog-Eintrag',
    installationen_auflisten: 'Installationen',
    datenpools_auflisten: 'Datenpools',
    datensaetze_auflisten: 'Datensätze',
    datenstrukturen_der_instanz: 'Datenstrukturen der Instanz',
}
