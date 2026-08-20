// scripts/columnFlowAnalysis.ts
//
// Every column something READS must be a column something WRITES — checked at
// symbol level, per (model, column), across the whole schema.
//
// ## The incidents this exists for
//
// Character.advancementTier shipped with two readers and zero writers. It was
// null on every character forever; the sheet mapped null onto the lowest rung
// and drew a filled bar, so a dead column looked like a working feature parked
// at the start. Typecheck cannot see this (a nullable column is legitimately
// null) and no unit test can (tests supply the value they then assert on).
// The same week: Campaign.advancementTrack was generated and never persisted
// at creation, and a route stopped delivering a field its consumer rendered.
// Every one of these failed silently into a value that is legitimate
// elsewhere.
//
// ## Why the compiler API and not regexes
//
// The first version of this check was regex-based (the deleted
// src/lib/game/__tests__/columnWiring.test.ts). It needed three rounds of
// false-positive fixes — raw SQL embedded in TS, object shorthand as a final
// property, allowlist spreads — and one of its heuristics had to be REMOVED
// because it matched `'advancementTier' in updateData`, a read, silencing the
// exact defect the check exists for. It also matched bare column names with
// no model scoping, so any same-named column on any other model satisfied it,
// and it could not tell a where-clause read from a write — which is why the
// reverse report (written-never-read) produced 31 findings and was
// unshippable.
//
// Symbol-level analysis fixes all four: comments and formatting are invisible
// to an AST, a where-clause is recognized as a read, columns are scoped to
// their model, and renames are followed by the type system.
//
// ## How writes are found (and why not contextual types)
//
// The obvious approach — classify object literals by their contextual type —
// does NOT work at Prisma call sites: the delegate methods are generic over
// `SelectSubset<T, …>` and T is inferred FROM the literal, so
// getContextualType returns the literal's own shape (verified against this
// repo's real program: every `data:` literal came back as `__object`).
//
// The robust primitive is one level up. `tx.campaign` has type
// `Prisma.CampaignDelegate<…>`, declared in the generated client d.ts — that
// symbol names the model outright. So the engine classifies DELEGATE CALLS
// and then navigates their arguments with schema knowledge: `data:` trees are
// writes, `where:`/`select:`/`include:`/`orderBy:` trees are reads, and
// nested relation blocks (`characters: { create: {…} }`) descend into the
// target model. An opaque `data: someVar` still records an opaque write to
// the right model, because the DELEGATE names the model even when the payload
// is a variable.
//
// Two symbol-level layers supplement delegate navigation:
//   - annotated literals (`const d: Prisma.XUpdateInput = {…}`) via contextual
//     type, which DOES resolve for annotations;
//   - assignment LHS (`updateData.harm = x`) where the property symbol is
//     declared in the client d.ts — the dynamically-built update objects in
//     worldUpdaters, once typed.
//
// One deliberately name-based textual layer remains, documented as such: raw
// SQL (`"col" =` inside $executeRaw/$queryRaw template texts) and migration
// backfills/defaults.
//
// ## Readers are generous, writers are precise — on purpose
//
// Gate 1 fires when a column has readers and no writers. Its false alarms
// come from MISSED WRITERS, never from over-counted readers (a column that is
// truly never written deserves the flag whatever the reader's type looks
// like). And under-counted readers would let real defects pass: the UI reads
// columns through `any`-typed props and app-local interfaces that the type
// system cannot connect to Prisma (verified: the character sheet's reads of
// advancementTier are invisible to symbol analysis). So the reader side is a
// union of symbol-level reads AND a name-based AST layer (property access,
// destructuring, select-style `col: true`), while the writer side is strictly
// symbol-level plus the documented textual fallback.

import ts from 'typescript'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface SchemaColumn {
  model: string
  column: string
  type: string
  /** @default / @updatedAt / @id — the database fills it; no app write required. */
  dbFilled: boolean
}

export interface SchemaRelation {
  model: string
  field: string
  target: string
}

export interface ParsedSchema {
  models: string[]
  columns: SchemaColumn[]
  relations: SchemaRelation[]
}

const SCALARS = new Set([
  'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes',
])

export function parseSchema(schemaSource: string): ParsedSchema {
  const models: string[] = []
  const blocks: Array<{ model: string; body: string }> = []
  for (const m of schemaSource.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    models.push(m[1])
    blocks.push({ model: m[1], body: m[2] })
  }
  const modelSet = new Set(models)
  const columns: SchemaColumn[] = []
  const relations: SchemaRelation[] = []
  for (const { model, body } of blocks) {
    for (const f of body.matchAll(/^ {2}(\w+)\s+(\w+)(\[\])?(\??)(.*)$/gm)) {
      const [, field, type, , , rest] = f
      if (SCALARS.has(type) || type.startsWith('Unsupported')) {
        columns.push({
          model,
          column: field,
          type,
          dbFilled: /@default|@updatedAt|@id/.test(rest),
        })
      } else if (modelSet.has(type)) {
        relations.push({ model, field, target: type })
      }
      // enums and attribute lines fall through — not wiring-relevant
    }
  }
  return { models, columns, relations }
}

// ---------------------------------------------------------------------------
// Prisma type-name classification (for annotated literals + assignment LHS)
// ---------------------------------------------------------------------------

export type PrismaTypeKind = 'create' | 'update' | 'where' | 'select' | 'orderBy'

export interface PrismaTypeClass {
  model: string
  kind: PrismaTypeKind
}

const KIND_GRAMMAR: Array<[PrismaTypeKind, RegExp]> = [
  // Container types (CreateOrConnectWithoutXInput, CreateNestedManyWithoutXInput,
  // UpdateOneRequiredWithoutXNestedInput, …) fail every branch by construction:
  // the token after Create/Update is neither Many, Without, nor Input. Their
  // nested literals classify independently, which keeps the grammar small.
  ['create', /^(Unchecked)?Create(Many)?(Without[A-Za-z0-9]+)?Input$/],
  ['update', /^(Unchecked)?Update(Many(Mutation)?)?(Without[A-Za-z0-9]+)?Input$/],
  ['where', /^(Scalar)?Where(Unique)?Input$/],
  ['select', /^Select(Scalar)?$/],
  ['orderBy', /^OrderByWith(Relation|Aggregation)Input$/],
]

/**
 * Longest-model-prefix match WITH backtracking: Character vs
 * CharacterCapability, Campaign vs CampaignMemory — all real collisions in
 * this schema. If the longest prefix leaves an unparsable remainder, the next
 * shorter model is tried rather than giving up.
 */
export function classifyPrismaTypeName(
  typeName: string,
  models: readonly string[]
): PrismaTypeClass | null {
  const candidates = models
    .filter((m) => typeName.startsWith(m))
    .sort((a, b) => b.length - a.length)
  for (const model of candidates) {
    const rest = typeName.slice(model.length)
    for (const [kind, re] of KIND_GRAMMAR) {
      if (re.test(rest)) return { model, kind }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Analysis output
// ---------------------------------------------------------------------------

export interface FileRef {
  file: string
  line: number
}

export interface ColumnUsage {
  writers: FileRef[]
  readers: FileRef[]
  /** Name-based readers only (any-typed props, app interfaces) — part of `readers`. */
  weakReaders: FileRef[]
}

export interface AnalysisHealth {
  filesAnalyzed: number
  delegateCallsClassified: number
  columnWritesRecorded: number
  symbolReadsRecorded: number
  weakReadsRecorded: number
  /** `data: someVar` — an opaque write to a known model. */
  opaqueWrites: number
  assignmentWrites: number
  annotatedLiteralWrites: number
}

export interface ColumnFlowAnalysis {
  /** key `${model}.${column}` */
  usage: Map<string, ColumnUsage>
  /** files that passed an opaque/spread payload into a write for this model */
  modelOpaqueWriters: Map<string, FileRef[]>
  health: AnalysisHealth
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

const WRITE_METHODS = new Set(['create', 'update', 'upsert', 'createMany', 'updateMany', 'createManyAndReturn'])
const READ_METHODS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy', 'delete', 'deleteMany',
])
/** Relation-block keys that carry write payloads for the TARGET model. */
const RELATION_WRITE_KEYS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'set', 'push'])
/** Relation-block keys that carry where payloads for the target model. */
const RELATION_WHERE_KEYS = new Set(['where', 'connect', 'disconnect', 'connectOrCreate', 'delete'])
/** Boolean-logic keys inside where trees that recurse on the SAME model. */
const WHERE_LOGIC_KEYS = new Set(['AND', 'OR', 'NOT'])

export function analyzeColumnFlow(
  program: ts.Program,
  schema: ParsedSchema,
  clientDtsPath: string,
  fileFilter: (fileName: string) => boolean
): ColumnFlowAnalysis {
  const checker = program.getTypeChecker()
  const columnsByModel = new Map<string, Set<string>>()
  for (const c of schema.columns) {
    if (!columnsByModel.has(c.model)) columnsByModel.set(c.model, new Set())
    columnsByModel.get(c.model)!.add(c.column)
  }
  const relationsByModel = new Map<string, Map<string, string>>()
  for (const r of schema.relations) {
    if (!relationsByModel.has(r.model)) relationsByModel.set(r.model, new Map())
    relationsByModel.get(r.model)!.set(r.field, r.target)
  }
  const allColumnNames = new Set(schema.columns.map((c) => c.column))
  const modelSet = new Set(schema.models)

  const usage = new Map<string, ColumnUsage>()
  const modelOpaqueWriters = new Map<string, FileRef[]>()
  const health: AnalysisHealth = {
    filesAnalyzed: 0,
    delegateCallsClassified: 0,
    columnWritesRecorded: 0,
    symbolReadsRecorded: 0,
    weakReadsRecorded: 0,
    opaqueWrites: 0,
    assignmentWrites: 0,
    annotatedLiteralWrites: 0,
  }

  function slot(model: string, column: string): ColumnUsage {
    const key = `${model}.${column}`
    let u = usage.get(key)
    if (!u) {
      u = { writers: [], readers: [], weakReaders: [] }
      usage.set(key, u)
    }
    return u
  }

  function ref(sf: ts.SourceFile, node: ts.Node): FileRef {
    return { file: sf.fileName, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 }
  }

  /** Models this file has TYPED contact with — delegate calls, symbol reads/writes. */
  let currentFileAffinity = new Set<string>()

  // Deduped by exact site: the delegate walk and the annotated-literal walk
  // can both classify the same literal (they do in any codebase whose
  // delegate signatures are not generic), and a double-counted writer would
  // make every count in the health line a lie.
  const seenWrites = new Set<string>()
  const seenReads = new Set<string>()

  function recordWrite(model: string, column: string, r: FileRef) {
    const key = `${model}.${column}@${r.file}:${r.line}`
    if (seenWrites.has(key)) return
    seenWrites.add(key)
    slot(model, column).writers.push(r)
    currentFileAffinity.add(model)
    health.columnWritesRecorded++
  }
  function recordRead(model: string, column: string, r: FileRef) {
    const key = `${model}.${column}@${r.file}:${r.line}`
    if (seenReads.has(key)) return
    seenReads.add(key)
    slot(model, column).readers.push(r)
    currentFileAffinity.add(model)
    health.symbolReadsRecorded++
  }
  function recordOpaque(model: string, r: FileRef) {
    if (!modelOpaqueWriters.has(model)) modelOpaqueWriters.set(model, [])
    modelOpaqueWriters.get(model)!.push(r)
    health.opaqueWrites++
  }

  function propName(p: ts.ObjectLiteralElementLike): string | null {
    if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name) {
      if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return p.name.text
    }
    return null
  }

  /** The model a delegate receiver names, or null. Symbol-checked, not name-guessed. */
  function delegateModel(receiver: ts.Expression): string | null {
    const t = checker.getTypeAtLocation(receiver)
    const name = t.aliasSymbol?.name ?? t.symbol?.name ?? ''
    const m = /^(\w+)Delegate$/.exec(name)
    if (!m || !modelSet.has(m[1])) return null
    const sym = t.aliasSymbol ?? t.symbol
    const inClient = sym?.declarations?.some((d) => d.getSourceFile().fileName === clientDtsPath)
    return inClient ? m[1] : null
  }

  /** Walk a write payload for `model`: scalar keys are writes, relation keys descend. */
  function walkWrite(model: string, node: ts.Expression, sf: ts.SourceFile) {
    if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) walkWrite(model, el, sf)
      return
    }
    if (!ts.isObjectLiteralExpression(node)) {
      // `data: someVar` — opaque, but the delegate already named the model.
      recordOpaque(model, ref(sf, node))
      return
    }
    const cols = columnsByModel.get(model)
    const rels = relationsByModel.get(model)
    for (const p of node.properties) {
      if (ts.isSpreadAssignment(p)) {
        recordOpaque(model, ref(sf, p))
        continue
      }
      const name = propName(p)
      if (!name) continue
      if (cols?.has(name)) {
        recordWrite(model, name, ref(sf, p))
        continue
      }
      const target = rels?.get(name)
      if (target && ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.initializer)) {
        // characters: { create: {…}, connectOrCreate: { where, create }, … }
        for (const inner of p.initializer.properties) {
          const innerName = propName(inner)
          if (!innerName || !ts.isPropertyAssignment(inner)) continue
          if (RELATION_WRITE_KEYS.has(innerName)) walkWrite(target, inner.initializer, sf)
          else if (RELATION_WHERE_KEYS.has(innerName)) walkWhere(target, inner.initializer, sf)
          else if (innerName === 'connectOrCreate') walkConnectOrCreate(target, inner.initializer, sf)
        }
      }
    }
  }

  function walkConnectOrCreate(model: string, node: ts.Expression, sf: ts.SourceFile) {
    const items = ts.isArrayLiteralExpression(node) ? node.elements : [node]
    for (const item of items) {
      if (!ts.isObjectLiteralExpression(item)) continue
      for (const p of item.properties) {
        const name = propName(p)
        if (!name || !ts.isPropertyAssignment(p)) continue
        if (name === 'create') walkWrite(model, p.initializer, sf)
        if (name === 'where') walkWhere(model, p.initializer, sf)
      }
    }
  }

  /** Walk a where tree: scalar keys are reads, AND/OR/NOT recurse, relations descend. */
  function walkWhere(model: string, node: ts.Expression, sf: ts.SourceFile) {
    if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) walkWhere(model, el, sf)
      return
    }
    if (!ts.isObjectLiteralExpression(node)) return
    const cols = columnsByModel.get(model)
    const rels = relationsByModel.get(model)
    for (const p of node.properties) {
      const name = propName(p)
      if (!name) continue
      if (WHERE_LOGIC_KEYS.has(name) && ts.isPropertyAssignment(p)) {
        walkWhere(model, p.initializer, sf)
        continue
      }
      if (cols?.has(name)) {
        recordRead(model, name, ref(sf, p))
        continue
      }
      const target = rels?.get(name)
      if (target && ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.initializer)) {
        // relation filters: { some: {…} } / { every: {…} } / { none: {…} } / direct
        for (const inner of p.initializer.properties) {
          const innerName = propName(inner)
          if (!ts.isPropertyAssignment(inner)) continue
          if (innerName && ['some', 'every', 'none', 'is', 'isNot'].includes(innerName)) {
            walkWhere(target, inner.initializer, sf)
          }
        }
        walkWhere(target, p.initializer, sf)
      }
    }
  }

  /** Walk a select/include tree: `col: true` is a read, relations descend. */
  function walkSelect(model: string, node: ts.Expression, sf: ts.SourceFile) {
    if (!ts.isObjectLiteralExpression(node)) return
    const cols = columnsByModel.get(model)
    const rels = relationsByModel.get(model)
    for (const p of node.properties) {
      const name = propName(p)
      if (!name) continue
      if (cols?.has(name)) {
        recordRead(model, name, ref(sf, p))
        continue
      }
      const target = rels?.get(name)
      if (target && ts.isPropertyAssignment(p)) {
        if (ts.isObjectLiteralExpression(p.initializer)) {
          for (const inner of p.initializer.properties) {
            const innerName = propName(inner)
            if (!ts.isPropertyAssignment(inner)) continue
            if (innerName === 'select' || innerName === 'include') walkSelect(target, inner.initializer, sf)
            if (innerName === 'where') walkWhere(target, inner.initializer, sf)
          }
        }
        // `relation: true` in an include — a read of the relation, no columns named
      }
    }
  }

  function walkDelegateArgs(model: string, method: string, arg: ts.Expression, sf: ts.SourceFile) {
    if (!ts.isObjectLiteralExpression(arg)) {
      if (WRITE_METHODS.has(method)) recordOpaque(model, ref(sf, arg))
      return
    }
    for (const p of arg.properties) {
      const name = propName(p)
      if (!name || !ts.isPropertyAssignment(p)) {
        if (ts.isSpreadAssignment(p) && WRITE_METHODS.has(method)) recordOpaque(model, ref(sf, p))
        // Shorthand `data,` — the payload is a variable built elsewhere
        // (verified real: the user PATCH route builds an app-typed `data`
        // object and passes it by shorthand). The delegate still names the
        // model, so this is an opaque write, not nothing.
        if (ts.isShorthandPropertyAssignment(p) && name === 'data' && WRITE_METHODS.has(method)) {
          recordOpaque(model, ref(sf, p))
        }
        continue
      }
      switch (name) {
        case 'data':
          walkWrite(model, p.initializer, sf)
          break
        case 'create':
        case 'update':
          // upsert's two halves
          if (method === 'upsert') walkWrite(model, p.initializer, sf)
          break
        case 'where':
        case 'cursor':
          walkWhere(model, p.initializer, sf)
          break
        case 'select':
        case 'include':
          walkSelect(model, p.initializer, sf)
          break
        case 'orderBy':
          walkWhere(model, p.initializer, sf)
          break
        case 'distinct': {
          // distinct: ['colA', 'colB'] — reads by scalar field name
          const cols = columnsByModel.get(model)
          const items = ts.isArrayLiteralExpression(p.initializer) ? p.initializer.elements : [p.initializer]
          for (const el of items) {
            if (ts.isStringLiteral(el) && cols?.has(el.text)) recordRead(model, el.text, ref(sf, el))
          }
          break
        }
      }
    }
  }

  /** Enclosing named type of a declaration inside the client d.ts. */
  function enclosingClientTypeName(decl: ts.Declaration): string | null {
    let cur: ts.Node | undefined = decl
    while (cur) {
      if (ts.isTypeAliasDeclaration(cur) || ts.isInterfaceDeclaration(cur)) return cur.name.text
      cur = cur.parent
    }
    return null
  }

  const ownersByColumnName = new Map<string, string[]>()
  for (const c of schema.columns) {
    if (!ownersByColumnName.has(c.column)) ownersByColumnName.set(c.column, [])
    ownersByColumnName.get(c.column)!.push(c.model)
  }

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue
    if (!fileFilter(sf.fileName)) continue
    health.filesAnalyzed++
    currentFileAffinity = new Set<string>()

    const visit = (node: ts.Node) => {
      // Delegate calls: prisma.character.update({...}), tx.campaign.create({...})
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (WRITE_METHODS.has(node.expression.name.text) || READ_METHODS.has(node.expression.name.text))
      ) {
        const model = delegateModel(node.expression.expression)
        if (model) {
          health.delegateCallsClassified++
          currentFileAffinity.add(model)
          const method = node.expression.name.text
          if (node.arguments.length > 0) {
            walkDelegateArgs(model, method, node.arguments[0], sf)
          } else if (WRITE_METHODS.has(method)) {
            recordOpaque(model, ref(sf, node))
          }
        }
      }

      // Annotated literals: const d: Prisma.CampaignUpdateInput = {…}
      // Contextual types DO resolve for annotations (unlike call-site inference).
      if (ts.isObjectLiteralExpression(node)) {
        const ctx = checker.getContextualType(node)
        if (ctx) {
          const parts = ctx.isUnion() ? ctx.types : [ctx]
          for (const part of parts) {
            const sym = part.aliasSymbol ?? part.symbol
            const name = sym?.name ?? ''
            const cls = classifyPrismaTypeName(name, schema.models)
            if (!cls) continue
            const inClient = sym?.declarations?.some((d) => d.getSourceFile().fileName === clientDtsPath)
            if (!inClient) continue
            if (cls.kind === 'create' || cls.kind === 'update') {
              health.annotatedLiteralWrites++
              walkWrite(cls.model, node, sf)
            } else if (cls.kind === 'where') {
              walkWhere(cls.model, node, sf)
            } else if (cls.kind === 'select') {
              walkSelect(cls.model, node, sf)
            }
            break
          }
        }
      }

      // Assignment LHS: updateData.advancementTier = resolved, where updateData
      // is typed as a Prisma input. The property symbol resolves into the
      // client d.ts and its enclosing type names the model and direction.
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        allColumnNames.has(node.left.name.text)
      ) {
        const sym = checker.getSymbolAtLocation(node.left.name)
        const decl = sym?.declarations?.find((d) => d.getSourceFile().fileName === clientDtsPath)
        if (decl) {
          const owner = enclosingClientTypeName(decl)
          const cls = owner ? classifyPrismaTypeName(owner, schema.models) : null
          if (cls && (cls.kind === 'create' || cls.kind === 'update')) {
            const column = node.left.name.text
            if (columnsByModel.get(cls.model)?.has(column)) {
              recordWrite(cls.model, column, ref(sf, node))
              health.assignmentWrites++
            }
          }
        }
      }

      // Symbol-level entity reads: character.harm where the property symbol is
      // declared in the client d.ts ($XPayload scalars, entity aliases, inputs).
      if (
        ts.isPropertyAccessExpression(node) &&
        allColumnNames.has(node.name.text) &&
        !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.parent.left === node)
      ) {
        const sym = checker.getSymbolAtLocation(node.name)
        const decl = sym?.declarations?.find((d) => d.getSourceFile().fileName === clientDtsPath)
        if (decl) {
          const owner = enclosingClientTypeName(decl)
          if (owner) {
            const payload = /^\$(\w+)Payload$/.exec(owner)
            const model = payload && modelSet.has(payload[1])
              ? payload[1]
              : modelSet.has(owner)
                ? owner
                : classifyPrismaTypeName(owner, schema.models)?.model ?? null
            if (model && columnsByModel.get(model)?.has(node.name.text)) {
              recordRead(model, node.name.text, ref(sf, node))
            }
          }
        }
      }

      ts.forEachChild(node, visit)
    }
    visit(sf)

    // Name-based weak reads, one pass per file. They exist because the UI
    // reads columns through `any`-typed props the type system cannot connect
    // to Prisma (verified: the sheet's reads of advancementTier are invisible
    // to symbol analysis). Weak reads can only make Gate 1 fire, never
    // suppress it. Two restrictions, both arrived at by running this on the
    // real tree:
    //
    //  - TYPED accesses are skipped: if the property resolves to declared
    //    symbols, the symbol layer has already adjudicated it. Without this,
    //    `conflict.resolution` on an app interface credited
    //    PlayerAction.resolution with readers, and `prisma.location` — the
    //    DELEGATE — read as Scene.location.
    //  - A column name owned by ONE model attaches to it; a SHARED name
    //    (title, location, resolution…) attaches only to models this file
    //    has typed contact with, because a wiki client's `.title` accessor
    //    is not evidence about any database column.
    const weakVisit = (node: ts.Node) => {
      let name: string | null = null
      if (ts.isPropertyAccessExpression(node) && allColumnNames.has(node.name.text)) {
        const sym = checker.getSymbolAtLocation(node.name)
        if (sym && (sym.declarations?.length ?? 0) > 0) {
          ts.forEachChild(node, weakVisit)
          return
        }
        name = node.name.text
      }
      else if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && allColumnNames.has(node.name.text) && !node.propertyName) {
        const sym = checker.getSymbolAtLocation(node.name)
        // For a binding element the NAME declares a fresh local; ask instead
        // whether the destructured SOURCE property is a declared symbol.
        const src = sym && checker.getTypeAtLocation(node.parent)?.getProperty?.(node.name.text)
        if (src && (src.declarations?.length ?? 0) > 0) {
          ts.forEachChild(node, weakVisit)
          return
        }
        name = node.name.text
      }
      else if (ts.isBindingElement(node) && node.propertyName && ts.isIdentifier(node.propertyName) && allColumnNames.has(node.propertyName.text)) {
        const src = checker.getTypeAtLocation(node.parent)?.getProperty?.(node.propertyName.text)
        if (src && (src.declarations?.length ?? 0) > 0) {
          ts.forEachChild(node, weakVisit)
          return
        }
        name = node.propertyName.text
      }
      if (name) {
        const owners = ownersByColumnName.get(name) ?? []
        const targets = owners.length === 1 ? owners : owners.filter((m) => currentFileAffinity.has(m))
        for (const model of targets) {
          slot(model, name).weakReaders.push(ref(sf, node))
          slot(model, name).readers.push(ref(sf, node))
          health.weakReadsRecorded++
        }
      }
      ts.forEachChild(node, weakVisit)
    }
    weakVisit(sf)
  }

  return { usage, modelOpaqueWriters, health }
}

// ---------------------------------------------------------------------------
// Textual fallbacks — the one deliberately name-based write layer
// ---------------------------------------------------------------------------

/**
 * `"col" = …` inside template literals that are tagged $executeRaw/$queryRaw
 * (or arguments to their Unsafe variants). AST-scoped to those call shapes so
 * ordinary strings cannot masquerade as SQL writes.
 */
export function findRawSqlColumnWrites(
  sourceFiles: readonly ts.SourceFile[],
  fileFilter: (fileName: string) => boolean
): Map<string, FileRef[]> {
  const out = new Map<string, FileRef[]>()
  const add = (col: string, r: FileRef) => {
    if (!out.has(col)) out.set(col, [])
    out.get(col)!.push(r)
  }
  const RAW_TAGS = /\$(execute|query)Raw(Unsafe)?$/
  for (const sf of sourceFiles) {
    if (sf.isDeclarationFile || !fileFilter(sf.fileName)) continue
    const visit = (node: ts.Node) => {
      let texts: string[] = []
      if (ts.isTaggedTemplateExpression(node) && RAW_TAGS.test(node.tag.getText())) {
        texts = [node.template.getText()]
      } else if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        RAW_TAGS.test(node.expression.name.text)
      ) {
        texts = node.arguments.map((a) => a.getText())
      }
      for (const text of texts) {
        const r = { file: sf.fileName, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 }
        for (const m of text.matchAll(/"(\w+)"\s*=/g)) add(m[1], r)
        // INSERT INTO table ("colA", "colB", …) — memory and lore rows are
        // created this way (pgvector embeddings force raw SQL), and an
        // UPDATE-shaped regex alone reported every such column as unwritten.
        for (const m of text.matchAll(/INSERT\s+INTO\s+\S+\s*\(([^)]*)\)/gi)) {
          for (const col of m[1].matchAll(/"?([A-Za-z_]\w*)"?/g)) add(col[1], r)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return out
}

/** Columns written by migrations: backfills, INSERTs, and column-adds carrying DEFAULT. */
export function findMigrationColumnWrites(migrationSql: string): Set<string> {
  const out = new Set<string>()
  for (const m of migrationSql.matchAll(/"(\w+)"\s*=/g)) out.add(m[1])
  for (const m of migrationSql.matchAll(/ADD COLUMN\s+"(\w+)"[^;]*DEFAULT/g)) out.add(m[1])
  for (const m of migrationSql.matchAll(/INSERT\s+INTO\s+\S+\s*\(([^)]*)\)/gi)) {
    for (const col of m[1].matchAll(/"?([A-Za-z_]\w*)"?/g)) out.add(col[1])
  }
  return out
}

// ---------------------------------------------------------------------------
// Waivers
// ---------------------------------------------------------------------------

/**
 * Columns with a real write this engine cannot see, keyed `Model.column`,
 * each naming the concrete mechanism and file. Self-pruning: Gate 2 fails
 * when an entry stops being necessary, so this cannot rot into a suppression
 * file. Expected empty — the delegate layer sees opaque payloads and spreads
 * natively, which is what emptied the old check's DYNAMIC_WRITES list.
 */
export const DYNAMIC_WRITES: Record<string, string> = {}

/**
 * Columns whose only write cover is their model's opaque-payload umbrella —
 * recorded BY NAME, because the umbrella is exactly where the next
 * advancementTier hides.
 *
 * A `data: someVar` write excuses every column of its model from Gate 1: the
 * engine knows the model but not which columns the variable carried. That
 * shadow measured 33 columns on the day this shipped, and Character.
 * advancementTier — the incident this whole check exists for — would sit
 * inside it invisibly if the umbrella were left as a blanket excuse.
 *
 * So the shadow is a RATCHET, not an allowance: every currently-shadowed
 * column is listed here, a column that ENTERS the shadow fails Gate 3 (write
 * it visibly, read it visibly, or record it here with eyes open), and a
 * column that LEAVES the shadow — gains a direct writer, loses its readers —
 * fails as stale so the list cannot rot. Same contract as every allowlist in
 * this repo.
 */
export const OPAQUE_SHADOW: readonly string[] = [
  'CampaignArchetype.description',
  'CampaignArchetype.name',
  'CampaignArchetype.startingTie',
  'CampaignCapability.description',
  'Character.gmNotes',
  'EventWitness.characterId',
  'EventWitness.npcId',
  'EventWitness.worldEventId',
  'Faction.beliefVector',
  'LoreCitation.sceneId',
  'LoreCitation.similarity',
  'LoreImportJob.alertedStuckAt',
  'NPC.currentPlan',
  'NPC.disposition',
  'Quest.givenByFactionId',
  'Quest.givenByNpcId',
  'Quest.resolvedAt',
  'ResolutionJob.alertedStuckAt',
  'TimelineEvent.gmNotes',
  'User.name',
  'User.orientationSeenAt',
  'User.themePreference',
  'UserNotificationSettings.quietHoursEnd',
  'UserNotificationSettings.quietHoursStart',
  'UserNotificationSettings.timezone',
  'WorldEvent.checkKey',
  'WorldEvent.originLocationId',
  'WorldEvent.wakeSourceType',
  'WorldMeta.chronicleNarration',
]

/** A column's shadow status, for Gate 3. */
export function shadowedColumns(
  analysis: ColumnFlowAnalysis,
  columns: readonly SchemaColumn[],
  rawSqlWrites: ReadonlyMap<string, FileRef[]>,
  migrationWrites: ReadonlySet<string>
): string[] {
  const out: string[] = []
  for (const c of columns) {
    if (c.dbFilled) continue
    const key = `${c.model}.${c.column}`
    const u = analysis.usage.get(key)
    if (!u || u.readers.length === 0) continue
    if (u.writers.length > 0) continue
    if (rawSqlWrites.has(c.column) || migrationWrites.has(c.column)) continue
    if ((analysis.modelOpaqueWriters.get(c.model) ?? []).length > 0) out.push(key)
  }
  return out.sort()
}

export interface ShadowDrift {
  entered: string[]
  left: string[]
}

/** Gate 3: the opaque shadow may not grow, and its record may not go stale. */
export function findShadowDrift(
  current: readonly string[],
  recorded: readonly string[] = OPAQUE_SHADOW
): ShadowDrift {
  const cur = new Set(current)
  const rec = new Set(recorded)
  return {
    entered: current.filter((k) => !rec.has(k)),
    left: recorded.filter((k) => !cur.has(k)),
  }
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export interface WiringFinding {
  model: string
  column: string
  readers: FileRef[]
}

function hasWriteSomewhere(
  key: string,
  model: string,
  column: string,
  analysis: ColumnFlowAnalysis,
  rawSqlWrites: ReadonlyMap<string, FileRef[]>,
  migrationWrites: ReadonlySet<string>
): boolean {
  const u = analysis.usage.get(key)
  if (u && u.writers.length > 0) return true
  if ((analysis.modelOpaqueWriters.get(model) ?? []).length > 0) return true
  if (rawSqlWrites.has(column)) return true
  if (migrationWrites.has(column)) return true
  return false
}

/**
 * Gate 1: a column with readers and no writer of any kind. This is the
 * advancementTier defect, generalized: the column holds its default forever
 * while the UI renders it as though it meant something.
 */
export function findReadNeverWritten(
  analysis: ColumnFlowAnalysis,
  columns: readonly SchemaColumn[],
  rawSqlWrites: ReadonlyMap<string, FileRef[]>,
  migrationWrites: ReadonlySet<string>,
  waivers: Record<string, string> = DYNAMIC_WRITES
): WiringFinding[] {
  const out: WiringFinding[] = []
  for (const c of columns) {
    if (c.dbFilled) continue
    const key = `${c.model}.${c.column}`
    if (waivers[key]) continue
    const u = analysis.usage.get(key)
    if (!u || u.readers.length === 0) continue
    if (hasWriteSomewhere(key, c.model, c.column, analysis, rawSqlWrites, migrationWrites)) continue
    out.push({ model: c.model, column: c.column, readers: u.readers.slice(0, 5) })
  }
  return out
}

/** Gate 2: waivers whose column is gone, or which are no longer needed. */
export function findStaleWaivers(
  analysis: ColumnFlowAnalysis,
  columns: readonly SchemaColumn[],
  rawSqlWrites: ReadonlyMap<string, FileRef[]>,
  migrationWrites: ReadonlySet<string>,
  waivers: Record<string, string> = DYNAMIC_WRITES
): string[] {
  const known = new Set(columns.map((c) => `${c.model}.${c.column}`))
  const stale: string[] = []
  for (const key of Object.keys(waivers)) {
    if (!known.has(key)) {
      stale.push(`${key}: no longer a schema column — remove the waiver`)
      continue
    }
    const [model, column] = key.split('.')
    if (hasWriteSomewhere(key, model, column, analysis, rawSqlWrites, migrationWrites)) {
      stale.push(`${key}: a write is now visible to the engine — remove the waiver`)
    }
  }
  return stale
}

/**
 * Report (never a gate): columns something writes and nothing reads — not
 * even by name. Credible now that where-clauses and selects count as reads;
 * printed as the evidence base for a future gate decision.
 */
export function reportWrittenNeverRead(
  analysis: ColumnFlowAnalysis,
  columns: readonly SchemaColumn[]
): WiringFinding[] {
  const out: WiringFinding[] = []
  for (const c of columns) {
    if (c.dbFilled) continue
    const u = analysis.usage.get(`${c.model}.${c.column}`)
    if (!u) continue
    if (u.writers.length > 0 && u.readers.length === 0) {
      out.push({ model: c.model, column: c.column, readers: [] })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Engine self-proof
// ---------------------------------------------------------------------------

export interface Sentinel {
  key: string
  expect: 'reader+writer' | 'writer-in-file' | 'opaque-or-writer'
  file?: string
  why: string
}

/**
 * Known-good wirings the engine must rediscover before its verdict on
 * anything else counts. A check that could not run has not passed (#443), and
 * an engine that silently lost a detection layer would otherwise report a
 * clean schema with a straight face.
 */
export const ENGINE_SENTINELS: Sentinel[] = [
  {
    key: 'Character.harm',
    expect: 'reader+writer',
    why: 'The most-trafficked gameplay column; if either side is missing, a whole layer is dead.',
  },
  {
    // Health only: SOME writer must be visible (creation, backfill, reseed).
    // "Specifically the creation-path writer" is a REGRESSION question, not an
    // engine-health question, and it belongs to the manifest's `persist` role
    // — an early sentinel abort would misreport a real regression as engine
    // breakage and hide the manifest's precise finding.
    key: 'Campaign.advancementTrack',
    expect: 'opaque-or-writer',
    why: 'A generated-once Json column with multiple write paths; all invisible means the write layers are dead.',
  },
  {
    key: 'Character.advancementTier',
    expect: 'reader+writer',
    why: 'The original two-readers-zero-writers defect, now fixed; the engine must keep seeing both sides.',
  },
  {
    key: 'UserNotificationSettings.quietHoursStart',
    expect: 'opaque-or-writer',
    why: 'Written via an allowlist spread — proves opaque/spread detection works.',
  },
]

export function checkEngineSentinels(
  analysis: ColumnFlowAnalysis,
  sentinels: readonly Sentinel[] = ENGINE_SENTINELS
): string[] {
  const failures: string[] = []
  for (const s of sentinels) {
    const [model] = s.key.split('.')
    const u = analysis.usage.get(s.key)
    const opaque = (analysis.modelOpaqueWriters.get(model) ?? []).length > 0
    switch (s.expect) {
      case 'reader+writer':
        if (!u || u.readers.length === 0) failures.push(`${s.key}: no readers found — ${s.why}`)
        if (!u || (u.writers.length === 0 && !opaque)) failures.push(`${s.key}: no writers found — ${s.why}`)
        break
      case 'writer-in-file':
        if (!u || !u.writers.some((w) => w.file.endsWith(s.file!)))
          failures.push(`${s.key}: expected a writer in ${s.file} — ${s.why}`)
        break
      case 'opaque-or-writer':
        if ((!u || u.writers.length === 0) && !opaque)
          failures.push(`${s.key}: neither a direct writer nor an opaque/spread write — ${s.why}`)
        break
    }
  }
  return failures
}
