// src/components/settings/NotificationSettings.tsx

'use client';

import { useState, useEffect } from 'react';
import { isPushSupported, enablePush, disablePush } from '@/lib/notifications/push-client';
import { getToken } from '@/lib/clientAuth';
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { BarChart3, Bell, Mail, Moon, Volume2 } from 'lucide-react'

interface NotificationSettings {
  // Email notifications
  emailEnabled: boolean;
  emailTurnReminders: boolean;
  emailSceneChanges: boolean;
  emailMentions: boolean;
  emailWhispers: boolean;
  emailCampaignInvites: boolean;
  emailWorldEvents: boolean;

  // Push notifications
  pushEnabled: boolean;
  pushTurnReminders: boolean;
  pushSceneChanges: boolean;
  pushMentions: boolean;
  pushWhispers: boolean;
  pushCampaignInvites: boolean;

  // Sound notifications
  soundEnabled: boolean;
  soundTurnReminders: boolean;
  soundSceneChanges: boolean;
  soundMentions: boolean;
  soundWhispers: boolean;
  soundCriticalMoments: boolean;
  soundWorldEvents: boolean;

  // Timing preferences
  quietHoursEnabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;

  // Digest preferences
  dailyDigestEnabled: boolean;
  weeklyDigestEnabled: boolean;
}

export default function NotificationSettings() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  // Push availability is a property of the deployment (VAPID keys) and the
  // browser, not a user preference — the toggle is hidden rather than
  // shown-but-broken when either says no.
  const [pushSupported, setPushSupported] = useState(false);
  const [pushConfigured, setPushConfigured] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [testingSound, setTestingSound] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
    void detectPushAvailability();
  }, []);

  /**
   * Push needs both a browser that supports it and a deployment with VAPID
   * keys. Either missing means the toggle is hidden — a control that can't
   * work is worse than no control.
   */
  const detectPushAvailability = async () => {
    const supported = isPushSupported();
    setPushSupported(supported);
    if (!supported) return;

    try {
      const token = getToken();
      const res = await fetch('/api/notifications/push', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const { configured } = await res.json();
        setPushConfigured(Boolean(configured));
      }
    } catch {
      setPushConfigured(false);
    }
  };

  /**
   * Turning push on is more than a preference flip — it needs browser
   * permission and a real subscription registered with the server, so the
   * stored preference only changes once that actually succeeded.
   */
  const handlePushToggle = async () => {
    if (!settings) return;
    setPushBusy(true);
    setPushError(null);

    try {
      if (settings.pushEnabled) {
        await disablePush();
        await updateSettings({ pushEnabled: false });
        setSettings(prev => (prev ? { ...prev, pushEnabled: false } : null));
        return;
      }

      const result = await enablePush();
      if (result.ok) {
        await updateSettings({ pushEnabled: true });
        setSettings(prev => (prev ? { ...prev, pushEnabled: true } : null));
        return;
      }

      setPushError(
        result.reason === 'denied'
          ? 'Your browser blocked notifications. Allow them for this site in your browser settings, then try again.'
          : result.reason === 'unsupported'
            ? 'This browser does not support push notifications.'
            : result.reason === 'unconfigured'
              ? 'Push notifications are not configured on this server yet.'
              : `Could not enable push notifications${result.detail ? `: ${result.detail}` : ''}.`
      );
    } finally {
      setPushBusy(false);
    }
  };

  /** Preview a cue so the labels mean something before you pick. */
  const testSound = async (soundId: string) => {
    setTestingSound(soundId);
    try {
      const { SoundService } = await import('@/lib/notifications/sound-service');
      await SoundService.playSound({ soundId, volume: 0.5 });
    } finally {
      setTimeout(() => setTestingSound(null), 600);
    }
  };

  const fetchSettings = async () => {
    try {
      const token = getToken();
      const response = await fetch('/api/notifications/settings', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      }
    } catch (error) {
      console.error('Error fetching notification settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateSettings = async (newSettings: Partial<NotificationSettings>) => {
    setSaving(true);
    try {
      const token = getToken();
      const response = await fetch('/api/notifications/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(newSettings),
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        setSettings(updatedSettings);
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error updating settings:', error);
      alert('Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (field: keyof NotificationSettings) => {
    if (!settings) return;

    const newValue = !settings[field];
    setSettings(prev => prev ? { ...prev, [field]: newValue } : null);
    updateSettings({ [field]: newValue });
  };

  const handleTimeChange = (field: 'quietHoursStart' | 'quietHoursEnd', value: string) => {
    setSettings(prev => prev ? { ...prev, [field]: value } : null);
    updateSettings({ [field]: value });
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-myth-accent mx-auto"></div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-myth-danger">Failed to load notification settings</p>
      </div>
    );
  }

  const ToggleSwitch = ({
    enabled,
    onChange,
    label,
    description
  }: {
    enabled: boolean;
    onChange: () => void;
    label: string;
    description?: string;
  }) => (
    <div className="flex items-center justify-between py-2">
      <div className="flex-1">
        <div className="font-medium text-myth-ink">{label}</div>
        {description && (
          <div className="text-sm text-myth-ink-muted">{description}</div>
        )}
      </div>
      <Switch checked={enabled} onCheckedChange={onChange} label={label} />
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-myth-ink mb-2">Notification Settings</h1>
        <p className="text-myth-ink-muted">Customize how you receive notifications from MythOS.</p>
      </div>

      {/* Email Notifications */}
      <div className="rounded-lg border border-myth-border bg-myth-surface p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-myth-ink"><Mail className="h-5 w-5" />Email Notifications</h2>

        <ToggleSwitch
          enabled={settings.emailEnabled}
          onChange={() => handleToggle('emailEnabled')}
          label="Enable Email Notifications"
          description="Receive notifications via email"
        />

        {settings.emailEnabled && (
          <div className="ml-4 border-l-2 border-myth-border pl-4 space-y-2">
            <ToggleSwitch
              enabled={settings.emailTurnReminders}
              onChange={() => handleToggle('emailTurnReminders')}
              label="Turn Reminders"
              description="When it's your turn to act"
            />
            <ToggleSwitch
              enabled={settings.emailSceneChanges}
              onChange={() => handleToggle('emailSceneChanges')}
              label="Scene Changes"
              description="When new scenes start"
            />
            <ToggleSwitch
              enabled={settings.emailMentions}
              onChange={() => handleToggle('emailMentions')}
              label="Mentions"
              description="When someone @mentions you"
            />
            <ToggleSwitch
              enabled={settings.emailWhispers}
              onChange={() => handleToggle('emailWhispers')}
              label="Private Messages"
              description="When you receive whispers"
            />
            <ToggleSwitch
              enabled={settings.emailCampaignInvites}
              onChange={() => handleToggle('emailCampaignInvites')}
              label="Campaign Invites"
              description="When invited to join campaigns"
            />
            <ToggleSwitch
              enabled={settings.emailWorldEvents}
              onChange={() => handleToggle('emailWorldEvents')}
              label="World Events"
              description="Major story developments"
            />
          </div>
        )}
      </div>

      {/* Push Notifications */}
      {pushSupported && pushConfigured && (
        <div className="rounded-lg border border-myth-border bg-myth-surface p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-myth-ink"><Bell className="h-5 w-5" />Browser Notifications</h2>

          <ToggleSwitch
            enabled={settings.pushEnabled}
            onChange={handlePushToggle}
            label={pushBusy ? 'Working…' : 'Enable Browser Notifications'}
            description="Get notified even when MythOS isn't the active tab"
          />

          {pushError && (
            <p className="mt-2 text-sm text-myth-danger">{pushError}</p>
          )}

          {settings.pushEnabled && (
            <div className="ml-4 border-l-2 border-myth-border pl-4 space-y-2 mt-2">
              <ToggleSwitch
                enabled={settings.pushTurnReminders}
                onChange={() => handleToggle('pushTurnReminders')}
                label="Turn Reminders"
              />
              <ToggleSwitch
                enabled={settings.pushSceneChanges}
                onChange={() => handleToggle('pushSceneChanges')}
                label="Scene Changes"
              />
              <ToggleSwitch
                enabled={settings.pushMentions}
                onChange={() => handleToggle('pushMentions')}
                label="Mentions"
              />
              <ToggleSwitch
                enabled={settings.pushWhispers}
                onChange={() => handleToggle('pushWhispers')}
                label="Private Messages"
              />
              <ToggleSwitch
                enabled={settings.pushCampaignInvites}
                onChange={() => handleToggle('pushCampaignInvites')}
                label="Campaign Invites"
              />
            </div>
          )}
        </div>
      )}

      {/* Sound Notifications */}
      <div className="rounded-lg border border-myth-border bg-myth-surface p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-myth-ink"><Volume2 className="h-5 w-5" />Sound Effects</h2>

        <ToggleSwitch
          enabled={settings.soundEnabled}
          onChange={() => handleToggle('soundEnabled')}
          label="Enable Sound Effects"
          description="A short chime when something needs your attention"
        />

        {settings.soundEnabled && (
          <div className="ml-4 border-l-2 border-myth-border pl-4 space-y-1 mt-2">
            {([
              ['soundTurnReminders', 'Turn Reminders', 'turn-reminder'],
              ['soundSceneChanges', 'Scene Changes', 'scene-change'],
              ['soundMentions', 'Mentions', 'mention'],
              ['soundWhispers', 'Private Messages', 'whisper'],
              ['soundCriticalMoments', 'Critical Moments', 'critical-moment'],
              ['soundWorldEvents', 'World Events', 'world-event'],
            ] as const).map(([key, label, cueId]) => (
              <div key={key} className="flex items-center justify-between py-1.5">
                <div className="font-medium text-myth-ink text-sm">{label}</div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => testSound(cueId)}
                    disabled={testingSound === cueId}
                    className="text-myth-accent hover:text-myth-accent-hover"
                  >
                    {testingSound === cueId ? 'Playing…' : 'Preview'}
                  </Button>
                  <Switch
                    checked={settings[key]}
                    onCheckedChange={() => handleToggle(key)}
                    label={label}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quiet Hours */}
      <div className="rounded-lg border border-myth-border bg-myth-surface p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-myth-ink"><Moon className="h-5 w-5" />Quiet Hours</h2>

        <ToggleSwitch
          enabled={settings.quietHoursEnabled}
          onChange={() => handleToggle('quietHoursEnabled')}
          label="Enable Quiet Hours"
          description="Reduce notifications during specified hours"
        />

        {settings.quietHoursEnabled && (
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-myth-ink-muted mb-1">
                Start Time
              </label>
              <Input
                wrapperClassName="w-full"
                type="time"
                value={settings.quietHoursStart || '22:00'}
                onChange={(e) => handleTimeChange('quietHoursStart', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-myth-ink-muted mb-1">
                End Time
              </label>
              <Input
                wrapperClassName="w-full"
                type="time"
                value={settings.quietHoursEnd || '08:00'}
                onChange={(e) => handleTimeChange('quietHoursEnd', e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Digest Preferences */}
      <div className="rounded-lg border border-myth-border bg-myth-surface p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-myth-ink"><BarChart3 className="h-5 w-5" />Digest Emails</h2>

        <ToggleSwitch
          enabled={settings.dailyDigestEnabled}
          onChange={() => handleToggle('dailyDigestEnabled')}
          label="Daily Digest"
          description="Summary of activity sent daily"
        />

        <ToggleSwitch
          enabled={settings.weeklyDigestEnabled}
          onChange={() => handleToggle('weeklyDigestEnabled')}
          label="Weekly Digest"
          description="Summary of activity sent weekly"
        />
      </div>

      {/* Status */}
      {saving && (
        <div className="fixed bottom-4 right-4 bg-myth-accent text-myth-accent-ink px-4 py-2 rounded-lg shadow-lg">
          Saving settings...
        </div>
      )}
    </div>
  );
}
