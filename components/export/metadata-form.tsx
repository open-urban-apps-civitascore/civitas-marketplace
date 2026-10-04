'use client'

import { METADATA_GROUPS, type MetadataDraft } from '@/lib/export/metadata'
import { THEME_LABELS, THEME_ORDER } from '@/lib/catalog/vocabulary'

const inputClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40'

export function MetadataForm({ value, onChange }: { value: MetadataDraft; onChange: (value: MetadataDraft) => void }) {
    const changeField = (path: string, text: string) => onChange({ ...value, fields: { ...value.fields, [path]: text } })
    return <>
        <fieldset className="rounded-xl border bg-card p-5">
            <legend className="px-2 font-semibold">Themengebiete</legend>
            <div className="grid gap-3 sm:grid-cols-2">
                {THEME_ORDER.map((theme) => <label key={theme} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={value.themes.includes(theme)} onChange={(event) => onChange({ ...value, themes: event.target.checked ? [...value.themes, theme] : value.themes.filter((item) => item !== theme) })} />
                    {THEME_LABELS[theme]}
                </label>)}
            </div>
        </fieldset>
        {METADATA_GROUPS.map((group) => <fieldset key={group.title} className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2">
            <legend className="px-2 font-semibold">{group.title}</legend>
            {group.fields.map((field) => <label key={field.path} className={`flex flex-col gap-1 text-sm ${field.kind === 'multiline' ? 'md:col-span-2' : ''}`}>
                <span>{field.label}</span>
                {field.options ? <select className={inputClass} value={value.fields[field.path] ?? ''} onChange={(event) => changeField(field.path, event.target.value)}>
                    <option value="">Keine Angabe</option>
                    {Object.entries(field.options).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select> : field.kind === 'multiline' || field.kind === 'list' ? <textarea className={inputClass} rows={3} value={value.fields[field.path] ?? ''} onChange={(event) => changeField(field.path, event.target.value)} />
                    : <input className={inputClass} type={field.kind ?? 'text'} value={value.fields[field.path] ?? ''} onChange={(event) => changeField(field.path, event.target.value)} />}
                {(field.hint || field.kind === 'list') && <span className="text-xs text-muted-foreground">{field.hint ?? 'Ein Eintrag pro Zeile.'}</span>}
            </label>)}
        </fieldset>)}
        <fieldset className="flex flex-col gap-4 rounded-xl border bg-card p-5">
            <legend className="px-2 font-semibold">Bilder & Screenshots</legend>
            <p className="text-sm text-muted-foreground">HTTPS-Adresse oder Bildpfad im Paketrepository. Bilder werden hier verlinkt, nicht hochgeladen — und derzeit noch nicht auf der Detailseite angezeigt, solange sie nicht über den Marktplatz ausgeliefert werden.</p>
            {value.media.map((item, index) => <div key={index} className="grid gap-3 rounded-lg border p-4">
                {/* Required only once the row says something. An untouched row is
                    dropped on submit anyway (see draftMetadata), so marking its
                    fields required would deadlock the step for anyone who added a
                    row and changed their mind. */}
                {(['src', 'alt', 'caption'] as const).map((key) => <label key={key} className="flex flex-col gap-1 text-sm">
                    <span>{key === 'src' ? 'Bildadresse / Pfad *' : key === 'alt' ? 'Alternativtext *' : 'Bildunterschrift'}</span>
                    <input className={inputClass} value={item[key]} required={key !== 'caption' && Object.values(item).some((text) => text.trim())} onChange={(event) => onChange({ ...value, media: value.media.map((row, i) => i === index ? { ...row, [key]: event.target.value } : row) })} />
                </label>)}
                <button type="button" className="justify-self-start text-sm underline" onClick={() => onChange({ ...value, media: value.media.filter((_, i) => i !== index) })}>Bild {index + 1} entfernen</button>
            </div>)}
            <button type="button" className="self-start rounded-md border px-3 py-2 text-sm hover:bg-muted" onClick={() => onChange({ ...value, media: [...value.media, { src: '', alt: '', caption: '' }] })}>Bild hinzufügen</button>
        </fieldset>
    </>
}
