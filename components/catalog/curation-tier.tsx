import { Check, FlaskConical, type LucideIcon, ShieldCheck, Users } from 'lucide-react'

import { Disclosure } from '@/components/ui/disclosure'
import type { AddonCuration } from '@/lib/addon-catalog'
import {
    CURATION_TIER_CRITERIA,
    CURATION_TIER_HINTS,
    CURATION_TIER_LABELS,
    CURATION_TIER_REVOCABLE,
} from '@/lib/catalog/vocabulary'

type Tier = AddonCuration['tier']

/**
 * The store's one graded trust signal, rendered identically everywhere: one
 * colour per seal (design system §4.1: emerald Verifiziert, blue Community,
 * amber Experimentell), and never the colour alone - every seal has an icon
 * and a word.
 *
 * Explicit shades rather than the `success`/`warn` tokens: those are light
 * fills, and as text on white they fall below a readable contrast. These are
 * the clickdummy's AA pairs.
 */
const TIER: Record<Tier, { icon: LucideIcon; text: string; badge: string }> = {
    verified: {
        icon: ShieldCheck,
        text: 'text-emerald-700 dark:text-emerald-400',
        badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    },
    community: {
        icon: Users,
        text: 'text-blue-700 dark:text-blue-400',
        badge: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
    },
    experimental: {
        icon: FlaskConical,
        text: 'text-amber-800 dark:text-amber-400',
        badge: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
    },
}

/** The seal as a filled badge, under a title. */
export function CurationTierBadge({ tier }: { tier: Tier }) {
    const { icon: Icon, badge } = TIER[tier]
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${badge}`}>
            <Icon aria-hidden className="size-3.5" />
            {CURATION_TIER_LABELS[tier]}
        </span>
    )
}

/** The seal as icon and coloured word, for the footer of a card. */
export function TierStatus({ tier }: { tier: Tier }) {
    const { icon: Icon, text } = TIER[tier]
    return (
        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${text}`}>
            <Icon aria-hidden className="size-4 shrink-0" />
            {CURATION_TIER_LABELS[tier]}
        </span>
    )
}

/**
 * The seal with what it stands for one click away: the criteria make the
 * badge checkable for the people who sign off (clickdummy, `TierExplainer`).
 */
export function TierExplainer({ tier, notes }: { tier: Tier; notes?: string }) {
    return (
        <div>
            <CurationTierBadge tier={tier} />
            <Disclosure className="mt-2" summary="Was bedeutet dieses Siegel?">
                <div className="rounded-md bg-muted/50 p-3 text-xs">
                    <p className="text-muted-foreground">{CURATION_TIER_HINTS[tier]}</p>
                    <ul className="mt-2 flex flex-col gap-1">
                        {CURATION_TIER_CRITERIA[tier].map((criterion) => (
                            <li key={criterion} className="flex items-start gap-1.5 text-foreground">
                                <Check aria-hidden className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                                {criterion}
                            </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-muted-foreground">{CURATION_TIER_REVOCABLE}</p>
                </div>
            </Disclosure>
            {/* What the reviewer wrote about this entry, beyond the seal's general meaning. */}
            {notes && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{notes}</p>}
        </div>
    )
}

export function curationHint(tier: Tier): string {
    return CURATION_TIER_HINTS[tier]
}
