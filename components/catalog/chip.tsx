/** Short identifier — a role, a component name, a Core version. */
export function Chip({ children }: { children: React.ReactNode }) {
    return (
        <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
            {children}
        </span>
    )
}

export function Chips({ items }: { items: string[] }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {items.map((item) => (
                <Chip key={item}>{item}</Chip>
            ))}
        </div>
    )
}
