// PLACE IN: src/components/images/AIImageLibrary.tsx

'use client'

import React, { useState } from 'react'
import { SharedImageData } from '@/lib/images/image-service'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Search,
  Tag,
  Calendar,
  Eye,
  Sparkles,
  Download,
  Share,
  FileImage,
  Filter
} from 'lucide-react'

interface AIImageLibraryProps {
  images: SharedImageData[]
  onSearch?: (query: string, tags?: string[]) => void
  popularTags?: string[]
  className?: string
}

interface ViewModalState {
  isOpen: boolean
  image: SharedImageData | null
}

export function AIImageLibrary({
  images,
  onSearch,
  popularTags = [],
  className = ''
}: AIImageLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [viewModal, setViewModal] = useState<ViewModalState>({
    isOpen: false,
    image: null
  })
  const [filter, setFilter] = useState<'all' | 'ai-generated' | 'recent'>('all')

  // Handle search
  const handleSearch = () => {
    if (onSearch) {
      onSearch(searchQuery, selectedTags)
    }
  }

  // Toggle search tag
  const toggleSearchTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    )
  }

  // Filter images based on current filter
  const filteredImages = images.filter(image => {
    switch (filter) {
      case 'ai-generated':
        return image.description?.toLowerCase().includes('ai generated') ||
               image.tags.some(tag => tag.toLowerCase().includes('ai'))
      case 'recent':
        const oneWeekAgo = new Date()
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
        return new Date(image.uploadedAt) > oneWeekAgo
      default:
        return true
    }
  })

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // Detect if image is AI-generated
  const isAIGenerated = (image: SharedImageData) => {
    return image.author.name === 'AI GM' ||
           image.description?.toLowerCase().includes('ai generated') ||
           image.tags.some(tag => ['ai', 'generated', 'automatic'].includes(tag.toLowerCase()))
  }

  // Get category badge for image
  const getCategoryBadge = (image: SharedImageData) => {
    if (isAIGenerated(image)) {
      return (
        <Badge variant="secondary" className="bg-purple-100 text-purple-700">
          <Sparkles className="w-3 h-3 mr-1" />
          AI Generated
        </Badge>
      )
    }
    
    if (image.tags.includes('character')) {
      return <Badge variant="outline">Character</Badge>
    }
    
    if (image.tags.includes('map') || image.tags.includes('location')) {
      return <Badge variant="outline">Location</Badge>
    }
    
    if (image.tags.includes('item') || image.tags.includes('object')) {
      return <Badge variant="outline">Item</Badge>
    }
    
    return <Badge variant="secondary">Reference</Badge>
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <FileImage className="w-7 h-7" />
            Campaign Gallery
          </h2>
          <p className="text-gray-600">
            {filteredImages.length} images • {images.filter(isAIGenerated).length} AI generated
          </p>
        </div>
        
        <div className="flex space-x-2">
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('all')}
          >
            All
          </Button>
          <Button
            variant={filter === 'ai-generated' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('ai-generated')}
          >
            <Sparkles className="w-4 h-4 mr-1" />
            AI Generated
          </Button>
          <Button
            variant={filter === 'recent' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('recent')}
          >
            Recent
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <Card className="p-4">
        <div className="space-y-4">
          {/* Search Input */}
          <div className="flex space-x-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search images by name or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <Button onClick={handleSearch}>
              <Search className="w-4 h-4" />
            </Button>
          </div>

          {/* Popular Tags */}
          {popularTags.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2 flex items-center gap-2">
                <Tag className="w-4 h-4" />
                Popular Tags:
              </div>
              <div className="flex flex-wrap gap-2">
                {popularTags.map(tag => (
                  <Badge
                    key={tag}
                    variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                    className="cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleSearchTag(tag)}
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Active Filters */}
          {(selectedTags.length > 0 || filter !== 'all') && (
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-600">Active filters:</span>
              {filter !== 'all' && (
                <Badge variant="secondary">
                  {filter.replace('-', ' ')}
                </Badge>
              )}
              {selectedTags.map(tag => (
                <Badge key={tag} variant="default">
                  {tag}
                </Badge>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedTags([])
                  setFilter('all')
                }}
              >
                Clear all
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Image Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredImages.map(image => (
          <Card 
            key={image.id} 
            className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
            onClick={() => setViewModal({ isOpen: true, image })}
          >
            {/* Image Preview */}
            <div className="relative aspect-square bg-gray-200">
              <img
                src={image.thumbnailUrl || image.imageUrl}
                alt={image.originalName}
                className="w-full h-full object-cover"
              />
              <div className="absolute top-2 left-2">
                {getCategoryBadge(image)}
              </div>
              <div className="absolute top-2 right-2">
                <Badge variant="outline" className="bg-black/50 text-white">
                  {formatFileSize(image.fileSize)}
                </Badge>
              </div>
              {!image.isPublic && (
                <div className="absolute bottom-2 left-2">
                  <Badge variant="secondary" className="bg-gray-900/70 text-white">
                    Private
                  </Badge>
                </div>
              )}
            </div>

            {/* Image Info */}
            <div className="p-3">
              <h4 className="font-medium truncate mb-1">{image.originalName}</h4>
              
              {image.description && (
                <p className="text-sm text-gray-600 line-clamp-2 mb-2">
                  {image.description}
                </p>
              )}
              
              {/* Tags */}
              {image.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {image.tags.slice(0, 3).map(tag => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                  {image.tags.length > 3 && (
                    <Badge variant="outline" className="text-xs">
                      +{image.tags.length - 3} more
                    </Badge>
                  )}
                </div>
              )}

              {/* Author and Date */}
              <div className="flex items-center justify-between text-xs text-gray-500">
                <div className="flex items-center gap-1">
                  {isAIGenerated(image) ? (
                    <Sparkles className="w-3 h-3" />
                  ) : (
                    <Calendar className="w-3 h-3" />
                  )}
                  {image.author.name}
                </div>
                <div>
                  {new Date(image.uploadedAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Empty State */}
      {filteredImages.length === 0 && (
        <Card className="p-8 text-center">
          <FileImage className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-semibold mb-2">No images found</h3>
          <p className="text-gray-600 mb-4">
            {filter === 'ai-generated' 
              ? 'The AI GM hasn\'t generated any images yet. They\'ll appear as scenes unfold!'
              : 'No images match your current search and filters.'
            }
          </p>
          {selectedTags.length > 0 || filter !== 'all' ? (
            <Button 
              variant="outline"
              onClick={() => {
                setSelectedTags([])
                setFilter('all')
                setSearchQuery('')
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </Card>
      )}

      {/* View Modal */}
      <Dialog open={viewModal.isOpen} onOpenChange={(open) => 
        setViewModal(prev => ({ ...prev, isOpen: open }))
      }>
        <DialogContent className="sm:max-w-4xl">
          {viewModal.image && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {getCategoryBadge(viewModal.image)}
                  {viewModal.image.originalName}
                </DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4">
                <img
                  src={viewModal.image.imageUrl}
                  alt={viewModal.image.originalName}
                  className="w-full max-h-96 object-contain bg-gray-100 rounded"
                />
                
                {viewModal.image.description && (
                  <div>
                    <h4 className="font-semibold mb-2">Description</h4>
                    <p className="text-gray-700">{viewModal.image.description}</p>
                  </div>
                )}
                
                {viewModal.image.tags.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">Tags</h4>
                    <div className="flex flex-wrap gap-2">
                      {viewModal.image.tags.map(tag => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="flex justify-between text-sm text-gray-500 pt-4 border-t">
                  <div className="flex items-center gap-4">
                    <span>By {viewModal.image.author.name}</span>
                    <span>{new Date(viewModal.image.uploadedAt).toLocaleString()}</span>
                    <span>{formatFileSize(viewModal.image.fileSize)}</span>
                  </div>
                  
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(viewModal.image!.imageUrl, '_blank')}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
