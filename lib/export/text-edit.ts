import { THEME_LABELS, type Theme } from '@/lib/catalog/vocabulary'
import { METADATA_GROUPS, metadataDraft, parseKeywords, type MetadataDraft, type MetadataField } from '@/lib/export/metadata'
import type { FilledSteckbrief } from '@/lib/export/new-version'

export interface TextEditRef {
    targetKey: string
    slug: string
    version: string
}

export function textEditHref({ targetKey, slug, version }: TextEditRef): string {
    return `/export/edit?${new URLSearchParams({ target: targetKey, slug, version })}`
}

export interface TextDraft {
    displayName: string
    description: string
    /** Comma-separated. */
    keywords: string
    metadata: MetadataDraft
}

export function textDraftOf({ displayName, description, keywords, metadata }: Pick<FilledSteckbrief, 'displayName' | 'description' | 'keywords' | 'metadata'>): TextDraft {
    return { displayName, description, keywords, metadata: metadataDraft(metadata) }
}

export interface TextChange {
    /** `contact.…` marks a change of contact. */
    key: string
    label: string
    before: string
    after: string
}

function fieldValue(field: MetadataField, text: string | undefined): string {
    const value = text?.trim() ?? ''
    if (field.kind === 'list') return value.split('\n').map((item) => item.trim()).filter(Boolean).join(', ')
    return field.options?.[value] ?? value
}

const READINGS: { key: string; label: string; of: (draft: TextDraft) => string }[] = [
    { key: 'displayName', label: 'Name im Katalog', of: (draft) => draft.displayName.trim() },
    { key: 'description', label: 'Kurzbeschreibung', of: (draft) => draft.description.trim() },
    { key: 'keywords', label: 'Schlagworte', of: (draft) => parseKeywords(draft.keywords).join(', ') },
    { key: 'themes', label: 'Themengebiete', of: (draft) => draft.metadata.themes.map((theme) => THEME_LABELS[theme as Theme] ?? theme).sort().join(', ') },
    ...METADATA_GROUPS.flatMap((group) => group.fields).map((field) => ({
        key: field.path,
        label: field.label,
        of: (draft: TextDraft) => fieldValue(field, draft.metadata.fields[field.path]),
    })),
    {
        key: 'media',
        label: 'Bilder & Screenshots',
        of: (draft) => draft.metadata.media.map((item) => [item.src, item.alt, item.caption].map((text) => text.trim()).filter(Boolean).join(' - ')).filter(Boolean).join(', '),
    },
]

export function textReading(draft: TextDraft): string {
    return JSON.stringify(READINGS.map(({ of }) => of(draft)))
}

export function textChanges(before: TextDraft, after: TextDraft): TextChange[] {
    return READINGS.map(({ key, label, of }) => ({ key, label, before: of(before), after: of(after) }))
        .filter((change) => change.before !== change.after)
}
