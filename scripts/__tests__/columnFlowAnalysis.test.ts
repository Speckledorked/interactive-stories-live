// scripts/__tests__/columnFlowAnalysis.test.ts
//
// Unit tests for the wiring engine over a miniature in-memory program with a
// fake generated Prisma client. Every behavior asserted here was either a
// false positive or a missed detection in some draft of the engine or its
// regex predecessor — this file is the record of what the engine must see
// and, just as important, what it must NOT count.

import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import {
  parseSchema,
  classifyPrismaTypeName,
  analyzeColumnFlow,
  findRawSqlColumnWrites,
  findMigrationColumnWrites,
  findReadNeverWritten,
  findStaleWaivers,
  findShadowDrift,
  shadowedColumns,
  checkEngineSentinels,
  type ColumnFlowAnalysis,
} from '../columnFlowAnalysis'

// ---------------------------------------------------------------------------
// Fixture program
// ---------------------------------------------------------------------------

const CLIENT_DTS = '/node_modules/.prisma/client/index.d.ts'

/** Widget and WidgetPart: a deliberate name-prefix collision, mirroring
 *  Character vs CharacterCapability in the real schema. */
const clientDts = `
export type Widget = { id: string; label: string | null; weight: number | null; ownerName: string | null }
export type WidgetPart = { id: string; label: string | null; widgetId: string }
export namespace Prisma {
  export type WidgetCreateInput = { id?: string; label?: string | null; weight?: number | null; ownerName?: string | null; parts?: WidgetPartCreateNestedManyWithoutWidgetInput }
  export type WidgetUncheckedCreateInput = { id?: string; label?: string | null; weight?: number | null; ownerName?: string | null }
  export type WidgetUpdateInput = { label?: string | null; weight?: number | null; ownerName?: string | null }
  export type WidgetUncheckedUpdateInput = { label?: string | null; weight?: number | null; ownerName?: string | null }
  export type WidgetWhereInput = { id?: string; label?: string | null; weight?: number | null; AND?: WidgetWhereInput[] }
  export type WidgetWhereUniqueInput = { id?: string }
  export type WidgetSelect = { id?: boolean; label?: boolean; weight?: boolean; ownerName?: boolean }
  export type WidgetPartCreateInput = { id?: string; label?: string | null; widgetId?: string }
  export type WidgetPartUncheckedCreateInput = { id?: string; label?: string | null; widgetId?: string }
  export type WidgetPartUpdateInput = { label?: string | null }
  export type WidgetPartWhereInput = { id?: string; label?: string | null }
  export type WidgetPartCreateNestedManyWithoutWidgetInput = { create?: WidgetPartCreateWithoutWidgetInput | WidgetPartCreateWithoutWidgetInput[]; connectOrCreate?: WidgetPartCreateOrConnectWithoutWidgetInput }
  export type WidgetPartCreateWithoutWidgetInput = { id?: string; label?: string | null }
  export type WidgetPartCreateOrConnectWithoutWidgetInput = { where: WidgetPartWhereUniqueInput; create: WidgetPartCreateWithoutWidgetInput }
  export type WidgetPartWhereUniqueInput = { id?: string }
  export interface WidgetDelegate {
    create(args: { data: WidgetCreateInput | WidgetUncheckedCreateInput; select?: WidgetSelect }): Promise<Widget>
    update(args: { where: WidgetWhereUniqueInput; data: WidgetUpdateInput | WidgetUncheckedUpdateInput }): Promise<Widget>
    findMany(args?: { where?: WidgetWhereInput; select?: WidgetSelect; distinct?: string[] }): Promise<Widget[]>
    findUnique(args: { where: WidgetWhereUniqueInput; select?: WidgetSelect }): Promise<Widget | null>
  }
  export interface WidgetPartDelegate {
    create(args: { data: WidgetPartCreateInput | WidgetPartUncheckedCreateInput }): Promise<WidgetPart>
    findMany(args?: { where?: WidgetPartWhereInput }): Promise<WidgetPart[]>
  }
  export type TransactionClient = Omit<PrismaClient, '$transaction'>
  export interface PrismaClient {
    widget: WidgetDelegate
    widgetPart: WidgetPartDelegate
    $transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>
    $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>
  }
}
export declare const prisma: Prisma.PrismaClient
`

const SCHEMA = `
model Widget {
  id        String  @id @default(cuid())
  label     String?
  weight    Int?
  ownerName String?
  parts     WidgetPart[]
}

model WidgetPart {
  id       String  @id @default(cuid())
  label    String?
  widgetId String
  widget   Widget  @relation(fields: [widgetId], references: [id])
}
`

function makeProgram(files: Record<string, string>): ts.Program {
  const all: Record<string, string> = { [CLIENT_DTS]: clientDts, ...files }
  const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ES2020, noEmit: true }
  const host: ts.CompilerHost = {
    getSourceFile: (name) =>
      all[name] !== undefined ? ts.createSourceFile(name, all[name], ts.ScriptTarget.ES2020, true) : undefined,
    getDefaultLibFileName: () => '/lib.d.ts',
    writeFile: () => { throw new Error('no writes') },
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => all[name] !== undefined || name === '/lib.d.ts',
    readFile: (name) => (name === '/lib.d.ts' ? '' : all[name]),
    resolveModuleNames: (names, containing) =>
      names.map((n) => {
        if (n === '@prisma/client') return { resolvedFileName: CLIENT_DTS }
        const resolved = n.startsWith('./') ? '/src/' + n.slice(2) + '.ts' : n
        return all[resolved] !== undefined ? { resolvedFileName: resolved } : undefined
      }) as (ts.ResolvedModule | undefined)[],
  }
  // lib.d.ts is empty, so give the program minimal ambient types.
  all['/lib.d.ts'] = `
interface Array<T> { [n: number]: T }
interface Boolean {} interface Function {} interface IArguments {} interface Number {}
interface Object {} interface RegExp {} interface String {} interface CallableFunction {}
interface NewableFunction {} interface TemplateStringsArray {}
interface Promise<T> {} interface Omit2 {}
type Omit<T, K extends keyof any> = { [P in Exclude<keyof T, K>]: T[P] }
type Exclude<T, U> = T extends U ? never : T
type Partial<T> = { [P in keyof T]?: T[P] }
declare var console: { log(...args: unknown[]): void }
`
  return ts.createProgram(Object.keys(all).filter((f) => f !== '/lib.d.ts'), options, host)
}

const schema = parseSchema(SCHEMA)

function analyze(files: Record<string, string>): ColumnFlowAnalysis {
  const program = makeProgram(files)
  return analyzeColumnFlow(program, schema, CLIENT_DTS, (f) => f.startsWith('/src/'))
}

const usage = (a: ColumnFlowAnalysis, key: string) => a.usage.get(key) ?? { writers: [], readers: [], weakReaders: [] }

// ---------------------------------------------------------------------------
// Schema parsing + classification
// ---------------------------------------------------------------------------

describe('parseSchema', () => {
  it('separates scalars, dbFilled markers, and relations', () => {
    expect(schema.models).toEqual(['Widget', 'WidgetPart'])
    expect(schema.columns.find((c) => c.model === 'Widget' && c.column === 'id')?.dbFilled).toBe(true)
    expect(schema.columns.find((c) => c.model === 'Widget' && c.column === 'label')?.dbFilled).toBe(false)
    expect(schema.relations).toContainEqual({ model: 'Widget', field: 'parts', target: 'WidgetPart' })
  })
})

describe('classifyPrismaTypeName', () => {
  const models = ['Widget', 'WidgetPart']

  it('classifies the input family', () => {
    expect(classifyPrismaTypeName('WidgetCreateInput', models)).toEqual({ model: 'Widget', kind: 'create' })
    expect(classifyPrismaTypeName('WidgetUncheckedUpdateInput', models)).toEqual({ model: 'Widget', kind: 'update' })
    expect(classifyPrismaTypeName('WidgetUpdateManyMutationInput', models)).toEqual({ model: 'Widget', kind: 'update' })
    expect(classifyPrismaTypeName('WidgetPartCreateWithoutWidgetInput', models)).toEqual({ model: 'WidgetPart', kind: 'create' })
    expect(classifyPrismaTypeName('WidgetWhereInput', models)).toEqual({ model: 'Widget', kind: 'where' })
    expect(classifyPrismaTypeName('WidgetSelect', models)).toEqual({ model: 'Widget', kind: 'select' })
  })

  it('backtracks across the prefix collision', () => {
    // Longest-prefix alone would try WidgetPart first and fail on the
    // remainder; the real collision this mirrors is Character vs
    // CharacterCapability.
    expect(classifyPrismaTypeName('WidgetPartCreateInput', models)?.model).toBe('WidgetPart')
    expect(classifyPrismaTypeName('WidgetCreateInput', models)?.model).toBe('Widget')
  })

  it('rejects container types by construction', () => {
    // Their property names (where/create/connectOrCreate) are NOT columns,
    // and recording them as such was a designed-out failure mode.
    expect(classifyPrismaTypeName('WidgetPartCreateOrConnectWithoutWidgetInput', models)).toBeNull()
    expect(classifyPrismaTypeName('WidgetPartCreateNestedManyWithoutWidgetInput', models)).toBeNull()
  })

  it('rejects app types that merely resemble the naming scheme', () => {
    expect(classifyPrismaTypeName('WidgetCreateInputBuilder', models)).toBeNull()
    expect(classifyPrismaTypeName('FooCreateInput', models)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Write detection
// ---------------------------------------------------------------------------

describe('write detection', () => {
  it('sees a delegate create, and scopes columns to the right model', () => {
    const a = analyze({
      '/src/a.ts': `
        import { prisma } from '@prisma/client'
        export async function go() {
          await prisma.widget.create({ data: { label: 'x', weight: 3 } })
          await prisma.widgetPart.create({ data: { label: 'part-label' } })
        }
      `,
    })
    expect(usage(a, 'Widget.label').writers).toHaveLength(1)
    expect(usage(a, 'Widget.weight').writers).toHaveLength(1)
    expect(usage(a, 'WidgetPart.label').writers).toHaveLength(1)
    // The collision guard: the part write must NOT credit Widget.
    expect(usage(a, 'Widget.label').writers).not.toHaveLength(2)
  })

  it('sees writes through a transaction client', () => {
    const a = analyze({
      '/src/tx.ts': `
        import { prisma, Prisma } from '@prisma/client'
        export async function go() {
          await prisma.$transaction(async (tx) => {
            await tx.widget.update({ where: { id: '1' }, data: { ownerName: 'kess' } })
          })
        }
      `,
    })
    expect(usage(a, 'Widget.ownerName').writers).toHaveLength(1)
  })

  it('descends into nested relation writes', () => {
    const a = analyze({
      '/src/nested.ts': `
        import { prisma } from '@prisma/client'
        export async function go() {
          await prisma.widget.create({ data: { label: 'x', parts: { create: [{ label: 'inner' }] } } })
        }
      `,
    })
    expect(usage(a, 'WidgetPart.label').writers).toHaveLength(1)
  })

  it('records an opaque write for a variable payload, not nothing', () => {
    const a = analyze({
      '/src/opaque.ts': `
        import { prisma } from '@prisma/client'
        export async function go(patch: Record<string, unknown>) {
          await prisma.widget.update({ where: { id: '1' }, data: patch as never })
        }
      `,
    })
    expect((a.modelOpaqueWriters.get('Widget') ?? []).length).toBeGreaterThan(0)
    expect(usage(a, 'Widget.label').writers).toHaveLength(0)
  })

  it('records a spread inside a data literal as opaque', () => {
    const a = analyze({
      '/src/spread.ts': `
        import { prisma } from '@prisma/client'
        export async function go(patch: { label?: string }) {
          await prisma.widget.update({ where: { id: '1' }, data: { ...patch, weight: 2 } })
        }
      `,
    })
    expect(usage(a, 'Widget.weight').writers).toHaveLength(1)
    expect((a.modelOpaqueWriters.get('Widget') ?? []).length).toBeGreaterThan(0)
  })

  it('sees an assignment write through a typed update object', () => {
    // The worldUpdaters shape: const updateData: Prisma.XUpdateInput = {};
    // updateData.col = x. As `any` these writes were invisible, which is why
    // the real updateData was retyped.
    const a = analyze({
      '/src/assign.ts': `
        import { prisma, Prisma } from '@prisma/client'
        export async function go() {
          const updateData: Prisma.WidgetUpdateInput = {}
          updateData.ownerName = 'renamed'
          await prisma.widget.update({ where: { id: '1' }, data: updateData })
        }
      `,
    })
    expect(usage(a, 'Widget.ownerName').writers).toHaveLength(1)
  })

  it('sees an annotated literal write outside any call', () => {
    const a = analyze({
      '/src/annotated.ts': `
        import { Prisma } from '@prisma/client'
        export const patch: Prisma.WidgetUpdateInput = { weight: 9 }
      `,
    })
    expect(usage(a, 'Widget.weight').writers).toHaveLength(1)
  })

  it("does NOT count 'field' in obj, or reads, as writes", () => {
    // The regex predecessor had a heuristic that matched
    // `'advancementTier' in updateData` — a READ — and silenced the exact
    // defect the check exists for. The engine must never repeat that.
    const a = analyze({
      '/src/inop.ts': `
        import { prisma, Prisma } from '@prisma/client'
        export async function go() {
          const updateData: Prisma.WidgetUpdateInput = {}
          if ('ownerName' in updateData) console.log(updateData.ownerName)
          const w = await prisma.widget.findUnique({ where: { id: '1' } })
          console.log(w && w.ownerName)
        }
      `,
    })
    expect(usage(a, 'Widget.ownerName').writers).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Read detection
// ---------------------------------------------------------------------------

describe('read detection', () => {
  it('counts select, where, and entity property access as reads', () => {
    const a = analyze({
      '/src/reads.ts': `
        import { prisma } from '@prisma/client'
        export async function go() {
          const w = await prisma.widget.findUnique({ where: { label: 'x' }, select: { weight: true } })
          const all = await prisma.widget.findMany({ where: { AND: [{ weight: 3 }] } })
          return all[0].ownerName
        }
      `,
    })
    expect(usage(a, 'Widget.label').readers.length).toBeGreaterThan(0)   // where
    expect(usage(a, 'Widget.weight').readers.length).toBeGreaterThan(1)  // select + nested AND where
    expect(usage(a, 'Widget.ownerName').readers.length).toBeGreaterThan(0) // entity access
  })

  it('a where-clause lookup is a READ — the reverse report depends on this', () => {
    // The regex version could not tell `where: { resetToken: token }` from a
    // write, which is what made written-never-read unshippable at 31 findings.
    const a = analyze({
      '/src/lookup.ts': `
        import { prisma } from '@prisma/client'
        export const f = (t: string) => prisma.widget.findMany({ where: { label: t } })
      `,
    })
    expect(usage(a, 'Widget.label').readers).toHaveLength(1)
    expect(usage(a, 'Widget.label').writers).toHaveLength(0)
  })

  it('weak reads attach on untyped access to a unique column name', () => {
    // ownerName exists only on Widget; a UI component reading it off an
    // any-typed prop is exactly the advancementTier reader shape.
    const a = analyze({
      '/src/ui.ts': `
        export function render(w: any) { return w.ownerName }
      `,
    })
    expect(usage(a, 'Widget.ownerName').weakReaders).toHaveLength(1)
  })

  it('weak reads do NOT attach on typed app objects or shared names without affinity', () => {
    const a = analyze({
      '/src/appobj.ts': `
        interface Conflict { label: string }
        export function render(c: Conflict) { return c.label }
      `,
    })
    // label is shared between Widget and WidgetPart AND the access is typed:
    // both rules independently reject it.
    expect(usage(a, 'Widget.label').weakReaders).toHaveLength(0)
    expect(usage(a, 'WidgetPart.label').weakReaders).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Textual fallbacks
// ---------------------------------------------------------------------------

describe('raw SQL and migration fallbacks', () => {
  it('sees UPDATE and INSERT column lists inside $executeRaw only', () => {
    const program = makeProgram({
      '/src/raw.ts': `
        import { prisma } from '@prisma/client'
        export const a = (v: string) => prisma.$executeRaw\`UPDATE "Widget" SET "ownerName" = \${v}\`
        export const b = 'not sql: "weight" = 1'
      `,
    })
    const raw = findRawSqlColumnWrites(program.getSourceFiles(), (f) => f.startsWith('/src/'))
    expect(raw.has('ownerName')).toBe(true)
    // An ordinary string mentioning "weight" = must not count.
    expect(raw.has('weight')).toBe(false)
  })

  it('parses INSERT INTO column lists from migrations', () => {
    const w = findMigrationColumnWrites('INSERT INTO widgets ("id", "label", "weight") VALUES ($1,$2,$3);')
    expect(w.has('label')).toBe(true)
    expect(w.has('weight')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

describe('gates', () => {
  const rawEmpty = new Map<string, never[]>()
  const migEmpty = new Set<string>()

  it('Gate 1 fires on a read-never-written column and names the readers', () => {
    const a = analyze({
      '/src/deadread.ts': `
        import { prisma } from '@prisma/client'
        export const f = () => prisma.widget.findMany({ select: { ownerName: true } })
      `,
    })
    const findings = findReadNeverWritten(a, schema.columns, rawEmpty, migEmpty, {})
    expect(findings.map((f) => `${f.model}.${f.column}`)).toEqual(['Widget.ownerName'])
  })

  it('Gate 1 stays quiet when a raw-SQL write covers the column', () => {
    const a = analyze({
      '/src/deadread.ts': `
        import { prisma } from '@prisma/client'
        export const f = () => prisma.widget.findMany({ select: { ownerName: true } })
      `,
    })
    const raw = new Map([['ownerName', [{ file: '/src/x.ts', line: 1 }]]])
    expect(findReadNeverWritten(a, schema.columns, raw, migEmpty, {})).toEqual([])
  })

  it('Gate 2 fails a waiver that is no longer needed', () => {
    const a = analyze({
      '/src/writer.ts': `
        import { prisma } from '@prisma/client'
        export const f = () => prisma.widget.update({ where: { id: '1' }, data: { ownerName: 'x' } })
      `,
    })
    const stale = findStaleWaivers(a, schema.columns, rawEmpty, migEmpty, { 'Widget.ownerName': 'stale note' })
    expect(stale).toHaveLength(1)
  })

  it('Gate 3 catches a column ENTERING the opaque shadow', () => {
    // The advancementTier shape on an umbrella'd model: readable, no direct
    // writer, model written only opaquely. Gate 1 is excused; Gate 3 is not.
    const a = analyze({
      '/src/shadow.ts': `
        import { prisma } from '@prisma/client'
        export async function go(patch: Record<string, unknown>) {
          await prisma.widget.update({ where: { id: '1' }, data: patch as never })
          return prisma.widget.findMany({ select: { ownerName: true } })
        }
      `,
    })
    expect(findReadNeverWritten(a, schema.columns, rawEmpty, migEmpty, {})).toEqual([])
    const shadow = shadowedColumns(a, schema.columns, rawEmpty, migEmpty)
    const drift = findShadowDrift(shadow, [])
    expect(drift.entered).toEqual(['Widget.ownerName'])
  })

  it('Gate 3 fails a stale shadow entry once the column gains a real writer', () => {
    const a = analyze({
      '/src/visible.ts': `
        import { prisma } from '@prisma/client'
        export const f = () => prisma.widget.update({ where: { id: '1' }, data: { ownerName: 'x' } })
      `,
    })
    const shadow = shadowedColumns(a, schema.columns, rawEmpty, migEmpty)
    const drift = findShadowDrift(shadow, ['Widget.ownerName'])
    expect(drift.left).toEqual(['Widget.ownerName'])
  })

  it('sentinels fail loudly on a doctored analysis', () => {
    const empty: ColumnFlowAnalysis = {
      usage: new Map(),
      modelOpaqueWriters: new Map(),
      health: {
        filesAnalyzed: 0, delegateCallsClassified: 0, columnWritesRecorded: 0,
        symbolReadsRecorded: 0, weakReadsRecorded: 0, opaqueWrites: 0,
        assignmentWrites: 0, annotatedLiteralWrites: 0,
      },
    }
    expect(checkEngineSentinels(empty).length).toBeGreaterThan(0)
  })
})
