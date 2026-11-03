'use client'

import { Fragment, useState } from 'react'
import { CircleCheck, CirclePlay, Database, Layers, MapIcon, Radio, SlidersHorizontal, Sparkles } from 'lucide-react'

import { Button, ExternalAnchor } from '@/components/ui/button'
import { Flow, FlowGroup, FlowHeading, FlowItem, FlowNote } from '@/components/ui/flow'
import { InlineNotice } from '@/components/ui/notice'
import { StatusPill } from '@/components/ui/status-pill'
import { adjustDemoInSimulator, type DemoInventory, type InventoryArtifact } from '@/lib/export-actions'
import type { DemoSource } from '@/lib/export/simulations'
import type { ExportSource } from '@/lib/export/sources'
import { newSimulationUiHref, simulationEditUiHref } from '@/lib/simulator/ui-links'
import { ARTIFACT_KINDS, byKind, partsCount } from '@/lib/ui/artifact-kinds'
import { datasetStatusLabel } from '@/lib/ui/dataset-status'

const UNNAMED_NOTE = 'Im Portal ohne eigenen Namen - so steht der Name auch im Paket. Vor dem Teilen im Portal umbenennen.'

/**
 * What goes into the package, shown the way the installed view shows what an
 * installation made (Ewa, 2026-10-13): one card per system, joined in the
 * order the data flows. Demo data comes first, because that is where the data
 * starts.
 *
 * The tiles stay neutral until the flow cards' colours are aligned with the
 * design system; a green "Plattform" tile next to a green "Freigegeben" would
 * make one green read as the other.
 */
export function PackageContents({
    source,
    artifacts,
    demo,
    demoExcluded,
    onToggleDemo,
    onReloadDemo,
}: {
    source: ExportSource
    artifacts: InventoryArtifact[]
    demo?: DemoInventory
    demoExcluded: ReadonlySet<string>
    onToggleDemo: (streamId: string) => void
    onReloadDemo: () => void
}) {
    const adjust = useAdjustInSimulator(source.id, onReloadDemo)
    const platform = artifacts.filter((item) => item.group !== 'map')
    const map = artifacts.filter((item) => item.group === 'map')
    // The API standards say what kind of map service comes along ("OWS"); the rows name them again.
    const standards = [...new Set(map.flatMap((item) => (item.standard ? [item.standard] : [])))]

    return (
        <Flow>
            {demo && <DemoGroup key="demo" demo={demo} excluded={demoExcluded} onToggle={onToggleDemo} onReload={onReloadDemo} adjust={adjust} />}
            <FlowGroup
                key="platform"
                icon={Layers}
                tone="neutral"
                title="Plattform"
                subtitle="CIVITAS/CORE"
                meta={platform.length ? partsCount(platform.length) : undefined}
            >
                <FlowItem
                    icon={<Database className="size-4" />}
                    kind="Datensatz"
                    name={source.name}
                    badge={
                        source.status ? (
                            source.status === 'AVAILABLE' ? (
                                <StatusPill tone="success" icon={CircleCheck}>
                                    {datasetStatusLabel(source.status)}
                                </StatusPill>
                            ) : (
                                <StatusPill tone="muted">{datasetStatusLabel(source.status)}</StatusPill>
                            )
                        ) : undefined
                    }
                />
                {/* Grouped by kind, so "which ones, and how many" reads at a glance. */}
                {byKind(platform).map(({ type, items }) => (
                    <Fragment key={type}>
                        <FlowHeading>{items.length === 1 ? ARTIFACT_KINDS[type].one : `${ARTIFACT_KINDS[type].many} (${items.length})`}</FlowHeading>
                        {items.map((item, index) => (
                            <ArtifactRow key={`${type}:${item.name}:${index}`} item={item} kindShown={false} />
                        ))}
                    </Fragment>
                ))}
                {artifacts.length === 0 && <FlowNote>Keine verbundenen Bausteine gefunden.</FlowNote>}
            </FlowGroup>
            {map.length > 0 && (
                <FlowGroup key="map" icon={MapIcon} tone="neutral" title="Karte" subtitle={standards.length ? `API: ${standards.join(', ')}` : undefined}>
                    {/* Not grouped: a layer sits under its API, which a grouping by kind would tear apart. */}
                    {map.map((item, index) => (
                        <ArtifactRow key={`map:${item.type}:${item.name}:${index}`} item={item} kindShown />
                    ))}
                </FlowGroup>
            )}
        </Flow>
    )
}

/**
 * One artifact, named as the package will name it. A name the platform did
 * not have is shown as it ships, with a note, rather than hidden: the other
 * municipality will see exactly this name. `kindShown` is off under a heading
 * that already names the kind.
 */
function ArtifactRow({ item, kindShown }: { item: InventoryArtifact; kindShown: boolean }) {
    const { one, icon: Icon } = ARTIFACT_KINDS[item.type]
    const note = [item.detail, item.unnamed ? UNNAMED_NOTE : undefined].filter(Boolean).join(' · ')
    return (
        <FlowItem
            icon={<Icon className="size-4" />}
            // An API's kind carries its standard, e.g. "API (OWS)".
            kind={kindShown ? (item.type === 'api' ? item.kind : one) : undefined}
            name={item.name}
            note={note || undefined}
            depth={item.depth}
        />
    )
}

/** „Im Simulator anpassen“ on a drafted source: which one is being put there, and what came of it. */
export interface DemoAdjust {
    onAdjust: (sourceId: string) => void
    pending?: string
    notice?: { sourceId: string; message: string; href?: string }
}

/** Puts the draft into the simulator and opens it there; on success the box reads its streams anew. */
function useAdjustInSimulator(datasetId: string, onReload: () => void): DemoAdjust {
    const [pending, setPending] = useState<string>()
    const [notice, setNotice] = useState<DemoAdjust['notice']>()
    const onAdjust = (sourceId: string) => {
        // Opened in the click: a window opened after the answer would be blocked.
        const tab = window.open('', '_blank')
        if (tab) {
            tab.opener = null
            if (tab.document.body) tab.document.body.textContent = 'Demo-Daten werden im Simulator angelegt …'
        }
        setPending(sourceId)
        setNotice(undefined)
        adjustDemoInSimulator(datasetId, sourceId)
            .then((answer) => {
                if ('error' in answer) {
                    tab?.close()
                    setNotice({ sourceId, message: answer.error })
                } else if (tab) {
                    tab.location.href = answer.href
                    onReload()
                } else {
                    setNotice({ sourceId, message: 'Im Simulator angelegt - dein Browser hat das neue Fenster blockiert.', href: answer.href })
                }
            })
            .catch(() => {
                tab?.close()
                setNotice({ sourceId, message: 'Die Anfrage an den Server ist fehlgeschlagen.' })
            })
            .finally(() => setPending(undefined))
    }
    return { onAdjust, pending, notice }
}

/** Optional demo data: the simulator's streams that feed the dataset's sources, or drafts, ticked to take them along. */
export function DemoGroup({
    demo,
    excluded,
    onToggle,
    onReload,
    adjust,
}: {
    demo: DemoInventory
    excluded: ReadonlySet<string>
    onToggle: (streamId: string) => void
    onReload: () => void
    adjust: DemoAdjust
}) {
    const usable = demo.sources.filter((source) => !source.problem)
    const ids = usable.flatMap((source) => [...source.streams.map((stream) => stream.id), ...(source.generated ? [source.generated.id] : [])])
    const chosen = ids.filter((id) => !excluded.has(id)).length
    const drafted = usable.some((source) => source.generated)

    return (
        <FlowGroup
            icon={CirclePlay}
            tone="neutral"
            title="Demo-Daten"
            subtitle="Simulator - freiwillig"
            meta={ids.length > 0 ? `${chosen} von ${ids.length} ausgewählt` : undefined}
            footer={
                <div className="flex flex-col items-start gap-1 pb-1">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        Angehakte Demo-Daten kommen ins Paket. Eine Installation startet sie für ihre eigenen Datenquellen.
                    </p>
                    <Button variant="ghost" className="text-xs" onClick={onReload}>
                        Erneut prüfen
                    </Button>
                </div>
            }
        >
            {demo.problem && (
                <FlowNote>
                    <InlineNotice tone="neutral">
                        {demo.problem}
                        {drafted && ' Die erzeugten Demo-Daten kommen trotzdem ins Paket, nur ohne Vorschau.'}
                    </InlineNotice>
                </FlowNote>
            )}
            {demo.sources.length === 0 ? (
                !demo.problem && <FlowNote>Dieser Datensatz hat keine MQTT- oder SQL-Quelle, für die der Simulator Daten erzeugen könnte.</FlowNote>
            ) : (
                demo.sources.map((source) => (
                    <DemoSourceRows
                        key={source.id}
                        source={source}
                        simulatorUi={demo.problem ? undefined : demo.simulatorUi}
                        excluded={excluded}
                        onToggle={onToggle}
                        adjust={adjust}
                    />
                ))
            )}
        </FlowGroup>
    )
}

function DemoSourceRows({
    source,
    simulatorUi,
    excluded,
    onToggle,
    adjust,
}: {
    source: DemoSource
    simulatorUi?: string
    excluded: ReadonlySet<string>
    onToggle: (streamId: string) => void
    adjust: DemoAdjust
}) {
    const transport = source.transport === 'mqtt' ? 'MQTT' : 'SQL'
    // Without a Topic the package cannot say where its streams publish: shown, but not offered.
    const blocked = source.problem === 'no-topic'
    const generated = source.generated
    const notice = adjust.notice?.sourceId === source.id ? adjust.notice : undefined
    const newStreamLink = simulatorUi && source.structureUrn && (
        <>
            {' '}
            <ExternalAnchor href={newSimulationUiHref(simulatorUi, source.structureUrn, source.id)}>Im Simulator anlegen</ExternalAnchor>
        </>
    )

    return (
        <>
            {blocked && (
                <FlowNote>
                    <InlineNotice tone="warn">
                        Keine Demo-Daten für „{source.name}“ möglich - diese Datenquelle hat im Portal noch kein Topic.
                        {source.portalHref && (
                            <>
                                {' '}
                                <ExternalAnchor href={source.portalHref}>Topic im Portal eintragen</ExternalAnchor>
                            </>
                        )}
                    </InlineNotice>
                </FlowNote>
            )}
            {source.streams.map((stream) => (
                <FlowItem
                    key={stream.id}
                    control={
                        <input
                            type="checkbox"
                            className="size-4 shrink-0 accent-primary"
                            checked={!blocked && !excluded.has(stream.id)}
                            disabled={blocked}
                            onChange={() => onToggle(stream.id)}
                        />
                    }
                    icon={<Radio className="size-4" />}
                    name={stream.label}
                    note={`für Datenquelle „${source.name}“ · ${transport}${stream.matchedBy === 'address' ? ' · über Topic oder Tabelle zugeordnet' : ''}`}
                />
            ))}
            {!blocked && source.streams.length > 0 && (!!source.sample?.length || simulatorUi) && (
                <FlowNote>
                    {!!source.sample?.length && (
                        <>
                            <p>So sehen die ersten Nachrichten von „{source.streams[0].label}“ aus:</p>
                            <SampleTable records={source.sample} />
                        </>
                    )}
                    {simulatorUi && (
                        <p className="mt-2">
                            Im Simulator bearbeiten:{' '}
                            {source.streams.map((stream, index) => (
                                <Fragment key={stream.id}>
                                    {index > 0 && ' · '}
                                    <ExternalAnchor href={simulationEditUiHref(simulatorUi, stream.id)}>{stream.label}</ExternalAnchor>
                                </Fragment>
                            ))}
                        </p>
                    )}
                </FlowNote>
            )}
            {generated && (
                <>
                    <FlowItem
                        control={
                            <input
                                type="checkbox"
                                className="size-4 shrink-0 accent-primary"
                                checked={!excluded.has(generated.id)}
                                onChange={() => onToggle(generated.id)}
                            />
                        }
                        icon={<Sparkles className="size-4" />}
                        name="Erzeugte Demo-Daten"
                        note={`für Datenquelle „${source.name}“ · ${transport} · ${generated.summary}`}
                    />
                    <FlowNote>
                        <p>Aus der Datenstruktur vorgeschlagen{source.sample?.length ? ' - so sehen die ersten Nachrichten aus:' : '.'}</p>
                        {!!source.sample?.length && <SampleTable records={source.sample} />}
                        {simulatorUi && !excluded.has(generated.id) && (
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                                <Button
                                    icon={SlidersHorizontal}
                                    className="text-xs"
                                    pending={adjust.pending === source.id}
                                    disabled={adjust.pending !== undefined}
                                    onClick={() => adjust.onAdjust(source.id)}
                                >
                                    Im Simulator anpassen
                                </Button>
                                <span>Legt sie dort ausgeschaltet an. Was du dort änderst, kommt beim Einreichen ins Paket.</span>
                            </div>
                        )}
                        {notice && (
                            <div className="mt-2">
                                <InlineNotice tone={notice.href ? 'neutral' : 'warn'}>
                                    {notice.message}
                                    {notice.href && (
                                        <>
                                            {' '}
                                            <ExternalAnchor href={notice.href}>Im Simulator öffnen</ExternalAnchor>
                                        </>
                                    )}
                                </InlineNotice>
                            </div>
                        )}
                    </FlowNote>
                </>
            )}
            {source.notGenerated && (
                <FlowNote>
                    Für „{source.name}“ gibt es noch keine Demo-Daten, und erzeugen lassen sie sich nicht: {source.notGenerated}.{newStreamLink}
                </FlowNote>
            )}
            {!blocked && source.streams.length === 0 && !generated && !source.notGenerated && (
                <FlowNote>
                    Für „{source.name}“ gibt es noch keine Demo-Daten.{newStreamLink}
                </FlowNote>
            )}
        </>
    )
}

/** Nested fields as dotted columns, as the structure names them. */
function flatten(record: Record<string, unknown>, prefix = ''): [string, unknown][] {
    return Object.entries(record).flatMap(([key, value]): [string, unknown][] =>
        value && typeof value === 'object' && !Array.isArray(value) ? flatten(value as Record<string, unknown>, `${prefix}${key}.`) : [[`${prefix}${key}`, value]],
    )
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

function cellText(value: unknown): string {
    if (typeof value === 'number') return value.toLocaleString('de-DE', { maximumFractionDigits: 2 })
    if (typeof value === 'string' && ISO_TIME.test(value)) {
        const time = new Date(value)
        if (!Number.isNaN(time.getTime())) return time.toLocaleTimeString('de-DE')
    }
    if (typeof value === 'boolean') return value ? 'ja' : 'nein'
    return typeof value === 'string' ? value : JSON.stringify(value)
}

function SampleTable({ records }: { records: Record<string, unknown>[] }) {
    const rows = records.map((record) => new Map(flatten(record)))
    const columns = [...new Set(rows.flatMap((row) => [...row.keys()]))]
    return (
        <div className="mt-1.5 overflow-x-auto rounded-md border">
            <table className="w-full text-left text-xs">
                <thead className="border-b text-muted-foreground">
                    <tr>
                        {columns.map((column) => (
                            <th key={column} scope="col" className="whitespace-nowrap px-2 py-1 font-medium">
                                {column}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={index}>
                            {columns.map((column) => (
                                <td key={column} className="whitespace-nowrap px-2 py-1 tabular-nums text-foreground">
                                    {row.has(column) ? cellText(row.get(column)) : ''}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
