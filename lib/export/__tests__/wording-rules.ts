/**
 * The strict wording rules of the share pages (plan of 2026-10-18, section
 * 8.2, and the rc.7 build rules): words an average municipal employee does
 * not use, and dashes German text does not have. Strict means no guessing
 * of a text's language: every text the pages show is held to them, and
 * what may say them anyway - English texts written to GitLab, code
 * identifiers - is named in an allow-list where the check runs. Shared by
 * the scan of the source (`wording.test.ts`) and the plain-text render of
 * every tab (`tab-wording.test.ts`); not a test file of its own.
 */

export const STRICT_RULES: readonly (readonly [RegExp, string])[] = [
    [/Use[ -]Case/, '„Use Case“ - ein Datensatz ist kein Use Case; im Katalog heißt es „Anwendungsfall“'],
    [/\bMRs?\b/, '„MR“ - es heißt „Vorschlag“'],
    [/Merge Request/, '„Merge Request“ - es heißt „Vorschlag“'],
    // Also at the end of a German compound ("Basisbranch", "Zielrepository", "Katalog-Repo"); not "source_branch".
    [/\bBranch(es)?\b|\p{Ll}branch\b/u, '„Branch“ - für die Leserin unsichtbar, nicht nennen'],
    [/Repositor|\bRepo\b|\p{Ll}repo(sitor|\b)/u, '„Repository“ - es heißt „Ablageort“'],
    [/Dataset/, '„Dataset“ - es heißt „Datensatz“'],
    [/gemergt/i, '„gemergt“ - es heißt „angenommen“'],
    [/index\.json/, '„index.json“ - es heißt „der Katalog“'],
    [/urn:/, 'eine Kennung „urn:…“ - es heißt „Adresse im Katalog“, die Kennung nur unter „Technische Angaben“'],
    [/—/, 'Geviertstrich - in deutschen Texten „ - “'],
    [/–/, 'Halbgeviertstrich - zwischen Zahlen „bis“, sonst „ - “'],
    [/^(Entwurf )?[Ll]öschen$/, '„Löschen“ als Knopf - es heißt „Verwerfen“ oder „Zurückziehen“'],
]

/** What breaks the strict rules in one text: the reasons, empty when nothing does. */
export function strictProblemsOf(text: string): string[] {
    return STRICT_RULES.filter(([pattern]) => pattern.test(text)).map(([, why]) => why)
}

/** The rules a text breaks, by their patterns, for an allow-list to name. */
export function brokenRules(text: string): RegExp[] {
    return STRICT_RULES.filter(([pattern]) => pattern.test(text)).map(([pattern]) => pattern)
}
