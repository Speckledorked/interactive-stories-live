// src/lib/game/mechanicsUnavailable.ts
//
// The player-facing sentence for "this exchange resolved without real dice".
//
// ## Why this is its own module
//
// The message used to be a single hardcoded string that blamed "an API
// issue" for every cause, and on 2026-08-18 it said exactly that while the
// classifier call had SUCCEEDED and been billed $0.00127. The model had
// returned `stat_key: null`, the schema layer had correctly refused it, and
// the banner sent anyone reading it to look at OpenAI's status page.
//
// A wrong attribution is worse than a vague one: it does not merely fail to
// help, it actively misdirects. So the cause is now carried through from
// resolution.ts and the wording follows it.
//
// Pure and separate so the wording is testable without a scene, a database
// or a model call.

export type MechanicsUnavailableReason = 'no-api-key' | 'api-error' | 'unusable-output'

export interface MechanicsUnavailableInput {
  _mechanicsUnavailable?: boolean
  _mechanicsUnavailableReason?: MechanicsUnavailableReason
  _mechanicsDroppedFields?: string[]
}

/**
 * Distinct field paths, in stable order, without repeating one that failed
 * on several actions in the same exchange.
 */
function summarizeFields(fields: string[]): string {
  const unique = [...new Set(fields.filter(Boolean))]
  if (unique.length === 0) return ''
  if (unique.length === 1) return unique[0]
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`
}

/**
 * The banner text, or null when the dice engine ran normally.
 *
 * Every branch says the same operational thing — this exchange resolved as
 * freeform narration rather than real rolls — and then differs on the cause,
 * because that is the part that decides where someone looks next.
 */
export function mechanicsUnavailableDetails(input: MechanicsUnavailableInput): string | null {
  if (!input._mechanicsUnavailable) return null

  const tail = ' — every action resolved as freeform narration instead of a real roll.'

  switch (input._mechanicsUnavailableReason) {
    case 'no-api-key':
      // Configuration, not a fault, and not something a player can wait out.
      return 'The dice engine is not configured on this deployment' + tail

    case 'unusable-output': {
      // The distinction this module exists for. The call worked and was paid
      // for; what came back could not be trusted, so it was refused rather
      // than guessed at.
      const fields = summarizeFields(input._mechanicsDroppedFields ?? [])
      const where = fields ? ` (rejected: ${fields})` : ''
      return (
        'The dice engine ran, but the move classification it returned failed validation' +
        where +
        ' and was rejected rather than guessed at' +
        tail
      )
    }

    case 'api-error':
      return 'The dice engine could not be reached this exchange' + tail

    default:
      // Unavailable with no reason recorded — older scenes resolved before
      // the cause was carried through. Say only what is known rather than
      // inventing a cause, which is the mistake being fixed here.
      return 'The dice engine did not run this exchange' + tail
  }
}
