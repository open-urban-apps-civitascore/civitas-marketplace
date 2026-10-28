'use client'

import { useId } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

// Radix, not a native select: the operating system draws a native select's open list.
// Item styling matches the platform portal's components/ui/select.tsx.

export interface SelectOption {
    value: string
    label: string
    detail?: string
    hint?: string
    /** Shows no tooltip, so the page must say why elsewhere. */
    disabled?: boolean
}

/** Radix refuses an item whose value is '', so "no choice" travels as this sentinel. */
const NONE = '__none__'

interface SelectProps {
    value: string
    onValueChange: (value: string) => void
    options: SelectOption[]
    placeholder?: string
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
            {/* Capped at the space left, so long options wrap at phone width instead of running off the screen. */}
            <SelectPrimitive.Content
                position="popper"
                sideOffset={4}
                collisionPadding={16}
                className="relative z-50 max-h-(--radix-select-content-available-height) max-w-(--radix-select-content-available-width) min-w-(--radix-select-trigger-width) overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md"
            >
                <SelectPrimitive.Viewport className="p-1">
                    {noneLabel && <Item value={NONE} label={noneLabel} />}
                    {options.map((option) => <Item key={option.value} {...option} />)}
                </SelectPrimitive.Viewport>
            </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
}

function Item({ value, label, detail, hint, disabled }: SelectOption) {
    const id = useId()
    // Radix names an option by its ItemText alone; detail and hint reach a screen reader as its description.
    const described = [detail && `${id}-detail`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined
    return <SelectPrimitive.Item
        value={value}
        disabled={disabled}
        aria-describedby={described}
        className="relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
    >
        <span className="absolute right-2 flex size-3.5 items-center justify-center">
            <SelectPrimitive.ItemIndicator><CheckIcon className="size-4" /></SelectPrimitive.ItemIndicator>
        </span>
        <span className="flex min-w-0 flex-col">
            <span>
                <SelectPrimitive.ItemText>{label}</SelectPrimitive.ItemText>
                {detail && <><span aria-hidden> · </span><span id={`${id}-detail`}>{detail}</span></>}
            </span>
            {hint && <span id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</span>}
        </span>
    </SelectPrimitive.Item>
}
