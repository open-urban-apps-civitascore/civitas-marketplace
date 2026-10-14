'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

import {
    activeFacetCount,
    baseEntriesForFacet,
    facetMode,
    facetOptionCounts,
    facetOptions,
    isUsefulFacet,
    type CatalogFilterState,
    type FacetDef,
} from '@/lib/catalog/facets'
import { cn } from '@/lib/utils'

export type { CatalogFilterState } from '@/lib/catalog/facets'

interface CatalogFiltersProps<T> {
    value: CatalogFilterState
    onChange: (next: CatalogFilterState) => void
    facets: FacetDef<T>[]
    entries: T[]
    /** Search index + key, so option counts can respect the active search. */
    searchIndex: Map<string, string>
    keyOf: (entry: T) => string
    searchPlaceholder?: string
}

/**
 * The filter bar of a catalogue, ported from the clickdummy
 * (components/catalog/catalog-filters.tsx). Its sort dropdown stayed behind:
 * it orders by dates this catalogue does not carry yet.
 *
 * Every facet is a COLLAPSED dropdown, not an expanded pill row — the pattern
 * every large shop converged on, and the fix for the version this replaces:
 * ten stacked pill rows pushed the first result ~400px down the page.
 *
 * Selection is MULTI by default (`FacetDef.mode`), because the questions people
 * ask are "Umwelt or Mobilität", not "exactly Umwelt". Ordinal facets (cost,
 * effort) take one value read as a ceiling; toggles are on/off.
 *
 * Option counts are computed against everything EXCEPT the facet's own
 * selection — see `baseEntriesForFacet`. Counting over the whole catalog made
 * the numbers lie as soon as a second filter was active.
 */
export function CatalogFilters<T>({
    value,
    onChange,
    facets,
    entries,
    searchIndex,
    keyOf,
    searchPlaceholder = 'Suchen …',
}: CatalogFiltersProps<T>) {
    const [openFacet, setOpenFacet] = useState<string | null>(null)

    const usable = useMemo(
        () =>
            facets
                .filter((facet) => isUsefulFacet(facet, entries))
                .sort((a, b) => Number(a.group === 'more') - Number(b.group === 'more')),
        [facets, entries],
    )

    const active = activeFacetCount(value.facets)
    const hasQuery = value.search.trim().length > 0

    const setFacetValues = (id: string, next: string[]) =>
        onChange({ ...value, facets: { ...value.facets, [id]: next } })

    return (
        <div className='flex flex-wrap items-center gap-2'>
            <label className='relative block min-w-0 flex-1 basis-64'>
                <Search className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
                <input
                    type='search'
                    value={value.search}
                    onChange={(event) => onChange({ ...value, search: event.target.value })}
                    placeholder={searchPlaceholder}
                    className='h-10 w-full rounded-lg border bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'
                />
            </label>

            {usable.map((facet) => (
                <FacetDropdown
                    key={facet.id}
                    facet={facet}
                    allEntries={entries}
                    facets={usable}
                    state={value}
                    searchIndex={searchIndex}
                    keyOf={keyOf}
                    open={openFacet === facet.id}
                    onOpenChange={(next) => setOpenFacet(next ? facet.id : null)}
                    onChangeValues={(next, close) => {
                        setFacetValues(facet.id, next)
                        if (close) setOpenFacet(null)
                    }}
                />
            ))}

            {active > 0 || hasQuery ? (
                <button
                    type='button'
                    onClick={() => onChange({ search: '', facets: {} })}
                    className='inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground'
                >
                    <X className='size-3.5' />
                    Zurücksetzen
                </button>
            ) : null}
        </div>
    )
}

function FacetDropdown<T>({
    facet,
    allEntries,
    facets,
    state,
    searchIndex,
    keyOf,
    open,
    onOpenChange,
    onChangeValues,
}: {
    facet: FacetDef<T>
    allEntries: T[]
    facets: FacetDef<T>[]
    state: CatalogFilterState
    searchIndex: Map<string, string>
    keyOf: (entry: T) => string
    open: boolean
    onOpenChange: (open: boolean) => void
    /** `close` is false for multi-select, so several values can be picked. */
    onChangeValues: (next: string[], close: boolean) => void
}) {
    const { containerRef, triggerRef } = useDismiss(open, onOpenChange)
    const panelId = useId()

    const mode = facetMode(facet)
    const selected = state.facets[facet.id] ?? []
    const isActive = selected.length > 0
    const labelOf = (option: string) => facet.labelOf?.(option) ?? option

    // Counts reflect the other active filters, not the whole catalog.
    const base = useMemo(
        () =>
            baseEntriesForFacet({
                entries: allEntries,
                facets,
                state,
                index: searchIndex,
                keyOf,
                exceptFacetId: facet.id,
            }),
        [allEntries, facets, state, searchIndex, keyOf, facet.id],
    )
    const options = useMemo(() => facetOptions(facet, allEntries), [facet, allEntries])
    const counts = useMemo(() => facetOptionCounts(facet, base, options), [facet, base, options])

    const toggle = (option: string) => {
        if (mode === 'multi') {
            const next = selected.includes(option)
                ? selected.filter((value) => value !== option)
                : [...selected, option]
            // Stay open: picking several values is the point of a multi facet.
            onChangeValues(next, false)
            return
        }
        // ordinal and toggle hold a single value; re-picking it clears.
        onChangeValues(selected.includes(option) ? [] : [option], true)
    }

    // The button always shows the FACET NAME, never the chosen value (Ewa,
    // 2026-09-23): a label that mutates into its own value makes the bar hard to
    // scan and every button change width as you filter. How many values are
    // selected goes in a badge instead.
    //
    // A toggle is exempt: its count is always 1, and "(1)" on a yes/no control
    // reads as "one of what?" — the active tint already says it is on.
    const showCount = isActive && mode !== 'toggle'

    return (
        <div ref={containerRef} className='relative shrink-0'>
            <button
                ref={triggerRef}
                type='button'
                aria-expanded={open}
                aria-haspopup='listbox'
                aria-controls={open ? panelId : undefined}
                onClick={() => onOpenChange(!open)}
                className={cn(
                    'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
                    isActive
                        ? 'border-primary/50 bg-primary/5 font-medium text-foreground'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
            >
                <span className='max-w-[14rem] truncate'>{facet.label}</span>
                {showCount ? (
                    <span className='grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold tabular-nums text-primary-foreground'>
                        {selected.length}
                    </span>
                ) : null}
                {isActive ? (
                    <span
                        role='button'
                        tabIndex={0}
                        aria-label={`${facet.label} zurücksetzen`}
                        onClick={(event) => {
                            event.stopPropagation()
                            onChangeValues([], true)
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                event.stopPropagation()
                                onChangeValues([], true)
                            }
                        }}
                        className='-mr-1 grid size-5 place-items-center rounded hover:bg-primary/10'
                    >
                        <X className='size-3.5' />
                    </span>
                ) : (
                    <ChevronDown
                        aria-hidden
                        className={cn('size-4 transition-transform', open && 'rotate-180')}
                    />
                )}
            </button>

            {open ? (
                <div
                    id={panelId}
                    role='listbox'
                    aria-label={facet.label}
                    aria-multiselectable={mode === 'multi'}
                    className='absolute left-0 top-full z-20 mt-1.5 max-h-80 min-w-60 overflow-y-auto rounded-lg border bg-card p-1 shadow-lg'
                >
                    {mode === 'ordinal' ? (
                        <p className='px-2.5 pb-1 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground'>
                            Höchstens
                        </p>
                    ) : null}

                    {mode !== 'toggle' ? (
                        <Option selected={!isActive} onSelect={() => onChangeValues([], true)}>
                            Alle
                        </Option>
                    ) : null}

                    {options.map((option) => {
                        const count = counts.get(option) ?? 0
                        return (
                            <Option
                                key={option}
                                selected={selected.includes(option)}
                                count={count}
                                // An option that would return nothing is not worth a click, but
                                // it stays visible so the reader sees the value exists.
                                disabled={count === 0 && !selected.includes(option)}
                                onSelect={() => toggle(option)}
                            >
                                {labelOf(option)}
                            </Option>
                        )
                    })}
                </div>
            ) : null}
        </div>
    )
}

/** Close an open dropdown on a click outside it or on Escape. */
function useDismiss(open: boolean, onOpenChange: (open: boolean) => void) {
    const containerRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        if (!open) return
        const onPointerDown = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) onOpenChange(false)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onOpenChange(false)
                triggerRef.current?.focus()
            }
        }
        document.addEventListener('mousedown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('mousedown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [open, onOpenChange])

    return { containerRef, triggerRef }
}

function Option({
    selected,
    count,
    disabled = false,
    onSelect,
    children,
}: {
    selected: boolean
    count?: number
    disabled?: boolean
    onSelect: () => void
    children: React.ReactNode
}) {
    return (
        <button
            type='button'
            role='option'
            aria-selected={selected}
            disabled={disabled}
            onClick={onSelect}
            className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                disabled
                    ? 'cursor-not-allowed text-muted-foreground/50'
                    : 'hover:bg-muted',
                selected ? 'font-medium text-foreground' : !disabled && 'text-muted-foreground',
            )}
        >
            <Check
                aria-hidden
                className={cn('size-3.5 shrink-0', selected ? 'text-primary' : 'opacity-0')}
            />
            <span className='min-w-0 flex-1 truncate'>{children}</span>
            {count !== undefined ? (
                <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>{count}</span>
            ) : null}
        </button>
    )
}
