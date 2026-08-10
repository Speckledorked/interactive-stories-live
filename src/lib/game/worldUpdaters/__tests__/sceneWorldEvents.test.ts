// src/lib/game/worldUpdaters/__tests__/sceneWorldEvents.test.ts
import { describe, it, expect } from 'vitest'
import { sceneWorldChange } from '../sceneWorldEvents'

describe('sceneWorldChange (#175)', () => {
  it('builds a WorldChange tagged origin sceneResolution, significant by default', () => {
    const change = sceneWorldChange('camp1', 'CHARACTER', 'char1', 'Kess', 'harm', 0, 3, 'Wounded in the ambush')
    expect(change).toEqual({
      campaignId: 'camp1',
      entityType: 'CHARACTER',
      entityId: 'char1',
      entityName: 'Kess',
      field: 'harm',
      previousValue: 0,
      newValue: 3,
      reason: 'Wounded in the ambush',
      significant: true,
      importance: 'NORMAL',
      origin: 'sceneResolution'
    })
  })

  it('accepts an explicit MAJOR importance', () => {
    const change = sceneWorldChange('camp1', 'CHARACTER', 'char1', 'Kess', 'isAlive', 'true', 'false', 'Died from their wounds', 'MAJOR')
    expect(change.importance).toBe('MAJOR')
  })
})
