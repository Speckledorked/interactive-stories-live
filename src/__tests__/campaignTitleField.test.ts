// src/__tests__/campaignTitleField.test.ts
//
// The Campaign model's display field is `title`. There is no `name` column.
//
// Three separate pages read `campaign.name` anyway and all three rendered
// their `|| 'Story'` / `|| 'Campaign'` fallback on every campaign forever
// (#494). TypeScript never objected, for two different reasons that are
// worth naming because both recur:
//
//   - the story and character pages held the campaign in `useState<any>`,
//     so nothing was checked at all;
//   - the quests page declared its own local `interface Campaign { name }`,
//     which type-checks perfectly against itself while describing a shape
//     the API never returns.
//
// The second is the nastier one: a hand-written local shape is not a weaker
// check, it is a confident wrong answer. So this guard reads the schema for
// the real field and then scans source text, because the thing that needs
// checking is precisely the part the type system was not consulted on.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..')
const SRC = join(ROOT, 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue
      walk(full, out)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

function campaignModel(): string {
  const schema = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8')
  const match = schema.match(/\nmodel Campaign \{([\s\S]*?)\n\}/)
  expect(match, 'the Campaign model must be findable in schema.prisma').toBeTruthy()
  return match![1]
}

describe('Campaign display field', () => {
  it('is `title` in the schema, and there is no `name` column', () => {
    const model = campaignModel()
    expect(model).toMatch(/^\s*title\s+String/m)
    // Anchored to a field declaration: `name` as part of a longer field
    // like `universeName` is fine, a bare `name` column is not.
    expect(model).not.toMatch(/^\s*name\s+\S/m)
  })

  it('is not read as `.name` anywhere in src/', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8')
      source.split('\n').forEach((line, i) => {
        // `campaign.name` / `campaign?.name` / `.campaign.name`, but not
        // `campaignName`, which is a legitimate local variable elsewhere.
        if (/\bcampaign\s*\??\.\s*name\b/.test(line)) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`)
        }
      })
    }
    expect(
      offenders,
      `Campaign has no \`name\` field, so these always read undefined: ${offenders.join(', ')}`
    ).toEqual([])
  })

  it('is not re-declared as `name` by a local Campaign interface', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/\binterface\s+Campaign\b[^{]*\{([\s\S]*?)\n\}/g)) {
        if (/^\s*name\s*\??\s*:/m.test(match[1])) {
          offenders.push(file.slice(ROOT.length + 1))
        }
      }
    }
    expect(
      offenders,
      `A local \`interface Campaign\` declaring \`name\` type-checks against itself but not against the API: ${offenders.join(', ')}`
    ).toEqual([])
  })
})
