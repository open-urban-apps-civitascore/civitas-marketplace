import { ArrowRightLeft, Braces, Globe, HardDrive, MapPin, Palette, Plug, Workflow, type LucideIcon } from 'lucide-react'

import type { InventoryArtifact } from '@/lib/export-actions'

type ArtifactType = InventoryArtifact['type']

/**
 * Each kind of thing a dataset is built from: its German name, its icon and
 * its place in the data flow. One table, so every list of artifacts names and
 * orders them the same way. Kinds are neutral facts - never coloured.
 */
export const ARTIFACT_KINDS: Record<ArtifactType, { one: string; many: string; icon: LucideIcon; order: number }> = {
    source: { one: 'Datenquelle', many: 'Datenquellen', icon: Plug, order: 1 },
    mapping: { one: 'Mapping', many: 'Mappings', icon: ArrowRightLeft, order: 2 },
    structure: { one: 'Datenstruktur', many: 'Datenstrukturen', icon: Braces, order: 3 },
    pipeline: { one: 'Pipeline', many: 'Pipelines', icon: Workflow, order: 4 },
    sink: { one: 'Datensenke', many: 'Datensenken', icon: HardDrive, order: 5 },
    api: { one: 'API', many: 'APIs', icon: Globe, order: 6 },
    layer: { one: 'Kartenebene', many: 'Kartenebenen', icon: MapPin, order: 7 },
    style: { one: 'Stil', many: 'Stile', icon: Palette, order: 8 },
}

/**
 * The platform's artifacts in the order the data passes them: where it comes
 * from, how it is converted, into what shape, how it is moved, where it lands
 * (Ewa's plan, 2026-10-13). Stable, so artifacts of one kind keep the
 * platform's order.
 */
export function inFlowOrder<T extends Pick<InventoryArtifact, 'type'>>(artifacts: T[]): T[] {
    return [...artifacts].sort((a, b) => ARTIFACT_KINDS[a.type].order - ARTIFACT_KINDS[b.type].order)
}

/** The artifacts in flow order, one group per kind present. */
export function byKind<T extends Pick<InventoryArtifact, 'type'>>(artifacts: T[]): { type: ArtifactType; items: T[] }[] {
    const groups: { type: ArtifactType; items: T[] }[] = []
    for (const artifact of inFlowOrder(artifacts)) {
        const last = groups.at(-1)
        if (last?.type === artifact.type) last.items.push(artifact)
        else groups.push({ type: artifact.type, items: [artifact] })
    }
    return groups
}

/** "1 Baustein", "6 Bausteine". */
export function partsCount(count: number): string {
    return count === 1 ? '1 Baustein' : `${count} Bausteine`
}
