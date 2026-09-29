import { FlaskConical, type LucideIcon, ShieldCheck, Users } from 'lucide-react'

import type { AddonCuration } from '@/lib/addon-catalog'
import { CURATION_TIER_HINTS, CURATION_TIER_LABELS } from '@/lib/catalog/vocabulary'

/**
 * The store's one graded trust signal, rendered identically everywhere. Colour
 * is never the only carrier: every tier has an icon and a word.
 */
const TIER: Record<AddonCuration['tier'], { icon: LucideIcon; className: string }> = {
    verified: { icon: ShieldCheck, className: 'bg-success/10 text-success' },
    community: { icon: Users, className: 'bg-primary/10 text-primary' },
    experimental: { icon: FlaskConical, className: 'bg-warn/10 text-warn' },
}

export function CurationTierBadge({ tier }: { tier: AddonCuration['tier'] }) {
    const meta = TIER[tier]
    const Icon = meta.icon
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${meta.className}`}
        >
            <Icon aria-hidden className="size-3.5" />
            {CURATION_TIER_LABELS[tier]}
        </span>
    )
}

export function curationHint(tier: AddonCuration['tier']): string {
    return CURATION_TIER_HINTS[tier]
}
