// src/components/notes/NotesPanel.tsx

'use client';

import { useState, useEffect } from 'react';
import { PlayerNote } from '@prisma/client';
import { getToken } from '@/lib/clientAuth';
import { subscribeToCampaignMessages, RealtimeNoteUpdate } from '@/lib/realtime/pusher-client';
import { truncateWithEllipsis } from '@/lib/format';
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'

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

  // Bumped by realtime note events. Kept as state in the fetch dependency
  // list rather than calling fetchNotes from the socket handler, so the
  // handler never closes over a stale filter.
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchNotes();
  }, [campaignId, filter, refreshKey]);

  // Shared notes are a multiplayer surface, so another player sharing one
  // should appear without a reload. The server publishes on note writes;
  // triggerNoteUpdate drops anything PRIVATE before it reaches the channel.
  //
  // Deliberately a REFETCH rather than splicing the pushed payload into
  // state: the GET route is what applies visibility rules, and trusting a
  // broadcast body would put a second, weaker copy of those rules in the
  // client. The event is only ever a signal that something changed.
  useEffect(() => {
    const channel = subscribeToCampaignMessages(campaignId);
    if (!channel) return; // Pusher not configured — the panel still works, just not live.

    const onNoteUpdate = (update: RealtimeNoteUpdate) => {
      // Our own writes already refetched in handleSubmit/deleteNote.
      if (update.authorId === currentUserId) return;
      setRefreshKey(k => k + 1);
    };

    channel.bind('note-update', onNoteUpdate);
    return () => {
      // Unbind only. The channel itself is left subscribed because
      // ChatPanel shares `campaign-${id}` — unsubscribing here would
      // silently kill live chat for the whole campaign.
      channel.unbind('note-update', onNoteUpdate);
    };
  }, [campaignId, currentUserId]);

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
        return scenes.map(s => ({ id: s.id, name: truncateWithEllipsis(s.description, 50) }));
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
    <div className="bg-myth-surface-sunken border border-myth-border rounded-lg">
      {/* Header */}
      <div className="p-4 border-b border-myth-border flex justify-between items-center">
        <h3 className="font-semibold text-myth-ink">Player Notes</h3>
        <Button
          size="sm"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : 'New Note'}
        </Button>
      </div>

      {/* Filters */}
      <div className="p-4 border-b border-myth-border">
        <div className="flex flex-wrap gap-2">
          <Select
            className="focus:ring-1"
            value={filter.visibility || ''}
            onChange={(e) => setFilter(prev => ({ ...prev, visibility: e.target.value || undefined }))}
          >
            <option value="">All Visibility</option>
            <option value="PRIVATE">Private Only</option>
            <option value="SHARED">Shared Only</option>
          </Select>

          <Select
            className="focus:ring-1"
            value={filter.entityType || ''}
            onChange={(e) => setFilter(prev => ({ ...prev, entityType: e.target.value || undefined }))}
          >
            <option value="">All Types</option>
            <option value="character">Characters</option>
            <option value="npc">NPCs</option>
            <option value="faction">Factions</option>
            <option value="scene">Scenes</option>
          </Select>
        </div>
      </div>

      {/* Note Form */}
      {showForm && (
        <div className="p-4 border-b border-myth-border bg-myth-surface-sunken">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Input
                wrapperClassName="w-full" className="focus:ring-1"
                type="text"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Note title..."
                required
              />
            </div>

            <div>
              <Textarea
                wrapperClassName="w-full" className="focus:ring-1"
                value={formData.content}
                onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                placeholder="Note content..."
                rows={4}
                required
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              <Select
                className="focus:ring-1"
                value={formData.visibility}
                onChange={(e) => setFormData(prev => ({ ...prev, visibility: e.target.value as NoteVisibility }))}
              >
                <option value="PRIVATE">Private</option>
                <option value="SHARED">Shared with Campaign</option>
              </Select>

              <Select
                className="focus:ring-1"
                value={formData.entityType}
                onChange={(e) => setFormData(prev => ({ ...prev, entityType: e.target.value, entityId: '' }))}
              >
                <option value="">General Note</option>
                <option value="character">About Character</option>
                <option value="npc">About NPC</option>
                <option value="faction">About Faction</option>
                <option value="scene">About Scene</option>
              </Select>

              {formData.entityType && (
                <Select
                  className="focus:ring-1"
                  value={formData.entityId}
                  onChange={(e) => setFormData(prev => ({ ...prev, entityId: e.target.value }))}
                >
                  <option value="">Select {formData.entityType}...</option>
                  {getEntityOptions().map(option => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </Select>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="danger"
                type="submit"
                disabled={loading}
              >
                {editingNote ? 'Update Note' : 'Save Note'}
              </Button>
              <Button
                variant="secondary"
                type="button"
                onClick={resetForm}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Notes List */}
      <div className="max-h-96 overflow-y-auto">
        {notes.length === 0 ? (
          <div className="p-8 text-center text-myth-ink-faint">
            No notes found. Create your first note!
          </div>
        ) : (
          <div className="divide-y divide-myth-border">
            {notes.map((note) => (
              <div key={note.id} className="p-4 hover:bg-myth-surface-sunken">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-medium text-myth-ink">{note.title}</h4>
                    <p className="text-xs text-myth-gold">
                      {getEntityDisplay(note)} •
                      {note.visibility === 'PRIVATE' ? ' Private' : ' Shared'} •
                      by {note.author.name || note.author.email} •
                      {new Date(note.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  {note.authorId === currentUserId && (
                    <div className="flex gap-1">
                      <Button
                        variant="primary" size="sm"
                        onClick={() => startEdit(note)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger" size="sm"
                        onClick={() => deleteNote(note.id, note.authorId)}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
                <div className="text-sm text-myth-ink whitespace-pre-wrap">
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
