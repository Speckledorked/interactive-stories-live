// src/lib/lore/textChunker.ts
// Splits a document's plain text into embedding-sized chunks. Pure — no
// I/O — so a whole PDF-of-lore-in-waiting from a paste, URL, or wiki page
// ends up as several separately-searchable LoreEntry rows instead of one
// giant blob that either blows past the embedding input limit or drowns
// out everything else at retrieval time.

export interface ChunkOptions {
  // Target chunk size. Comfortably under embeddingService's 8000-char
  // truncation limit, and small enough that a single retrieved chunk is a
  // reasonably focused, quotable piece of lore rather than a whole article.
  maxChars?: number
  // How much of the tail of one chunk to repeat at the start of the next,
  // so a fact split across a chunk boundary isn't orphaned from its
  // surrounding context in either chunk.
  overlapChars?: number
}

export interface TextChunk {
  title: string
  content: string
}

const DEFAULT_MAX_CHARS = 1800
const DEFAULT_OVERLAP_CHARS = 200

/**
 * Split text into chunks on paragraph boundaries where possible, falling
 * back to sentence boundaries for any single paragraph longer than
 * maxChars on its own. Each chunk is titled "<title>" (single chunk) or
 * "<title> (part N)" (multiple).
 */
export function chunkText(text: string, title: string, options: ChunkOptions = {}): TextChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS

  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)

  const pieces: string[] = []
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      pieces.push(paragraph)
      continue
    }
    // A single paragraph longer than maxChars — split on sentences instead.
    const sentences = paragraph.match(/[^.!?]+[.!?]+(\s|$)/g) || [paragraph]
    let current = ''
    for (const sentence of sentences) {
      if (current && (current.length + sentence.length) > maxChars) {
        pieces.push(current.trim())
        current = sentence
      } else {
        current += sentence
      }
    }
    if (current.trim()) pieces.push(current.trim())
  }

  // Last-resort hard cut: text with no sentence punctuation at all (a
  // single unbroken run of words, or one "sentence" that's itself still
  // longer than maxChars) would otherwise pass through untouched above.
  const hardCut: string[] = []
  for (const piece of pieces) {
    if (piece.length <= maxChars) {
      hardCut.push(piece)
      continue
    }
    for (let i = 0; i < piece.length; i += maxChars) {
      hardCut.push(piece.slice(i, i + maxChars))
    }
  }

  const chunks: string[] = []
  let current = ''
  for (const piece of hardCut) {
    const candidate = current ? `${current}\n\n${piece}` : piece
    if (candidate.length > maxChars && current) {
      chunks.push(current)
      // Carry the tail of the previous chunk forward for continuity.
      // (str.slice(-0) === str.slice(0) — the WHOLE string — in JS, since
      // -0 === 0, so overlapChars <= 0 must short-circuit to '' explicitly.)
      const overlap = overlapChars > 0 ? current.slice(-overlapChars) : ''
      current = overlap ? `${overlap}\n\n${piece}` : piece
    } else {
      current = candidate
    }
  }
  if (current.trim()) chunks.push(current)

  if (chunks.length <= 1) {
    return chunks.map(content => ({ title, content }))
  }
  return chunks.map((content, i) => ({ title: `${title} (part ${i + 1})`, content }))
}
