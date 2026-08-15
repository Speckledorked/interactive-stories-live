// src/lib/ai/__tests__/imageGeneration.test.ts
// #96 — buildScenePrompt is pure and deterministic; generateSceneImage is
// the real API call + cost-tracking wrapper, mocked the same way
// embeddingService.test.ts mocks its OpenAI client.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockImagesGenerate = vi.fn()

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function MockOpenAI() {
    return { images: { generate: mockImagesGenerate } }
  }),
}))

vi.mock('../cost-tracker', () => ({
  recordAICost: vi.fn().mockResolvedValue(undefined),
}))

import { recordAICost } from '../cost-tracker'
import { buildScenePrompt, generateSceneImage, buildCampaignHeroPrompt, generateHeroImage } from '../imageGeneration'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildScenePrompt', () => {
  it('prefers the resolved narration over framing/intro text', () => {
    const prompt = buildScenePrompt({
      sceneIntroText: 'The party arrives at the gate.',
      sceneResolutionText: 'The gate splinters as the ram connects a third time.',
      framing: 'A tense standoff at the city gate.',
      location: 'Ashcrown Gate',
    })
    expect(prompt).toContain('The gate splinters as the ram connects a third time.')
    expect(prompt).not.toContain('The party arrives at the gate.')
  })

  it('falls back to framing when there is no resolution text yet', () => {
    const prompt = buildScenePrompt({
      sceneIntroText: 'The party arrives at the gate.',
      sceneResolutionText: null,
      framing: 'A tense standoff at the city gate.',
      location: null,
    })
    expect(prompt).toContain('A tense standoff at the city gate.')
  })

  it('falls back to the scene intro text when nothing else is set', () => {
    const prompt = buildScenePrompt({
      sceneIntroText: 'The party arrives at the gate.',
      sceneResolutionText: null,
      framing: null,
      location: null,
    })
    expect(prompt).toContain('The party arrives at the gate.')
  })

  it('includes the location as a setting note when present', () => {
    const prompt = buildScenePrompt({
      sceneIntroText: 'x',
      sceneResolutionText: 'Something happens.',
      framing: null,
      location: 'Ashcrown Gate',
    })
    expect(prompt).toMatch(/^Setting: Ashcrown Gate\./)
  })

  it('omits the setting note entirely when there is no location', () => {
    const prompt = buildScenePrompt({
      sceneIntroText: 'x',
      sceneResolutionText: 'Something happens.',
      framing: null,
      location: null,
    })
    expect(prompt).not.toMatch(/^Setting:/)
  })

  it('truncates an overlong narrative rather than sending an unbounded prompt', () => {
    const longNarrative = 'x'.repeat(2000)
    const prompt = buildScenePrompt({
      sceneIntroText: 'x',
      sceneResolutionText: longNarrative,
      framing: null,
      location: null,
    })
    expect(prompt.length).toBeLessThan(2000)
    expect(prompt).toContain('…')
  })

  it('always appends the style suffix', () => {
    const prompt = buildScenePrompt({
      sceneIntroText: 'x',
      sceneResolutionText: 'Something happens.',
      framing: null,
      location: null,
    })
    expect(prompt).toContain('Digital painting, atmospheric, cinematic lighting')
  })

  it('is deterministic for the same input', () => {
    const scene = { sceneIntroText: 'x', sceneResolutionText: 'Something happens.', framing: null, location: 'Ashcrown Gate' }
    expect(buildScenePrompt(scene)).toBe(buildScenePrompt(scene))
  })
})

describe('generateSceneImage', () => {
  it('returns the decoded image buffer on success', async () => {
    const fakeBase64 = Buffer.from('fake-png-bytes').toString('base64')
    mockImagesGenerate.mockResolvedValue({ data: [{ b64_json: fakeBase64 }] })

    const result = await generateSceneImage('camp1', 'scene1', 'a vivid illustration prompt')

    expect(result.contentType).toBe('image/png')
    expect(result.imageBuffer.toString()).toBe('fake-png-bytes')
    expect(mockImagesGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'a vivid illustration prompt', n: 1 })
    )
  })

  it('records a successful cost entry tagged with the scene', async () => {
    const fakeBase64 = Buffer.from('fake-png-bytes').toString('base64')
    mockImagesGenerate.mockResolvedValue({ data: [{ b64_json: fakeBase64 }] })

    await generateSceneImage('camp1', 'scene1', 'prompt')

    expect(recordAICost).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp1', sceneId: 'scene1', requestType: 'scene_image_generation', success: true })
    )
  })

  it('throws and still records a failed cost entry when the API returns no image data', async () => {
    mockImagesGenerate.mockResolvedValue({ data: [{}] })

    await expect(generateSceneImage('camp1', 'scene1', 'prompt')).rejects.toThrow('no image data')
    expect(recordAICost).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
  })

  it('propagates a thrown API error and still records a failed cost entry', async () => {
    mockImagesGenerate.mockRejectedValue(new Error('rate limited'))

    await expect(generateSceneImage('camp1', 'scene1', 'prompt')).rejects.toThrow('rate limited')
    expect(recordAICost).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
  })
})

describe('buildCampaignHeroPrompt', () => {
  it('includes universe, title, and description', () => {
    const prompt = buildCampaignHeroPrompt({ title: 'The Iron Vigil', description: 'A grim border war.', universe: 'Grimdark Fantasy' })
    expect(prompt).toContain('Grimdark Fantasy')
    expect(prompt).toContain('The Iron Vigil')
    expect(prompt).toContain('A grim border war.')
  })

  it('omits the description when null', () => {
    const prompt = buildCampaignHeroPrompt({ title: 'The Iron Vigil', description: null, universe: 'Grimdark Fantasy' })
    expect(prompt).not.toContain(': ')
  })

  it('omits the universe note when null', () => {
    const prompt = buildCampaignHeroPrompt({ title: 'The Iron Vigil', description: null, universe: null })
    expect(prompt).not.toContain('null')
  })

  it('is framed as a wide establishing shot, not an in-scene moment', () => {
    const prompt = buildCampaignHeroPrompt({ title: 'T', description: null, universe: null })
    expect(prompt).toMatch(/^Wide cinematic establishing shot\./)
  })

  it('always appends the style suffix', () => {
    const prompt = buildCampaignHeroPrompt({ title: 'T', description: null, universe: null })
    expect(prompt).toContain('Digital painting, atmospheric, cinematic lighting')
  })

  it('truncates an overlong description', () => {
    const prompt = buildCampaignHeroPrompt({ title: 'T', description: 'x'.repeat(2000), universe: null })
    expect(prompt.length).toBeLessThan(2000)
    expect(prompt).toContain('…')
  })
})

describe('generateHeroImage', () => {
  it('returns the decoded image buffer on success', async () => {
    const fakeBase64 = Buffer.from('fake-hero-bytes').toString('base64')
    mockImagesGenerate.mockResolvedValue({ data: [{ b64_json: fakeBase64 }] })

    const result = await generateHeroImage('camp1', 'a wide establishing shot prompt')

    expect(result.contentType).toBe('image/png')
    expect(result.imageBuffer.toString()).toBe('fake-hero-bytes')
  })

  it('records a successful cost entry with no sceneId', async () => {
    const fakeBase64 = Buffer.from('fake-hero-bytes').toString('base64')
    mockImagesGenerate.mockResolvedValue({ data: [{ b64_json: fakeBase64 }] })

    await generateHeroImage('camp1', 'prompt')

    expect(recordAICost).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp1', requestType: 'campaign_hero_image', success: true })
    )
    expect(recordAICost).toHaveBeenCalledWith(expect.not.objectContaining({ sceneId: expect.anything() }))
  })

  it('throws and still records a failed cost entry when the API returns no image data', async () => {
    mockImagesGenerate.mockResolvedValue({ data: [{}] })

    await expect(generateHeroImage('camp1', 'prompt')).rejects.toThrow('no image data')
    expect(recordAICost).toHaveBeenCalledWith(expect.objectContaining({ requestType: 'campaign_hero_image', success: false }))
  })
})
