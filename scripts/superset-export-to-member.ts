import { readFileSync, writeFileSync } from 'node:fs'

import { documentFromExport } from '@/lib/superset/bundle'

/**
 * Turns a Superset dashboard export into the dashboard member a package carries.
 *
 *   pnpm superset:member <dashboard_export.zip> <core-ir/<name>.dashboard.json> [superset-version]
 *
 * Export the dashboard from Superset's dashboard list (Bulk select, Export),
 * then list the written file under `members.dashboards` in core-ir/manifest.json.
 * Build the dashboard on a table dataset, not on SQL Lab SQL: the install
 * moves a table dataset to the new dataset's schema, but cannot rewrite SQL.
 */
const [input, output, supersetVersion] = process.argv.slice(2)
if (!input || !output) {
    console.error('Usage: pnpm superset:member <dashboard_export.zip> <out.dashboard.json> [superset-version]')
    process.exit(1)
}

const document = documentFromExport(readFileSync(input), supersetVersion)
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`)
console.log(`Wrote ${output} (${Object.keys(document.files).length} files)`)
