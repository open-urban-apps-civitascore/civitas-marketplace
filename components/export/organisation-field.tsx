'use client'

import { useEffect, useRef, useState } from 'react'

import { inputClass } from '@/components/export/metadata-form'
import { Button } from '@/components/ui/button'
import { InlineNotice } from '@/components/ui/notice'
import type { Organisation } from '@/lib/catalog/types'
import {
    composeLead,
    isFollowing,
    leadAfterPick,
    organisationNamed,
    organisationProblem,
    shownDepartment,
    similarOrganisation,
    suggestedCode,
} from '@/lib/export/organisations'

export interface OrganisationChoice {
    name: string
    /** Empty while the name is not a listed or proposed organisation. */
    code: string
}

export interface OrganisationOptions {
    listed: readonly Organisation[]
    /** Proposed in this share; pickable like listed ones. */
    proposals: readonly Organisation[]
    /** Only a new share may propose one: its catalogue entry adds it. */
    allowNew: boolean
    onPropose: (organisation: Organisation) => void
}

const host = (website?: string) => (website && URL.canParse(website) ? new URL(website).host : '')

/** One organisation from the catalogue's list, found by typing its name, or a new one proposed with the share. */
export function OrganisationField({
    id,
    label,
    value,
    options,
    required = false,
    onChange,
}: {
    id: string
    label: string
    value: OrganisationChoice
    options: OrganisationOptions
    /** Then a name must be listed or proposed; otherwise plain text stays allowed. */
    required?: boolean
    onChange: (choice: OrganisationChoice) => void
}) {
    const { listed, proposals, allowNew, onPropose } = options
    const known = [...listed, ...proposals.filter((proposal) => !listed.some((organisation) => organisation.id === proposal.id))]
    const proposal = proposals.find((organisation) => organisation.id === value.code)
    const unlinked = Boolean(value.name.trim()) && !value.code
    const similar = unlinked ? similarOrganisation(value.name, listed) : undefined
    const input = useRef<HTMLInputElement>(null)
    useEffect(() => {
        const linked = Boolean(value.code) || !value.name.trim() || !required
        input.current?.setCustomValidity(linked ? '' : 'Bitte eine Organisation aus der Liste wählen oder neu vorschlagen.')
    }, [value.code, value.name, required])

    const pick = (organisation: Organisation) => onChange({ name: organisation.name, code: organisation.id })
    const type = (text: string) => {
        const match = organisationNamed(text, known)
        onChange(match ? { name: match.name, code: match.id } : { name: text, code: '' })
    }

    return (
        <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={id}>{label}</label>
            <input ref={input} id={id} className={inputClass} list={`${id}-liste`} value={value.name} required={required} autoComplete="off" onChange={(event) => type(event.target.value)} />
            <datalist id={`${id}-liste`}>
                {known.map((organisation) => (
                    <option key={organisation.id} value={organisation.name}>
                        {host(organisation.website)}
                    </option>
                ))}
            </datalist>
            {proposal ? (
                <span className="text-xs text-muted-foreground">
                    Neu vorgeschlagen ({[proposal.id, host(proposal.website), proposal.contact?.email].filter(Boolean).join(' · ')}) - das Katalog-Team prüft sie mit dem Eintrag.
                </span>
            ) : (
                !unlinked && <span className="text-xs text-muted-foreground">Aus der Liste des Katalogs wählen.</span>
            )}
            {similar && (
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    Meinst du „{similar.name}“?
                    <Button variant="ghost" className="text-xs" onClick={() => pick(similar)}>
                        „{similar.name}“ wählen
                    </Button>
                </span>
            )}
            {unlinked && allowNew && <NewOrganisation name={value.name.trim()} listed={listed} onPropose={(organisation) => { onPropose(organisation); pick(organisation) }} onPick={pick} />}
            {unlinked && !allowNew && <span className="text-xs text-muted-foreground">Bitte eine Organisation aus der Liste wählen.</span>}
        </div>
    )
}

function NewOrganisation({ name, listed, onPropose, onPick }: { name: string; listed: readonly Organisation[]; onPropose: (organisation: Organisation) => void; onPick: (organisation: Organisation) => void }) {
    const [typedCode, setTypedCode] = useState<string>()
    const [website, setWebsite] = useState('')
    const [email, setEmail] = useState('')
    const [problem, setProblem] = useState<string>()
    const code = typedCode ?? suggestedCode(name)
    const taken = listed.find((organisation) => organisation.id === code)

    const propose = () => {
        const organisation: Organisation = { id: code, name, ...(website ? { website } : {}), contact: { email } }
        // The same rules the server and the catalogue check, so a proposal shown here is one they take.
        const found = taken ? `das Kürzel hat schon „${taken.name}“` : !email ? 'bitte eine Team-E-Mail angeben, keine persönliche Adresse' : organisationProblem(organisation)
        setProblem(found && `${found[0].toUpperCase()}${found.slice(1)}.`)
        if (!found) onPropose(organisation)
    }

    return (
        <div className="mt-1 flex flex-col gap-2 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">
                „{name}“ ist noch nicht im Katalog. Neu vorschlagen: das Katalog-Team prüft sie mit dem Eintrag, zum Beispiel ob die E-Mail zur Website gehört.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs">
                    Kürzel
                    <input className={inputClass} value={code} onChange={(event) => setTypedCode(event.target.value.toLowerCase())} />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                    Website
                    <input className={inputClass} type="url" placeholder="https://" value={website} onChange={(event) => setWebsite(event.target.value.trim())} />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                    Team-E-Mail
                    <input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value.trim())} />
                </label>
            </div>
            <span className="text-xs text-muted-foreground">Eine Adresse fürs Team, keine persönliche: die Liste ist öffentlich.</span>
            {problem && <InlineNotice tone="warn">{problem}</InlineNotice>}
            {taken && !problem && (
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    Das Kürzel hat schon „{taken.name}“.
                    <Button variant="ghost" className="text-xs" onClick={() => onPick(taken)}>
                        „{taken.name}“ wählen
                    </Button>
                </span>
            )}
            <Button className="self-start" onClick={propose}>
                Neue Organisation vorschlagen
            </Button>
        </div>
    )
}

/**
 * „Federführende Organisation“: empty means „wie Herausgeber“, which the share fills in on submit
 * (`withLeadDefault`), so a draft follows a changed Herausgeber. A department may follow the name.
 */
export function LeadOrganisationField({
    operator,
    operatorOrg,
    publisher,
    follows: mayFollow,
    options,
    onChange,
}: {
    operator: string
    operatorOrg: string
    publisher: OrganisationChoice
    /** Only in a share: in „Texte ändern“ an empty field stays empty. */
    follows: boolean
    options: OrganisationOptions
    onChange: (next: { operator: string; operatorOrg: string }) => void
}) {
    // Unticked by hand stays unticked while the field is empty, also before a Herausgeber is chosen.
    const [untickedByHand, setUntickedByHand] = useState(false)
    // The department as typed, spaces included; the lead itself holds it trimmed.
    const [typed, setTyped] = useState<string>()
    const following = isFollowing(mayFollow, untickedByHand, { operator, operatorOrg })
    const known = [...options.listed, ...options.proposals]
    const name = known.find((organisation) => organisation.id === operatorOrg)?.name
    const department = shownDepartment(operator, name, typed)

    return (
        <div className="flex flex-col gap-2 text-sm md:col-span-2">
            <span>Federführende Organisation</span>
            {mayFollow && (
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={following}
                        onChange={(event) => {
                            setUntickedByHand(!event.target.checked)
                            onChange(event.target.checked ? { operator: '', operatorOrg: '' } : { operator: publisher.name, operatorOrg: publisher.code })
                        }}
                    />
                    Wie Herausgeber{publisher.name ? `: ${publisher.name}` : ''}
                </label>
            )}
            {!following && (
                <div className="grid gap-3 md:grid-cols-2">
                    <OrganisationField
                        id="federfuehrende-organisation"
                        label="Organisation"
                        value={{ name: name ?? operator, code: operatorOrg }}
                        options={options}
                        required={mayFollow}
                        onChange={(choice) => onChange(leadAfterPick({ operatorOrg, department }, choice))}
                    />
                    <label className="flex flex-col gap-1 text-sm">
                        Abteilung (optional)
                        <input
                            className={inputClass}
                            value={department}
                            disabled={!name}
                            onChange={(event) => {
                                if (!name) return
                                setTyped(event.target.value)
                                onChange({ operator: composeLead(name, event.target.value), operatorOrg })
                            }}
                        />
                        <span className="text-xs text-muted-foreground">Zum Beispiel Umweltamt. Eine Abteilung ist keine eigene Organisation.</span>
                    </label>
                </div>
            )}
        </div>
    )
}
