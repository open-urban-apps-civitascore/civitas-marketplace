type IllustrationKind = 'grid' | 'bars' | 'line' | 'gauge'

/** Listing identity, ported from the marketplace-addon prototype: green = use
 *  case, orange = add-on (the complementary colour to the CIVITAS blue, which
 *  stays reserved for primary actions). */
export type IllustrationTone = 'emerald' | 'orange'

// One entry per tone; class strings stay literal so Tailwind picks them up.
// `accent` is the single contrast dot in the grid motif — warm on the green
// art, cool on the orange art.
const TONE_CLASSES: Record<
    IllustrationTone,
    {
        surface: string
        fill: string
        stroke: string
        strokeSoft: string
        strokeFaint: string
        accent: string
    }
> = {
    emerald: {
        surface: 'bg-emerald-500/10',
        fill: 'fill-emerald-600 dark:fill-emerald-500',
        stroke: 'stroke-emerald-600 dark:stroke-emerald-500',
        strokeSoft: 'stroke-emerald-500/40',
        strokeFaint: 'stroke-emerald-500/25',
        accent: 'fill-amber-500',
    },
    orange: {
        surface: 'bg-orange-500/10',
        fill: 'fill-orange-600 dark:fill-orange-500',
        stroke: 'stroke-orange-600 dark:stroke-orange-500',
        strokeSoft: 'stroke-orange-500/40',
        strokeFaint: 'stroke-orange-500/25',
        accent: 'fill-sky-500',
    },
}

// Generic, always-available header art derived from the listing's keywords —
// no per-entry image needed, never a broken image, and it themes with the
// listing identity. A catalogue `image` field could later override this.
function illustrationForKeywords(keywords: string[]): IllustrationKind {
    const haystack = keywords.join(' ').toLowerCase()
    if (/(umwelt|klima|luft|wasser|regen|sensor)/.test(haystack)) return 'line'
    if (/(energie|solar|strom|lade)/.test(haystack)) return 'gauge'
    if (/(grün|gruen|baum|natur|abfall|kataster)/.test(haystack)) return 'bars'
    // mobility, citizen services, and everything else → a map/grid motif.
    return 'grid'
}

function IllustrationBody({ kind, tone }: { kind: IllustrationKind; tone: IllustrationTone }) {
    const classes = TONE_CLASSES[tone]
    switch (kind) {
        case 'bars':
            return (
                <g className={classes.fill}>
                    <rect x="40" y="70" width="45" height="80" rx="4" />
                    <rect x="110" y="45" width="45" height="105" rx="4" />
                    <rect x="180" y="90" width="45" height="60" rx="4" />
                    <rect x="250" y="30" width="45" height="120" rx="4" />
                    <rect x="320" y="60" width="45" height="90" rx="4" />
                </g>
            )
        case 'line':
            return (
                <g fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <polyline
                        className={classes.strokeSoft}
                        strokeWidth="6"
                        strokeDasharray="4 10"
                        points="20,120 90,105 160,115 230,80 300,95 380,65"
                    />
                    <polyline
                        className={classes.stroke}
                        strokeWidth="8"
                        points="20,100 90,72 160,90 230,45 300,62 380,28"
                    />
                </g>
            )
        case 'gauge':
            return (
                <g fill="none" strokeLinecap="round">
                    <path
                        className={classes.strokeFaint}
                        strokeWidth="22"
                        d="M 90 132 A 110 110 0 0 1 310 132"
                    />
                    <path
                        className={classes.stroke}
                        strokeWidth="22"
                        d="M 90 132 A 110 110 0 0 1 265 42"
                    />
                    <circle className={classes.fill} cx="200" cy="132" r="10" />
                </g>
            )
        case 'grid':
        default:
            return (
                <g>
                    <g className={classes.strokeFaint} strokeWidth="12">
                        <line x1="0" y1="52" x2="400" y2="52" />
                        <line x1="0" y1="108" x2="400" y2="108" />
                        <line x1="115" y1="0" x2="115" y2="150" />
                        <line x1="255" y1="0" x2="255" y2="150" />
                    </g>
                    <circle className={classes.fill} cx="115" cy="52" r="13" />
                    <circle className={classes.fill} cx="255" cy="108" r="13" />
                    <circle className={classes.accent} cx="185" cy="80" r="13" />
                </g>
            )
    }
}

export function CatalogIllustration({
    keywords,
    tone = 'emerald',
    className = 'h-32',
}: {
    keywords: string[]
    tone?: IllustrationTone
    className?: string
}) {
    const kind = illustrationForKeywords(keywords)
    return (
        <div className={`w-full ${TONE_CLASSES[tone].surface} ${className}`}>
            <svg
                viewBox="0 0 400 150"
                preserveAspectRatio="xMidYMid slice"
                className="h-full w-full"
                aria-hidden="true"
            >
                <IllustrationBody kind={kind} tone={tone} />
            </svg>
        </div>
    )
}
