import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { bundleBranch, catalogBranch, removalBranch } from '@/lib/export/config'
import { displayNameOf, proposerOf, shareSourceLine, shareSourceOf, withdrawerOf } from '@/lib/export/merge-request-text'

/**
 * The share pages' words, checked where they are written (plan of
 * 2026-10-18, section 8): no "Use Case" for a dataset, no "gemergt", no
 * merge-request jargon on buttons, no "Löschen", no long dashes in German.
 *
 * Heuristics, kept simple on purpose:
 * - Only text the code shows or sends is read: string literals, template
 *   literals (with `…` for what is put in) and JSX text, found with the
 *   TypeScript parser. Comments are not part of the syntax tree, so they are
 *   never checked, and neither are file names in imports.
 * - Each text gets a language by counting short function words: German ones
 *   ("der", "und", "nicht", "bitte" …, plus one for an umlaut, ß or German
 *   quotes) against English ones ("the", "of", "by", "via" …). A text with
 *   more English than German is English: the GitLab titles, descriptions and
 *   notes the listing reads back, which must not be translated (see the last
 *   block), even where they quote a German button. Everything else, short
 *   labels without any of these words included, is held to the German rules.
 * - Phrases that cannot occur in English ("gemergt", "Use Case" with a capital
 *   C and a space, a "Löschen" button) are banned in every text.
 * - `validate-bundle-script.ts` is a Python script sent along with each
 *   package, English and out of scope (13 Oct), and is not read.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..')

/** What is scanned: the share pages, their components, and the server code whose messages they show. */
function sources(): string[] {
    const under = (dir: string, recursive: boolean) =>
        readdirSync(path.join(ROOT, dir), { recursive, withFileTypes: false })
            .map(String)
            .filter((file) => /\.tsx?$/.test(file) && !file.includes('__tests__'))
            .map((file) => path.join(dir, file))
    return [
        ...under('components/export', true),
        ...under('app/(authenticated)/export', true),
        ...under('lib/export', false).filter((file) => !file.endsWith('validate-bundle-script.ts')),
        'lib/export-actions.ts',
        // The listing's route: its refusals are shown on the share pages.
        ...under('app/api/shares', true),
        // The menu item that leads there, and the steps the share page shares with the front page.
        'components/layout/app-sidebar.tsx',
        'components/ui/numbered-steps.tsx',
    ]
}

interface Text {
    where: string
    text: string
}

/** Every text in one file, as the code writes it, without comments and module names. */
function textsOf(file: string): Text[] {
    const source = readFileSync(path.join(ROOT, file), 'utf8')
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const found: Text[] = []
    const add = (node: ts.Node, text: string) => {
        const where = `${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
        if (text.trim()) found.push({ where, text: text.replace(/\s+/g, ' ').trim() })
    }
    const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text)
        else if (ts.isTemplateExpression(node)) add(node, [node.head.text, ...node.templateSpans.map((span) => `…${span.literal.text}`)].join(''))
        else if (ts.isJsxText(node)) add(node, node.text)
        ts.forEachChild(node, visit)
    }
    visit(tree)
    return found
}

const GERMAN_LETTERS = /[äöüÄÖÜß„“]/
/** Whole words only, umlauts counted as letters: `\b` would find "zur" in "Zurückziehen". */
const words = (list: string) => new RegExp(`(?<!\\p{L})(${list})(?!\\p{L})`, 'giu')
const GERMAN_WORDS = words('der|die|das|den|dem|des|und|oder|ist|sind|nicht|kein|keine|bitte|du|dein|deine|noch|schon|wird|werden|hier|auch|nur|wie|ein|eine|einen|zum|zur|vom|beim|aus|auf|im|sich|jetzt|dann|wenn')
/** Not "an", "in" or "was": German has them too. */
const ENGLISH_WORDS = words('the|a|of|and|to|is|are|be|by|for|from|with|this|that|it|on|via|not|no|which|its|has|have')

function languageOf(text: string): 'german' | 'english' | 'unknown' {
    const german = (text.match(GERMAN_WORDS)?.length ?? 0) + (GERMAN_LETTERS.test(text) ? 1 : 0)
    const english = text.match(ENGLISH_WORDS)?.length ?? 0
    if (english > german) return 'english'
    return german > 0 ? 'german' : 'unknown'
}

/** What no text may say, in either language: these only ever appear in German. */
const BANNED_ANYWHERE: [RegExp, string][] = [
    [/Use Case/, '„Use Case“ - ein Datensatz ist kein Use Case; im Katalog heißt es „Anwendungsfall“'],
    [/gemergt/i, '„gemergt“ - es heißt „angenommen“'],
    [/Merge Request (erstellen|öffnen|ansehen)/, 'Merge-Request-Knopf - es heißt „Zur Prüfung einreichen“ oder „In GitLab ansehen“'],
    [/^(Entwurf )?[Ll]öschen$/, '„Löschen“ als Knopf - es heißt „Verwerfen“ oder „Zurückziehen“'],
]

/** What no text but an English one may say. „Merge Request“ only in the fold-out that explains the word. */
const BANNED_UNLESS_ENGLISH: [RegExp, string][] = [
    [/—/, 'Geviertstrich - in deutschen Texten „ - “'],
    [/\d\s*–\s*\d|–/, 'Halbgeviertstrich - zwischen Zahlen „bis“, sonst „ - “'],
    [/\bMR\b/, '„MR“ - es heißt „Vorschlag“'],
    [/Merge Request(?! *\?)/, '„Merge Request“ außerhalb der Erklärung - es heißt „Vorschlag“'],
    // Also at the end of a German compound ("Zielrepository", "Katalog-Repo", "Basisbranch"), but not in API
    // paths, parameters or identifiers ("/repository/", "source_branch", "datasetId"), which the parser finds too.
    [/Repositor|\bRepo\b|\p{Ll}repo(sitor|\b)|Dataset|\bBranch\b|\p{Ll}branch\b/u, 'Fachwort - es heißt „Ablageort“ oder „Datensatz“'],
]

function problemsOf(texts: Text[]): string[] {
    return texts.flatMap(({ where, text }) => {
        const rules = languageOf(text) === 'english' ? BANNED_ANYWHERE : [...BANNED_ANYWHERE, ...BANNED_UNLESS_ENGLISH]
        return rules.filter(([pattern]) => pattern.test(text)).map(([, why]) => `${where}: ${why}: ${text.slice(0, 120)}`)
    })
}

describe('the share pages’ wording', () => {
    const files = sources()
    const texts = files.flatMap(textsOf)

    it('reads the files it is meant to, so an empty scan cannot pass for a clean one', () => {
        expect(files).toEqual(
            expect.arrayContaining([
                'components/export/delete-share-dialog.tsx',
                'components/export/export-panel.tsx',
                'components/export/use-shared-listing.ts',
                'lib/export-actions.ts',
                'lib/export/share-listing.ts',
                'lib/export/share-tabs.ts',
                'app/api/shares/route.ts',
                'app/(authenticated)/export/layout.tsx',
                'app/(authenticated)/export/(lists)/layout.tsx',
                'app/(authenticated)/export/(lists)/page.tsx',
                'app/(authenticated)/export/(lists)/shared/page.tsx',
                'app/(authenticated)/export/(lists)/ended/page.tsx',
                'app/(authenticated)/export/new/page.tsx',
                'components/export/share-tabs-nav.tsx',
                'components/export/share-process.tsx',
                'components/export/share-tab-states.tsx',
                'components/export/share-tab-frame.tsx',
                'components/export/ended-shares.tsx',
                'components/export/listing-refresh.tsx',
                'components/layout/app-sidebar.tsx',
                'lib/export/ended-lines.ts',
                'lib/export/wizard-address.ts',
            ]),
        )
        expect(texts.filter((text) => languageOf(text.text) === 'german').length).toBeGreaterThan(300)
        for (const label of [
            'Zur Prüfung einreichen',
            'In GitLab ansehen',
            'Behalten',
            'Verwerfen',
            'Zurückziehen',
            'Adresse ändern',
            'Neues Paket teilen',
            'Zurück zu Teilen',
            'So läuft Teilen ab',
            'Was diese Instanz teilt',
            'Veröffentlicht',
            'Beendet',
        ]) {
            expect(texts.some((text) => text.text === label)).toBe(true)
        }
    })

    it('tells German from English as intended', () => {
        expect(languageOf('Bitte erneut versuchen.')).toBe('german')
        expect(languageOf('Vorschlag !4 ist geschlossen')).toBe('german')
        expect(languageOf('Was ist ein Merge Request?')).toBe('german')
        expect(languageOf('Kurzname *')).toBe('unknown')
        expect(languageOf('Proposed by the Open Urban Apps marketplace on behalf of **…**.')).toBe('english')
        expect(languageOf('Nothing is listed yet. The marketplace offers "Katalog-Eintrag vorschlagen" once this package is on the base branch — …')).toBe('english')
        expect(languageOf('Branch `…` · proposed via "Zurückziehen" in the marketplace\'s "In Arbeit"')).toBe('english')
    })

    it('has no jargon, no "Löschen" and no long dashes', () => {
        expect(problemsOf(texts)).toEqual([])
    })

    it('would catch what it is meant to', () => {
        const sample = (text: string) => problemsOf([{ where: 'x', text }])
        for (const text of [
            'Wähle einen Use Case dieser Instanz.',
            'Paket gemergt',
            'Merge Request erstellen',
            'Löschen',
            'Das Paket würde die Prüfung nicht bestehen — siehe unten.',
            'Paket angenommen — Katalog nicht eingerichtet',
            '2–40 Kleinbuchstaben',
            'MR offen',
            'Kein Zielrepository: Repository fehlt',
            'Kein Zielrepository konfiguriert.',
            'Katalog-Repo nicht konfiguriert.',
            'Paket liegt auf dem Basisbranch.',
            'Ungültige Dataset-Kennung',
        ]) {
            expect(sample(text), text).not.toEqual([])
        }
        expect(sample('Was ist ein Merge Request?')).toEqual([])
        expect(sample('Kein GitLab-Zugang hinterlegt: EXPORT_REPO_TOKEN setzen.')).toEqual([])
        expect(sample('Export use case: … …')).toEqual([])
        expect(sample('- `…/` (… files) — a CORE-IR use-case package exported from a running instance')).toEqual([])
    })
})

describe('the English texts the listing reads back', () => {
    // Translating these would lose every package shared so far: the listing finds them by these words.
    it('keep their titles, descriptions, notes and branch names', () => {
        const actions = readFileSync(path.join(ROOT, 'lib/export-actions.ts'), 'utf8')
        const deletion = readFileSync(path.join(ROOT, 'lib/export/share-deletion.ts'), 'utf8')
        expect(actions).toContain('title: `Export use case: ${form.options.displayName} ${form.options.version}`')
        expect(actions).toContain('`Proposed by the Open Urban Apps marketplace on behalf of **${requestedBy}**.`')
        expect(deletion).toContain('`Withdrawn through the Open Urban Apps marketplace on behalf of **${requestedBy}**.`')
        expect(deletion).toContain('title: `Remove use case: ${removal.displayName} ${removal.version}`')

        expect(displayNameOf('Export use case: Bäume 1.1.0', '1.1.0')).toBe('Bäume')
        expect(proposerOf('Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.')).toBe('Ewa')
        expect(withdrawerOf('Withdrawn through the Open Urban Apps marketplace on behalf of **Ewa**.')).toBe('Ewa')
        // The hidden source line of every proposal since rc.6: changing its form would lose where those shares came from.
        expect(shareSourceLine({ kind: 'dataset', id: 'ds', instance: 'https://portal.example' })).toBe('<!-- oua-share {"kind":"dataset","id":"ds","instance":"https://portal.example"} -->')
        expect(shareSourceOf('<!-- oua-share {"kind":"dataset","id":"ds","instance":"https://portal.example"} -->')).toEqual({ kind: 'dataset', id: 'ds', instance: 'https://portal.example' })
        expect(actions.match(/shareSourceLine\(/g)).toHaveLength(2)
        expect(deletion).toContain('shareSourceLine(')
        expect([bundleBranch('baeume', '1.1.0'), catalogBranch('baeume', '1.1.0'), removalBranch('baeume', '1.1.0')]).toEqual([
            'export/baeume-1.1.0',
            'catalog/baeume-1.1.0',
            'remove/baeume-1.1.0',
        ])
    })
})
