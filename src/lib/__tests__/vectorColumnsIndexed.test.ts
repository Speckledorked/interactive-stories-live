// src/lib/__tests__/vectorColumnsIndexed.test.ts
//
// Every pgvector column must have an ANN index declared in a migration.
//
// A missing vector index is the quietest performance bug in the schema.
// Nothing breaks: `ORDER BY embedding <=> $1` still returns exactly the
// right rows, because a sequential scan and sort over every embedded row
// in the table is a correct way to answer the question. It is just linear
// in the table, forever, while the code around it — and its comments —
// describe an approximate-nearest-neighbour lookup.
//
// That is how it went unnoticed twice. #286 found campaign_memories had
// lost its index in the baseline squash; #499 found lore_entries, the only
// other vector column in the schema, had never had one at all. Nothing
// connected the two, so the second was discovered the same way the first
// was: by someone reading the SQL and wondering.
//
// Offline on purpose — its companion, campaignMemoryAnnIndex.liveDb.test.ts,
// proves the index is real and gets planned. This one just refuses to let a
// THIRD vector column be added without one, which is a question about the
// migrations directory, not about a running database.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const SCHEMA = join(REPO_ROOT, 'prisma', 'schema.prisma')
const MIGRATIONS = join(REPO_ROOT, 'prisma', 'migrations')

/** Prisma model name -> the table it maps to, for models with a vector column. */
function modelsWithVectorColumns(): { model: string; table: string }[] {
  const schema = readFileSync(SCHEMA, 'utf8')
  const found: { model: string; table: string }[] = []
  for (const block of schema.matchAll(/\nmodel (\w+) \{([\s\S]*?)\n\}/g)) {
    const [, model, body] = block
    if (!/Unsupported\("vector\(/.test(body)) continue
    const mapped = body.match(/@@map\("([^"]+)"\)/)
    found.push({ model, table: mapped ? mapped[1] : model })
  }
  return found
}

function allMigrationSql(): string {
  if (!existsSync(MIGRATIONS)) return ''
  return readdirSync(MIGRATIONS)
    .map((dir) => join(MIGRATIONS, dir, 'migration.sql'))
    .filter((f) => existsSync(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
}

describe('pgvector columns', () => {
  it('finds the vector columns at all', () => {
    // A schema rename must fail loudly rather than leave nothing to check.
    expect(modelsWithVectorColumns().length).toBeGreaterThanOrEqual(2)
  })

  it('all have an ANN index created in a migration', () => {
    const sql = allMigrationSql()
    const unindexed = modelsWithVectorColumns().filter(({ table }) => {
      const pattern = new RegExp(`CREATE INDEX[^;]*ON\\s+"?${table}"?\\s+USING\\s+hnsw`, 'i')
      return !pattern.test(sql)
    })
    expect(
      unindexed.map((m) => m.table),
      `These tables carry a vector column with no hnsw index, so every similarity ` +
        `search over them is an exact sequential scan: ${unindexed.map((m) => m.table).join(', ')}`
    ).toEqual([])
  })

  it('all index against the cosine operator the queries actually use', () => {
    // An index built for a different distance function is never consulted,
    // which fails exactly as silently as having no index at all.
    const sql = allMigrationSql()
    const wrongOps = modelsWithVectorColumns().filter(({ table }) => {
      const match = sql.match(new RegExp(`CREATE INDEX[^;]*ON\\s+"?${table}"?\\s+USING\\s+hnsw[^;]*;`, 'i'))
      return !match || !match[0].includes('vector_cosine_ops')
    })
    expect(wrongOps.map((m) => m.table), `Indexed for the wrong distance function: ${wrongOps.map((m) => m.table).join(', ')}`).toEqual([])
  })
})
