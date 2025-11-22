// src/components/chat/ChatPanel.tsx

'use client';

import { useState, useEffect, useRef } from 'react';
import { Message } from '@prisma/client';
import { getPusherClient, subscribeToCampaignMessages, subscribeToUserWhispers, RealtimeMessage, isPusherConfigured } from '@/lib/realtime/pusher-client';
import { getToken } from '@/lib/clientAuth';

interface ChatPanelProps {
  campaignId: string;
  currentUserId: string;
  currentUserName: string;
  userCharacters: Array<{ id: string; name: string; }>;
  sceneId?: string;
  icOnly?: boolean; // If true, only show IC messages and force IC mode
}

type MessageType = 'OUT_OF_CHARACTER' | 'IN_CHARACTER' | 'WHISPER';

export default function ChatPanel({
  campaignId,
  currentUserId,
  currentUserName,
  userCharacters,
  sceneId,
  icOnly = false
}: ChatPanelProps) {
  const [messages, setMessages] = useState<RealtimeMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [messageType, setMessageType] = useState<MessageType>(icOnly ? 'IN_CHARACTER' : 'OUT_OF_CHARACTER');
  const [selectedCharacter, setSelectedCharacter] = useState<string>('');
  const [whisperTarget, setWhisperTarget] = useState<string>('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [campaignMembers, setCampaignMembers] = useState<Array<{ id: string; name: string; email: string; }>>([]);
  const [loading, setLoading] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load initial messages and campaign members
  useEffect(() => {
    fetchMessages();
    fetchCampaignMembers();
  }, [campaignId, sceneId]);

  // Set up real-time subscriptions
  useEffect(() => {
    // Check if Pusher is configured before attempting to use it
    if (!isPusherConfigured()) {
      console.warn('Pusher is not configured. Real-time chat features will be disabled. Configure NEXT_PUBLIC_PUSHER_KEY and NEXT_PUBLIC_PUSHER_CLUSTER to enable real-time updates.');
      return;
    }

    try {
      const campaignChannel = subscribeToCampaignMessages(campaignId);
      const whisperChannel = subscribeToUserWhispers(currentUserId);

      // Listen for new messages
      campaignChannel.bind('new-message', (message: RealtimeMessage) => {
        setMessages(prev => [...prev, message]);
      });

      // Listen for whispers
      whisperChannel.bind('new-whisper', (message: RealtimeMessage) => {
        setMessages(prev => [...prev, message]);
      });

      // Listen for typing indicators
      campaignChannel.bind('user-typing', ({ userId, userName, isTyping }: any) => {
        if (userId !== currentUserId) {
          setTypingUsers(prev => {
            if (isTyping) {
              return prev.includes(userName) ? prev : [...prev, userName];
            } else {
              return prev.filter(name => name !== userName);
            }
          });
        }
      });

      return () => {
        campaignChannel.unbind_all();
        whisperChannel.unbind_all();
        getPusherClient().unsubscribe(`campaign-${campaignId}`);
        getPusherClient().unsubscribe(`user-${currentUserId}`);
      };
    } catch (error) {
      console.error('Failed to initialize Pusher:', error);
      // Chat will still work, just without real-time updates
    }
  }, [campaignId, currentUserId]);

  const fetchMessages = async () => {
    try {
      const params = new URLSearchParams();
      if (sceneId) params.append('sceneId', sceneId);
      params.append('limit', '50');

      const token = getToken();
      const response = await fetch(`/api/campaigns/${campaignId}/messages?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages);
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const fetchCampaignMembers = async () => {
    try {
      const token = getToken();
      const response = await fetch(`/api/campaigns/${campaignId}/members`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setCampaignMembers(data.members.map((m: any) => ({
          id: m.user.id,
          name: m.user.name || m.user.email,
          email: m.user.email
        })));
      }
    } catch (error) {
      console.error('Error fetching campaign members:', error);
    }
  };

  const sendTypingIndicator = async (typing: boolean) => {
    try {
      const token = getToken();
      await fetch(`/api/campaigns/${campaignId}/typing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ isTyping: typing }),
      });
    } catch (error) {
      console.error('Error sending typing indicator:', error);
    }
  };

  const handleInputChange = (value: string) => {
    setNewMessage(value);

    // Handle typing indicators
    if (value.trim() && !isTyping) {
      setIsTyping(true);
      sendTypingIndicator(true);
    }

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new timeout to stop typing indicator
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      sendTypingIndicator(false);
    }, 1000);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newMessage.trim()) return;

    // Validation
    if (messageType === 'IN_CHARACTER' && !selectedCharacter) {
      alert('Please select a character for IC messages');
      return;
    }

    if (messageType === 'WHISPER' && !whisperTarget) {
      alert('Please select a recipient for whispers');
      return;
    }

    setLoading(true);

    try {
      const token = getToken();
      const response = await fetch(`/api/campaigns/${campaignId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          content: newMessage.trim(),
          type: messageType,
          sceneId: sceneId,
          characterId: messageType === 'IN_CHARACTER' ? selectedCharacter : null,
          targetUserId: messageType === 'WHISPER' ? whisperTarget : null,
        }),
      });

      if (response.ok) {
        setNewMessage('');
        // Stop typing indicator
        setIsTyping(false);
        sendTypingIndicator(false);
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  const formatMessage = (message: RealtimeMessage) => {
    const isWhisper = message.type === 'WHISPER';
    const isIC = message.type === 'IN_CHARACTER';
    const isOwnMessage = message.authorId === currentUserId;
    const isWhisperToMe = isWhisper && (message.targetUserId === currentUserId || message.authorId === currentUserId);

    // Don't show whispers that aren't for this user
    if (isWhisper && !isWhisperToMe) return null;

    let authorName = message.author.name || message.author.email;
    if (isIC && message.character) {
      authorName = message.character.name;
    }

    let prefix = '';
    if (isWhisper) {
      const targetName = message.targetUser?.name || message.targetUser?.email || 'Unknown';
      prefix = isOwnMessage ? `[Whisper to ${targetName}] ` : '[Whisper] ';
    } else if (isIC) {
      prefix = '[IC] ';
    } else {
      prefix = '[OOC] ';
    }

    return (
      <div key={message.id} className={`p-3 rounded-lg ${
        isOwnMessage ? 'bg-blue-900/30 ml-8' : 'bg-gray-800 mr-8'
      } ${isWhisper ? 'border-l-4 border-purple-500' : ''}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-sm font-semibold ${
            isIC ? 'text-green-400' : isWhisper ? 'text-purple-400' : 'text-blue-400'
          }`}>
            {prefix}{authorName}
          </span>
          <span className="text-xs text-gray-500">
            {new Date(message.createdAt).toLocaleTimeString()}
          </span>
        </div>
        <div className="text-gray-200 whitespace-pre-wrap">{message.content}</div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-96 bg-gray-900 border border-gray-700 rounded-lg">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <h3 className="font-semibold text-white">Campaign Chat</h3>
        {typingUsers.length > 0 && (
          <p className="text-sm text-gray-400 italic">
            {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
          </p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages
          .filter(msg => !icOnly || msg.type === 'IN_CHARACTER')
          .map(formatMessage)
          .filter(Boolean)}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-gray-700">
        {/* Message Type Controls - hide if IC only mode */}
        {!icOnly && (
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={() => setMessageType('OUT_OF_CHARACTER')}
              className={`px-3 py-1 text-sm rounded-md ${
                messageType === 'OUT_OF_CHARACTER'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              OOC
            </button>
            <button
              onClick={() => setMessageType('IN_CHARACTER')}
              className={`px-3 py-1 text-sm rounded-md ${
                messageType === 'IN_CHARACTER'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              IC
            </button>
            <button
              onClick={() => setMessageType('WHISPER')}
              className={`px-3 py-1 text-sm rounded-md ${
                messageType === 'WHISPER'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Whisper
            </button>
          </div>
        )}

        {/* Character Selection for IC */}
        {(messageType === 'IN_CHARACTER' || icOnly) && (
          <select
            value={selectedCharacter}
            onChange={(e) => setSelectedCharacter(e.target.value)}
            className="w-full p-2 mb-3 border border-gray-600 rounded-md text-sm bg-gray-800 text-gray-200"
            required
          >
            <option value="">Select Character...</option>
            {userCharacters.map(char => (
              <option key={char.id} value={char.id}>{char.name}</option>
            ))}
          </select>
        )}

        {/* Whisper Target Selection */}
        {messageType === 'WHISPER' && !icOnly && (
          <select
            value={whisperTarget}
            onChange={(e) => setWhisperTarget(e.target.value)}
            className="w-full p-2 mb-3 border border-gray-600 rounded-md text-sm bg-gray-800 text-gray-200"
            required
          >
            <option value="">Whisper to...</option>
            {campaignMembers.filter(m => m.id !== currentUserId).map(member => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
          </select>
        )}

        {/* Message Input */}
        <form onSubmit={sendMessage} className="flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder={
              messageType === 'WHISPER' ? 'Type your whisper...' :
              messageType === 'IN_CHARACTER' ? 'Say something in character...' :
              'Type your message...'
            }
            className="flex-1 p-2 border border-gray-600 rounded-md text-sm bg-gray-800 text-gray-200 placeholder-gray-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !newMessage.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
