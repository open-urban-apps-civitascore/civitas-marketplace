import { FlaskConical, type LucideIcon, ShieldCheck, Users } from 'lucide-react'

import type { AddonCuration } from '@/lib/addon-catalog'

/**
 * The store's one graded trust signal, rendered identically everywhere. Colour
 * is never the only carrier: every tier has an icon and a word.
 */
const TIER: Record<AddonCuration['tier'], { label: string; icon: LucideIcon; className: string; hint: string }> = {
    verified: {
        label: 'Verifiziert',
        icon: ShieldCheck,
        className: 'bg-success/10 text-success',
        hint: 'Geprüft und mit einer festen Version gelistet.',
    },
    community: {
        label: 'Community',
        icon: Users,
        className: 'bg-primary/10 text-primary',
        hint: 'Gegen die Kuratierungs-Checkliste geprüft.',
    },
    experimental: {
        label: 'Experimentell',
        icon: FlaskConical,
        className: 'bg-warn/10 text-warn',
        hint: 'Formal gültig, aber noch nicht inhaltlich geprüft.',
    },
}

export function CurationTierBadge({ tier }: { tier: AddonCuration['tier'] }) {
    const meta = TIER[tier]
    const Icon = meta.icon
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${meta.className}`}
        >
            <Icon aria-hidden className="size-3.5" />
            {meta.label}
        </span>
    )
}

export function curationHint(tier: AddonCuration['tier']): string {
    return TIER[tier].hint
}
