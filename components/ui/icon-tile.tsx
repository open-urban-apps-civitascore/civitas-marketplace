import type { LucideIcon } from 'lucide-react'

import { TONES, type Tone } from '@/lib/ui/tones'

/**
 * The small square that says which system a card stands for.
 *
 * Server-safe on purpose (no hooks, no 'use client'): server components pass
 * the Lucide icon, a function, and a client boundary would refuse it.
 */
export function IconTile({ icon: Icon, tone }: { icon: LucideIcon; tone: Tone }) {
    return (
        <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-md ${TONES[tone]}`}>
            <Icon className="size-4" />
        </span>
    )
}
