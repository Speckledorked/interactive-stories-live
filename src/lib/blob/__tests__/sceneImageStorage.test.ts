// src/lib/blob/__tests__/sceneImageStorage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@vercel/blob', () => ({ put: vi.fn() }))

import { put } from '@vercel/blob'
import { uploadSceneImage } from '../sceneImageStorage'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('uploadSceneImage', () => {
  it('uploads to a scene-scoped pathname and returns the permanent Blob URL', async () => {
    ;(put as any).mockResolvedValue({ url: 'https://blob.vercel-storage.com/scene-images/scene1.png' })

    const url = await uploadSceneImage('scene1', Buffer.from('fake'), 'image/png')

    expect(url).toBe('https://blob.vercel-storage.com/scene-images/scene1.png')
    expect(put).toHaveBeenCalledWith(
      'scene-images/scene1.png',
      expect.any(Buffer),
      expect.objectContaining({ access: 'public', contentType: 'image/png', allowOverwrite: true })
    )
  })

  it('picks a jpg extension for a non-png content type', async () => {
    ;(put as any).mockResolvedValue({ url: 'https://blob.vercel-storage.com/scene-images/scene1.jpg' })

    await uploadSceneImage('scene1', Buffer.from('fake'), 'image/jpeg')

    expect(put).toHaveBeenCalledWith('scene-images/scene1.jpg', expect.any(Buffer), expect.anything())
  })

  it('propagates a thrown upload error', async () => {
    ;(put as any).mockRejectedValue(new Error('missing BLOB_READ_WRITE_TOKEN'))
    await expect(uploadSceneImage('scene1', Buffer.from('fake'), 'image/png')).rejects.toThrow('missing BLOB_READ_WRITE_TOKEN')
  })
})
