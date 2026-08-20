// scripts/check-column-wiring.ts
//
// CI shell for scripts/columnFlowAnalysis.ts (see that file's header for the
// incidents and the design) plus scripts/generatedFlowVerify.ts (the
// generated-once column manifest). One TypeScript program build serves both:
// the schema-wide read↔write wiring gates and the per-column flow manifest.
//
// Fail-closed throughout: a check that could not run has not passed (#443).
// The engine proves itself on known-good wirings (sentinels) BEFORE its
// verdict on anything else is accepted — an engine that silently lost a
// detection layer would otherwise report a clean schema with a straight face.

import ts from 'typescript'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, relative } from 'path'
import {
  parseSchema,
  analyzeColumnFlow,
  findRawSqlColumnWrites,
  findMigrationColumnWrites,
  findReadNeverWritten,
  findStaleWaivers,
  findShadowDrift,
  shadowedColumns,
  reportWrittenNeverRead,
  checkEngineSentinels,
  DYNAMIC_WRITES,
} from './columnFlowAnalysis'
import { verifyManifest } from './generatedFlowVerify'
import { GENERATED_COLUMN_FLOWS } from '../src/lib/game/generatedColumnFlow'

const root = process.cwd()

function fail(message: string): never {
  console.error(`::error::${message}`)
  process.exit(1)
}

// --- 1. Program, from the real tsconfig (incremental off: no tsbuildinfo writes)
const configPath = join(root, 'tsconfig.json')
const parsed = ts.getParsedCommandLineOfConfigFile(
  configPath,
  { incremental: false, noEmit: true },
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) =>
      fail(`tsconfig unreadable: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`),
  } as ts.ParseConfigFileHost
)
if (!parsed) fail('could not parse tsconfig.json')

// Tests are excluded from analysis: they supply the value they then assert
// on, and mock call sites would pollute both directions. Everything else in
// src/ and scripts/ is in scope — a future DB-touching script is covered the
// day it is written.
const isTest = (f: string) => /__tests__|\.test\.tsx?$|vitest\.setup/.test(f)
const inScope = (f: string) => {
  const rel = relative(root, f)
  if (rel.startsWith('..')) return false
  if (!(rel.startsWith('src/') || rel.startsWith('scripts/'))) return false
  return !isTest(rel)
}
const rootNames = parsed.fileNames.filter(inScope)
if (rootNames.length < 300) fail(`only ${rootNames.length} source files in scope — the file filter is broken`)

const t0 = Date.now()
const program = ts.createProgram({ rootNames, options: parsed.options })

// --- 2. Generated client must exist (prisma generate ran)
const clientDts = program
  .getSourceFiles()
  .find((sf) => sf.fileName.replace(/\\/g, '/').endsWith('.prisma/client/index.d.ts'))
if (!clientDts) fail('generated Prisma client not in program — run `npx prisma generate` first')

// --- 3. Schema
const schema = parseSchema(readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf-8'))
if (schema.models.length < 60) fail(`only ${schema.models.length} models parsed — schema parser broken`)
if (schema.columns.length < 500) fail(`only ${schema.columns.length} scalar columns parsed — schema parser broken`)

// --- 4. Analysis
const analysis = analyzeColumnFlow(program, schema, clientDts.fileName, inScope)
const rawSql = findRawSqlColumnWrites(program.getSourceFiles(), inScope)
const migrationsDir = join(root, 'prisma', 'migrations')
const migrationSql = existsSync(migrationsDir)
  ? readdirSync(migrationsDir)
      .map((d) => {
        const p = join(migrationsDir, d, 'migration.sql')
        return existsSync(p) ? readFileSync(p, 'utf-8') : ''
      })
      .join('\n')
  : ''
const migrationWrites = findMigrationColumnWrites(migrationSql)

const h = analysis.health
console.log(
  `analyzed ${h.filesAnalyzed} files in ${((Date.now() - t0) / 1000).toFixed(1)}s: ` +
    `${h.delegateCallsClassified} delegate calls, ${h.columnWritesRecorded} column writes ` +
    `(${h.assignmentWrites} via assignment, ${h.annotatedLiteralWrites} via annotated literals), ` +
    `${h.opaqueWrites} opaque writes, ${h.symbolReadsRecorded} symbol reads, ${h.weakReadsRecorded} name reads`
)

// --- 5. Vacuity + sentinel guards, before any verdict
if (h.delegateCallsClassified === 0) fail('engine broken: zero Prisma delegate calls classified')
if (h.columnWritesRecorded === 0) fail('engine broken: zero column writes recorded')
if (h.symbolReadsRecorded === 0) fail('engine broken: zero symbol-level reads recorded')
const sentinelFailures = checkEngineSentinels(analysis)
if (sentinelFailures.length > 0) {
  console.error('The engine failed to rediscover known-good wirings. Its verdicts cannot be trusted,')
  console.error('so this run fails BEFORE judging anything else:')
  for (const f of sentinelFailures) console.error(`  ${f}`)
  fail(`${sentinelFailures.length} engine sentinel(s) failed`)
}

// --- 6. Gates
const rel = (f: string) => relative(root, f)
let failed = false

const gate1 = findReadNeverWritten(analysis, schema.columns, rawSql, migrationWrites, DYNAMIC_WRITES)
if (gate1.length > 0) {
  failed = true
  console.error('\nColumns that are READ but NEVER WRITTEN — each holds its default forever')
  console.error('while the UI renders it as though it meant something (the advancementTier defect):')
  for (const f of gate1) {
    console.error(`  ${f.model}.${f.column}`)
    for (const r of f.readers) console.error(`      read at ${rel(r.file)}:${r.line}`)
  }
}

const gate2 = findStaleWaivers(analysis, schema.columns, rawSql, migrationWrites, DYNAMIC_WRITES)
if (gate2.length > 0) {
  failed = true
  console.error('\nStale waivers (a waiver that is no longer necessary must come out,')
  console.error('or the list decays into a suppression file nobody audits):')
  for (const s of gate2) console.error(`  ${s}`)
}

// --- 6b. Gate 3: the opaque shadow may not grow, and may not go stale
const shadow = shadowedColumns(analysis, schema.columns, rawSql, migrationWrites)
const drift = findShadowDrift(shadow)
if (drift.entered.length > 0) {
  failed = true
  console.error('\nColumns that ENTERED the opaque-write shadow — readable, and "written" only')
  console.error('in the sense that some dynamic payload touches their model. This is exactly')
  console.error('where a dead column hides (advancementTier hid behind precisely this). Either')
  console.error('write the column visibly, or record it in OPAQUE_SHADOW with eyes open:')
  for (const k of drift.entered) console.error(`  ${k}`)
}
if (drift.left.length > 0) {
  failed = true
  console.error('\nStale OPAQUE_SHADOW entries (the column gained a visible writer or lost its')
  console.error('readers) — prune them, or the record rots into a suppression file:')
  for (const k of drift.left) console.error(`  ${k}`)
}

// --- 7. Manifest verification (same program, same analysis)
const manifestViolations = verifyManifest(program, analysis, GENERATED_COLUMN_FLOWS, inScope, root)
if (manifestViolations.length > 0) {
  failed = true
  console.error('\nGenerated-column flow manifest violations (src/lib/game/generatedColumnFlow.ts):')
  for (const v of manifestViolations) console.error(`  ${v.fact}: ${v.problem}`)
}

// --- 8. Informational reports (never gate this run)
const opaqueModels = [...analysis.modelOpaqueWriters.keys()].sort()
if (opaqueModels.length > 0) {
  console.log(`\nModels with opaque write payloads (columns excused from Gate 1 at model granularity):`)
  console.log(`  ${opaqueModels.join(', ')}`)
}
const deadReport = reportWrittenNeverRead(analysis, schema.columns)
console.log(`\nwritten-never-read report (informational, ${deadReport.length} columns):`)
for (const f of deadReport) console.log(`  ${f.model}.${f.column}`)

if (failed) fail('column wiring check failed — see findings above')
console.log(`\nAll ${schema.columns.length} scalar columns across ${schema.models.length} models are wired: every read column has a writer.`)
