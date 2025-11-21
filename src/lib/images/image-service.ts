// Stub service for AI-generated images

export interface AIImage {
  id: string
  prompt: string
  imageUrl: string
  thumbnailUrl?: string
  generatedAt: Date
  campaignId: string
  sessionId?: string
  tags: string[]
}

export interface SharedImageData {
  id: string
  originalName: string
  imageUrl: string
  thumbnailUrl?: string
  description?: string
  tags: string[]
  author: {
    id: string
    name: string
  }
  uploadedAt: Date
  fileSize: number
  isPublic: boolean
}

export async function getAIImages(campaignId: string): Promise<AIImage[]> {
  // Stub implementation - returns empty array
  return []
}

export async function getSharedImages(campaignId: string): Promise<SharedImageData[]> {
  // Stub implementation - returns empty array
  return []
}

export async function generateAIImage(prompt: string, campaignId: string): Promise<AIImage | null> {
  // Stub implementation
  return null
}
