// scripts/generatedFlowVerify.ts
//
// Verifies src/lib/game/generatedColumnFlow.ts's manifest against the code,
// using the same AST/engine facts as the schema-wide wiring check instead of
// the regexes it replaces.
//
// The regex version needed a hand-rolled comment stripper, because
// advancementTrack.ts's header names all four sibling columns in prose and an
// unstripped scan counted the comment describing the bug as participation in
// it. An AST token scan has no such problem: comments are structurally
// invisible. The old string `evidence` was refactor-hostile too — it embedded
// formatting ('campaign: { advancementTrack') that Prettier or a rename would
// break. Evidence is structured now, and the two Prisma kinds are checked
// against the ENGINE's recorded writers/readers, which is the same
// symbol-level fact Gate 1 runs on.

import ts from 'typescript'
import { relative } from 'path'
import type { ColumnFlowAnalysis } from './columnFlowAnalysis'
import {
  roleOf,
  evidenceOf,
  type DataFlow,
  type FlowViolation,
} from '../src/lib/game/generatedColumnFlow'

/**
 * Does this file's CODE mention the symbol? Identifiers, property names, and
 * string/template literal text count; comments cannot, by construction.
 */
export function fileMentionsSymbol(sf: ts.SourceFile, symbol: string): boolean {
  let found = false
  const visit = (node: ts.Node) => {
    if (found) return
    if (ts.isIdentifier(node) && node.text === symbol) found = true
    else if (ts.isStringLiteralLike(node) && node.text.includes(symbol)) found = true
    else if (ts.isTemplateExpression(node)) {
      if (node.head.text.includes(symbol)) found = true
      for (const span of node.templateSpans) if (span.literal.text.includes(symbol)) found = true
    }
    if (!found) ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** Is `key` a property name in some object literal in this file? */
export function fileHasPayloadKey(sf: ts.SourceFile, key: string): boolean {
  let found = false
  const visit = (node: ts.Node) => {
    if (found) return
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      node.name &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === key
    ) {
      found = true
    }
    if (!found) ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** Is `key` inside some string/template literal in this file (prompt tags)? */
export function fileHasStringKey(sf: ts.SourceFile, key: string): boolean {
  let found = false
  const visit = (node: ts.Node) => {
    if (found) return
    if (ts.isStringLiteralLike(node) && node.text.includes(key)) found = true
    else if (ts.isTemplateExpression(node)) {
      if (node.head.text.includes(key)) found = true
      for (const span of node.templateSpans) if (span.literal.text.includes(key)) found = true
    }
    if (!found) ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

export function verifyManifest(
  program: ts.Program,
  analysis: ColumnFlowAnalysis,
  flows: readonly DataFlow[],
  inScope: (fileName: string) => boolean,
  root: string
): FlowViolation[] {
  const out: FlowViolation[] = []
  const files = new Map<string, ts.SourceFile>()
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !inScope(sf.fileName)) continue
    files.set(relative(root, sf.fileName), sf)
  }

  for (const flow of flows) {
    const usageKey = `Campaign.${flow.symbol}`
    const usage = analysis.usage.get(usageKey)
    const writersByFile = new Set((usage?.writers ?? []).map((w) => relative(root, w.file)))
    const readersByFile = new Set((usage?.readers ?? []).map((r) => relative(root, r.file)))

    // The manifest names every symbol it governs, so its own file (and this
    // verifier) must not count as participants.
    // The manifest and the check infrastructure name every symbol they
    // govern (sentinels, evidence keys), so neither may count as a
    // participant — the first real run flagged the engine's own sentinel
    // list as an undeclared consumer of advancementTrack.
    const isSelf = (p: string) => p.includes('generatedColumnFlow') || p.startsWith('scripts/')

    const declared = Object.keys(flow.roles)
    const declaredSet = new Set(declared)

    for (const [file, entry] of Object.entries(flow.roles)) {
      const sf = files.get(file)
      if (!sf) {
        out.push({ fact: flow.fact, problem: `declares ${file}, which is not in the analyzed program` })
        continue
      }
      // (1) a declared file must still participate
      if (!fileMentionsSymbol(sf, flow.symbol)) {
        out.push({
          fact: flow.fact,
          problem:
            `declares ${file}, whose code no longer mentions ${flow.symbol}. Either the link was ` +
            `removed (fix the code) or the role moved (fix the manifest).`,
        })
        continue
      }
      // (2) structured evidence must hold — ALL pieces of it
      const evidences = evidenceOf(entry)
      const role = roleOf(entry)
      if (evidences.some((e) => e.kind === 'prisma-write') || role === 'persist' || role === 'backfill') {
        // Role semantics carry the guarantee even without explicit evidence:
        // persist/backfill ARE writes, and the engine must have seen one here.
        if (!writersByFile.has(file)) {
          out.push({
            fact: flow.fact,
            problem:
              `${file} (${role}) — the engine records no Prisma write of ${flow.symbol} in this file. ` +
              `The file still references the symbol, so participation alone looks healthy, but the ` +
              `write itself is gone. ${flow.why}`,
          })
        }
      }
      for (const evidence of evidences) {
        if (evidence.kind === 'prisma-read' && !readersByFile.has(file)) {
          out.push({
            fact: flow.fact,
            problem:
              `${file} (${role}) — the engine records no Prisma read of ${flow.symbol} in this file; ` +
              `the delivery it evidences is gone. ${flow.why}`,
          })
        }
        if (evidence.kind === 'payload-key' && !fileHasPayloadKey(sf, evidence.key)) {
          out.push({
            fact: flow.fact,
            problem: `${file} (${role}) — no object literal in this file carries the key \`${evidence.key}\`.`,
          })
        }
        if (evidence.kind === 'string-key' && !fileHasStringKey(sf, evidence.key)) {
          out.push({
            fact: flow.fact,
            problem: `${file} (${role}) — no string/template literal in this file contains \`${evidence.key}\`.`,
          })
        }
      }
    }

    // (3) THE assertion: every participating file is declared. A new consumer
    // nobody declared is the shape of every defect this manifest exists for.
    for (const [relPath, sf] of files) {
      if (declaredSet.has(relPath) || isSelf(relPath)) continue
      if (fileMentionsSymbol(sf, flow.symbol)) {
        out.push({
          fact: flow.fact,
          problem:
            `${relPath} uses ${flow.symbol} but is not in its flow manifest. Add it with a role — ` +
            `and while you are there, check the rest of the chain reaches it. ${flow.why}`,
        })
      }
    }
  }
  return out
}
