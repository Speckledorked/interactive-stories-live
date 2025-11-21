// src/components/notes/NotesPanel.tsx

'use client';

import { useState, useEffect } from 'react';
import { PlayerNote } from '@prisma/client';
import { getToken } from '@/lib/clientAuth';

interface NotesPanelProps {
  campaignId: string;
  currentUserId: string;
  characters: Array<{ id: string; name: string; }>;
  npcs: Array<{ id: string; name: string; }>;
  factions: Array<{ id: string; name: string; }>;
  scenes: Array<{ id: string; description: string; }>;
}

type NoteVisibility = 'PRIVATE' | 'SHARED';

interface ExtendedNote extends PlayerNote {
  author: { id: string; email: string; name?: string; };
  character?: { id: string; name: string; };
  npc?: { id: string; name: string; };
  faction?: { id: string; name: string; };
  scene?: { id: string; description: string; };
}

export default function NotesPanel({ 
  campaignId, 
  currentUserId,
  characters,
  npcs,
  factions,
  scenes
}: NotesPanelProps) {
  const [notes, setNotes] = useState<ExtendedNote[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingNote, setEditingNote] = useState<ExtendedNote | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<{ visibility?: string; entityType?: string; }>({});
  
  // Form state
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    visibility: 'PRIVATE' as NoteVisibility,
    entityType: '',
    entityId: '',
  });

  useEffect(() => {
    fetchNotes();
  }, [campaignId, filter]);

  const fetchNotes = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.visibility) params.append('visibility', filter.visibility);
      if (filter.entityType) params.append('entityType', filter.entityType);
      if (filter.entityType && formData.entityId) params.append('entityId', formData.entityId);

      const token = getToken();
      const response = await fetch(`/api/campaigns/${campaignId}/notes?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setNotes(data.notes);
      }
    } catch (error) {
      console.error('Error fetching notes:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      content: '',
      visibility: 'PRIVATE',
      entityType: '',
      entityId: '',
    });
    setShowForm(false);
    setEditingNote(null);
  };

  const startEdit = (note: ExtendedNote) => {
    if (note.authorId !== currentUserId) {
      alert('You can only edit your own notes');
      return;
    }

    setEditingNote(note);
    setFormData({
      title: note.title,
      content: note.content,
      visibility: note.visibility as NoteVisibility,
      entityType: note.characterId ? 'character' : 
                  note.npcId ? 'npc' : 
                  note.factionId ? 'faction' : 
                  note.sceneId ? 'scene' : '',
      entityId: note.characterId || note.npcId || note.factionId || note.sceneId || '',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.content.trim()) {
      alert('Title and content are required');
      return;
    }

    setLoading(true);
    
    try {
      const token = getToken();
      const payload = {
        title: formData.title.trim(),
        content: formData.content.trim(),
        visibility: formData.visibility,
        ...(formData.entityType && formData.entityId && {
          [`${formData.entityType}Id`]: formData.entityId
        })
      };

      const url = editingNote 
        ? `/api/campaigns/${campaignId}/notes/${editingNote.id}`
        : `/api/campaigns/${campaignId}/notes`;
      
      const method = editingNote ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        resetForm();
        fetchNotes();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error saving note:', error);
      alert('Failed to save note');
    } finally {
      setLoading(false);
    }
  };

  const deleteNote = async (noteId: string, authorId: string) => {
    if (authorId !== currentUserId) {
      alert('You can only delete your own notes');
      return;
    }

    if (!confirm('Are you sure you want to delete this note?')) {
      return;
    }

    try {
      const token = getToken();
      const response = await fetch(`/api/campaigns/${campaignId}/notes/${noteId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        fetchNotes();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error deleting note:', error);
      alert('Failed to delete note');
    }
  };

  const getEntityOptions = () => {
    switch (formData.entityType) {
      case 'character':
        return characters.map(c => ({ id: c.id, name: c.name }));
      case 'npc':
        return npcs.map(n => ({ id: n.id, name: n.name }));
      case 'faction':
        return factions.map(f => ({ id: f.id, name: f.name }));
      case 'scene':
        return scenes.map(s => ({ id: s.id, name: s.description.substring(0, 50) + '...' }));
      default:
        return [];
    }
  };

  const getEntityDisplay = (note: ExtendedNote) => {
    if (note.character) return `Character: ${note.character.name}`;
    if (note.npc) return `NPC: ${note.npc.name}`;
    if (note.faction) return `Faction: ${note.faction.name}`;
    if (note.scene) return `Scene: ${note.scene.description.substring(0, 30)}...`;
    return 'General Note';
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 flex justify-between items-center">
        <h3 className="font-semibold text-gray-100">Player Notes</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
        >
          {showForm ? 'Cancel' : 'New Note'}
        </button>
      </div>

      {/* Filters */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex flex-wrap gap-2">
          <select
            value={filter.visibility || ''}
            onChange={(e) => setFilter(prev => ({ ...prev, visibility: e.target.value || undefined }))}
            className="px-3 py-1 bg-gray-900 border border-gray-600 text-gray-200 rounded-md text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          >
            <option value="">All Visibility</option>
            <option value="PRIVATE">Private Only</option>
            <option value="SHARED">Shared Only</option>
          </select>

          <select
            value={filter.entityType || ''}
            onChange={(e) => setFilter(prev => ({ ...prev, entityType: e.target.value || undefined }))}
            className="px-3 py-1 bg-gray-900 border border-gray-600 text-gray-200 rounded-md text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          >
            <option value="">All Types</option>
            <option value="character">Characters</option>
            <option value="npc">NPCs</option>
            <option value="faction">Factions</option>
            <option value="scene">Scenes</option>
          </select>
        </div>
      </div>

      {/* Note Form */}
      {showForm && (
        <div className="p-4 border-b border-gray-700 bg-gray-900">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Note title..."
                className="w-full p-2 bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-400 rounded-md text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                required
              />
            </div>

            <div>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                placeholder="Note content..."
                rows={4}
                className="w-full p-2 bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-400 rounded-md text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                required
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              <select
                value={formData.visibility}
                onChange={(e) => setFormData(prev => ({ ...prev, visibility: e.target.value as NoteVisibility }))}
                className="p-2 bg-gray-800 border border-gray-600 text-gray-100 rounded-md text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              >
                <option value="PRIVATE">Private</option>
                <option value="SHARED">Shared with Campaign</option>
              </select>

              <select
                value={formData.entityType}
                onChange={(e) => setFormData(prev => ({ ...prev, entityType: e.target.value, entityId: '' }))}
                className="p-2 bg-gray-800 border border-gray-600 text-gray-100 rounded-md text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              >
                <option value="">General Note</option>
                <option value="character">About Character</option>
                <option value="npc">About NPC</option>
                <option value="faction">About Faction</option>
                <option value="scene">About Scene</option>
              </select>

              {formData.entityType && (
                <select
                  value={formData.entityId}
                  onChange={(e) => setFormData(prev => ({ ...prev, entityId: e.target.value }))}
                  className="p-2 bg-gray-800 border border-gray-600 text-gray-100 rounded-md text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">Select {formData.entityType}...</option>
                  {getEntityOptions().map(option => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-primary-600 text-white rounded-md text-sm hover:bg-primary-700 disabled:opacity-50"
              >
                {editingNote ? 'Update Note' : 'Save Note'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 bg-gray-700 text-gray-200 rounded-md text-sm hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Notes List */}
      <div className="max-h-96 overflow-y-auto">
        {notes.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            No notes found. Create your first note!
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {notes.map((note) => (
              <div key={note.id} className="p-4 hover:bg-gray-900">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-medium text-gray-100">{note.title}</h4>
                    <p className="text-xs text-gray-400">
                      {getEntityDisplay(note)} •
                      {note.visibility === 'PRIVATE' ? ' Private' : ' Shared'} •
                      by {note.author.name || note.author.email} •
                      {new Date(note.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  {note.authorId === currentUserId && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => startEdit(note)}
                        className="px-2 py-1 text-xs bg-blue-600 text-blue-100 rounded hover:bg-blue-700"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteNote(note.id, note.authorId)}
                        className="px-2 py-1 text-xs bg-red-600 text-red-100 rounded hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-sm text-gray-200 whitespace-pre-wrap">
                  {note.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
