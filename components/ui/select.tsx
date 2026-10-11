'use client'

import * as SelectPrimitive from '@radix-ui/react-select'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * A dropdown that looks the same in every browser, unlike a native select whose
 * open list is drawn by the operating system. The same Radix primitive and item
 * styling as the platform portal's `components/ui/select.tsx`, so both apps read
 * alike; the closed field matches this app's own text inputs.
 */

export interface SelectOption {
    value: string
    label: string
}

/** Radix refuses an item whose value is '', so "no choice" travels as this sentinel. */
const NONE = '__none__'

interface SelectProps {
    value: string
    onValueChange: (value: string) => void
    options: SelectOption[]
    /** Shown while nothing is chosen ('' as value). */
    placeholder?: string
    /** Offers an item that clears the choice back to '' (for example "Keine Angabe"). */
    noneLabel?: string
    disabled?: boolean
    className?: string
    'aria-label'?: string
}

export function Select({ value, onValueChange, options, placeholder, noneLabel, disabled, className, ...aria }: SelectProps) {
    // Without a "none" item, '' must reach Radix as undefined so the placeholder shows.
    const current = value === '' ? (noneLabel ? NONE : undefined) : value
    return <SelectPrimitive.Root value={current} onValueChange={(next) => onValueChange(next === NONE ? '' : next)} disabled={disabled}>
        <SelectPrimitive.Trigger
            aria-label={aria['aria-label']}
            className={cn(
                'flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm text-foreground',
                'focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50',
                'data-[placeholder]:text-muted-foreground [&>span]:line-clamp-1',
                className,
            )}
        >
            <SelectPrimitive.Value placeholder={placeholder} />
            <SelectPrimitive.Icon asChild>
                <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
            </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
            <SelectPrimitive.Content
                position="popper"
                sideOffset={4}
                className="relative z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md"
            >
                <SelectPrimitive.Viewport className="p-1">
                    {noneLabel && <Item value={NONE}>{noneLabel}</Item>}
                    {options.map((option) => <Item key={option.value} value={option.value}>{option.label}</Item>)}
                </SelectPrimitive.Viewport>
            </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
}

function Item({ value, children }: { value: string; children: string }) {
    return <SelectPrimitive.Item
        value={value}
        className="relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
    >
        <span className="absolute right-2 flex size-3.5 items-center justify-center">
            <SelectPrimitive.ItemIndicator><CheckIcon className="size-4" /></SelectPrimitive.ItemIndicator>
        </span>
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
}
