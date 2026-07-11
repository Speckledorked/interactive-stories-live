import { describe, it, expect } from 'vitest'
import { classifySceneImportance } from '../contextManager'

describe('classifySceneImportance', () => {
  it('maps CRITICAL memory importance to critical regardless of text/timeline', () => {
    expect(classifySceneImportance('CRITICAL', false, 'a perfectly mundane scene')).toBe('critical')
  })

  it('maps MAJOR memory importance to important', () => {
    expect(classifySceneImportance('MAJOR', false, 'a perfectly mundane scene')).toBe('important')
  })

  it('maps NORMAL memory importance to normal', () => {
    expect(classifySceneImportance('NORMAL', true, 'death and destruction')).toBe('normal')
  })

  it('maps MINOR memory importance to normal', () => {
    expect(classifySceneImportance('MINOR', true, 'death and destruction')).toBe('normal')
  })

  it('trusts the stored memory importance over conflicting keyword signals', () => {
    // Text screams "critical" but the richer, structured signal available
    // at resolution time (character harm, clock/faction updates, scene
    // type) said otherwise — the stored value wins.
    expect(classifySceneImportance('NORMAL', false, 'a brutal death and betrayal')).toBe('normal')
  })

  describe('fallback when no memory row exists', () => {
    it('falls back to normal with no keyword or public timeline event', () => {
      expect(classifySceneImportance(undefined, false, 'a quiet chat over tea')).toBe('normal')
    })

    it('falls back to important when a public timeline event occurred', () => {
      expect(classifySceneImportance(undefined, true, 'a quiet chat over tea')).toBe('important')
    })

    it('falls back to critical on a critical keyword, overriding the timeline-event signal', () => {
      expect(classifySceneImportance(undefined, true, 'and then came the betrayal')).toBe('critical')
    })

    it('falls back to critical on a critical keyword even with no timeline event', () => {
      expect(classifySceneImportance(undefined, false, 'the hero was killed')).toBe('critical')
    })
  })
})
