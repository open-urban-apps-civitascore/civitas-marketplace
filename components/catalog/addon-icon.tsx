/** Monogram tile: add-ons carry no icon, and a broken image is worse than none. */
export function AddonIcon({ name, className = '' }: { name: string; className?: string }) {
    const monogram = name
        .split(/[\s-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase() ?? '')
        .join('')

    return (
        <span
            aria-hidden
            className={`grid shrink-0 place-items-center rounded-lg bg-primary/10 font-semibold text-primary ${className || 'size-10 text-sm'}`}
        >
            {monogram}
        </span>
    )
}
