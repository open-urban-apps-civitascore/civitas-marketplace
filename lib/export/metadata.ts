import { z } from 'zod'
import { pinnedRowObject } from '@/lib/catalog/schema'
import {
    COST_BAND_LABELS, EFFORT_BAND_LABELS, FIELD_LABELS, LOGIC_MODEL_STEPS,
    USE_CASE_STATUS_LABELS,
} from '@/lib/catalog/vocabulary'

// Author-owned fields only: a submission cannot award itself a review or choose a commit pin.
export const exportMetadataSchema = pinnedRowObject.pick({
    themes: true, contact: true, media: true, implementation: true,
}).strict()
export type ExportMetadata = z.infer<typeof exportMetadataSchema>

export interface MetadataField {
    path: string
    label: string
    kind?: 'multiline' | 'list' | 'email' | 'url'
    options?: Record<string, string>
    hint?: string
}
export const METADATA_GROUPS: { title: string; fields: MetadataField[] }[] = [
    { title: 'Umsetzung & Beteiligte', fields: [
        { path: 'implementation.status', label: FIELD_LABELS.status, options: USE_CASE_STATUS_LABELS },
        { path: 'implementation.operator', label: FIELD_LABELS.operator },
        { path: 'implementation.parties.stakeholders', label: FIELD_LABELS.stakeholders, kind: 'list' },
        { path: 'implementation.parties.serviceProviders', label: FIELD_LABELS.serviceProviders, kind: 'list' },
        { path: 'implementation.stack', label: FIELD_LABELS.stack, kind: 'list' },
    ] },
    { title: 'Kontakt', fields: [
        { path: 'contact.name', label: 'Name / Kontaktstelle' },
        { path: 'contact.role', label: 'Rolle' },
        { path: 'contact.email', label: 'E-Mail', kind: 'email' },
        { path: 'contact.url', label: 'Kontaktseite', kind: 'url', hint: 'HTTPS-Adresse. Ein Kontakt braucht eine E-Mail oder eine Kontaktseite.' },
    ] },
    { title: 'Kosten & Ressourcen', fields: [
        { path: 'implementation.resources.totalCost', label: FIELD_LABELS.totalCost, options: COST_BAND_LABELS, hint: 'Gesamtkosten über 36 Monate — die Frage aus dem CIVITAS-Connect-Formular. Enthält die laufenden Kosten bereits; nicht zusätzlich unter „Aufbaukosten" eintragen.' },
        { path: 'implementation.resources.setupCost', label: FIELD_LABELS.setupCost, options: COST_BAND_LABELS },
        { path: 'implementation.resources.runningCost', label: FIELD_LABELS.runningCost, options: COST_BAND_LABELS },
        { path: 'implementation.resources.effort', label: FIELD_LABELS.effort, options: EFFORT_BAND_LABELS },
        { path: 'implementation.resources.funding', label: FIELD_LABELS.funding },
        { path: 'implementation.resources.note', label: FIELD_LABELS.note, kind: 'multiline' },
    ] },
    { title: 'Wirkungslogik', fields: LOGIC_MODEL_STEPS.map((step) => ({
        path: `implementation.logicModel.${step.key}`, label: `${step.label} — ${step.gloss}`, hint: step.hint, kind: 'multiline',
    })) },
    { title: 'Kooperation & Referenz', fields: [
        { path: 'implementation.collaboration.wanted', label: FIELD_LABELS.collaboration, options: { true: 'Partner gesucht', false: 'Aktuell kein Bedarf' } },
        { path: 'implementation.collaboration.seeking', label: 'Gesuchte Unterstützung', kind: 'multiline' },
        { path: 'implementation.reference.url', label: FIELD_LABELS.reference, kind: 'url', hint: 'HTTPS-Adresse' },
        { path: 'implementation.reference.source', label: 'Quelle / Sammlung' },
    ] },
]
export interface MetadataDraft {
    fields: Record<string, string>
    themes: string[]
    media: { src: string; alt: string; caption: string }[]
}
export function metadataDraft(metadata: ExportMetadata = {}): MetadataDraft {
    const fields: Record<string, string> = {}
    for (const field of METADATA_GROUPS.flatMap((group) => group.fields)) {
        let value: unknown = metadata
        for (const part of field.path.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined
        fields[field.path] = Array.isArray(value) ? value.join('\n') : value === undefined ? '' : String(value)
    }
    return { fields, themes: metadata.themes ?? [], media: (metadata.media ?? []).map((item) => ({ ...item, caption: item.caption ?? '' })) }
}
/** Keep partial blocks so validation can explain a missing contact channel or image alt text. */
export function draftMetadata(draft: MetadataDraft): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    if (draft.themes.length) result.themes = draft.themes
    for (const field of METADATA_GROUPS.flatMap((group) => group.fields)) {
        const text = draft.fields[field.path]?.trim()
        if (!text) continue
        const parts = field.path.split('.')
        const leaf = parts.pop()!
        let node = result
        for (const part of parts) node = (node[part] ??= {}) as Record<string, unknown>
        node[leaf] = field.kind === 'list' ? text.split('\n').map((v) => v.trim()).filter(Boolean)
            : field.path.endsWith('.wanted') ? text === 'true' : text
    }
    const media = draft.media.filter((item) => Object.values(item).some((v) => v.trim())).map((item) => ({
        src: item.src.trim(), alt: item.alt.trim(), ...(item.caption.trim() ? { caption: item.caption.trim() } : {}),
    }))
    if (media.length) result.media = media
    return result
}
export function parseExportMetadata(raw: string): { data: ExportMetadata; error?: never } | { error: string; data?: never } {
    try {
        if (raw.length > 100_000) return { error: 'Katalogangaben sind zu lang (maximal 100.000 Zeichen).' }
        const result = exportMetadataSchema.safeParse(JSON.parse(raw || '{}'))
        if (result.success) return { data: result.data }
        return { error: result.error.issues.map((issue) => {
            const path = issue.path.join('.')
            const label = METADATA_GROUPS.flatMap((group) => group.fields).find((field) => field.path === path)?.label ?? path
            return `${label || 'Katalogangaben'}: ${issue.message}`
        }).join('\n') }
    } catch {
        return { error: 'Katalogangaben sind kein gültiges JSON.' }
    }
}
