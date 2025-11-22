'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';

interface SafetySettingsPanelProps {
  campaignId: string;
  isGM: boolean;
}

const CONTENT_WARNING_TYPES = [
  { value: 'VIOLENCE', label: 'Violence' },
  { value: 'SEXUAL_CONTENT', label: 'Sexual Content' },
  { value: 'GORE', label: 'Gore/Body Horror' },
  { value: 'HORROR', label: 'Horror/Fear' },
  { value: 'SUBSTANCE_ABUSE', label: 'Substance Abuse' },
  { value: 'MENTAL_HEALTH', label: 'Mental Health Issues' },
  { value: 'DISCRIMINATION', label: 'Discrimination' },
  { value: 'DEATH', label: 'Death/Dying' },
  { value: 'TRAUMA', label: 'Trauma' },
];

export function SafetySettingsPanel({ campaignId, isGM }: SafetySettingsPanelProps) {
  const [settings, setSettings] = useState<any>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [veils, setVeils] = useState<string[]>([]);
  const [newLine, setNewLine] = useState('');
  const [newVeil, setNewVeil] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, [campaignId]);

  const loadSettings = async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/safety`);
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setLines(data.lines || []);
        setVeils(data.veils || []);
      }
    } catch (error) {
      console.error('Error loading safety settings:', error);
    }
  };

  const saveSettings = async () => {
    if (!isGM) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/safety`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          lines,
          veils,
        }),
      });

      if (response.ok) {
        const updated = await response.json();
        setSettings(updated);
        alert('Safety settings saved!');
      }
    } catch (error) {
      console.error('Error saving safety settings:', error);
      alert('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const addLine = () => {
    if (newLine.trim()) {
      setLines([...lines, newLine.trim()]);
      setNewLine('');
    }
  };

  const removeLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index));
  };

  const addVeil = () => {
    if (newVeil.trim()) {
      setVeils([...veils, newVeil.trim()]);
      setNewVeil('');
    }
  };

  const removeVeil = (index: number) => {
    setVeils(veils.filter((_, i) => i !== index));
  };

  const toggleWarning = (warning: string) => {
    if (!isGM) return;

    const activeWarnings = settings.activeWarnings || [];
    const newWarnings = activeWarnings.includes(warning)
      ? activeWarnings.filter((w: string) => w !== warning)
      : [...activeWarnings, warning];

    setSettings({ ...settings, activeWarnings: newWarnings });
  };

  if (!settings) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-2xl font-bold mb-4">Safety Tools</h2>

        <Alert className="mb-6 bg-blue-900/30 border-blue-500">
          <p className="text-blue-200">
            These tools help ensure everyone at the table feels safe and comfortable.
            They should be discussed in Session Zero before play begins.
          </p>
        </Alert>

        {/* X-Card Settings */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3">X-Card</h3>
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={settings.xCardEnabled}
                onChange={(e) => setSettings({ ...settings, xCardEnabled: e.target.checked })}
                disabled={!isGM}
                className="mr-2"
              />
              <span>Enable X-Card</span>
            </label>
            {settings.xCardEnabled && (
              <>
                <label className="flex items-center ml-6">
                  <input
                    type="checkbox"
                    checked={settings.anonymousXCard}
                    onChange={(e) => setSettings({ ...settings, anonymousXCard: e.target.checked })}
                    disabled={!isGM}
                    className="mr-2"
                  />
                  <span>Anonymous X-Card usage</span>
                </label>
                <label className="flex items-center ml-6">
                  <input
                    type="checkbox"
                    checked={settings.pauseOnXCard}
                    onChange={(e) => setSettings({ ...settings, pauseOnXCard: e.target.checked })}
                    disabled={!isGM}
                    className="mr-2"
                  />
                  <span>Automatically pause scene when X-Card is used</span>
                </label>
              </>
            )}
          </div>
        </div>

        {/* Content Warnings */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3">Active Content Warnings</h3>
          <div className="grid grid-cols-2 gap-2">
            {CONTENT_WARNING_TYPES.map((warning) => (
              <label key={warning.value} className="flex items-center">
                <input
                  type="checkbox"
                  checked={(settings.activeWarnings || []).includes(warning.value)}
                  onChange={() => toggleWarning(warning.value)}
                  disabled={!isGM}
                  className="mr-2"
                />
                <span>{warning.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Lines (Hard Boundaries) */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Lines (Hard Boundaries)</h3>
          <p className="text-sm text-gray-400 mb-3">
            Content that will NOT be included in the game. These are hard boundaries.
          </p>
          <div className="space-y-2 mb-3">
            {lines.map((line, index) => (
              <div key={index} className="flex items-center justify-between bg-gray-800 p-2 rounded">
                <span>{line}</span>
                {isGM && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLine(index)}
                    className="text-red-500 hover:text-red-400"
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
          {isGM && (
            <div className="flex gap-2">
              <Input
                value={newLine}
                onChange={(e) => setNewLine(e.target.value)}
                placeholder="Add a hard boundary..."
                onKeyPress={(e) => e.key === 'Enter' && addLine()}
              />
              <Button onClick={addLine}>Add</Button>
            </div>
          )}
        </div>

        {/* Veils (Soft Boundaries) */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Veils (Soft Boundaries)</h3>
          <p className="text-sm text-gray-400 mb-3">
            Content that can happen "off-screen" but won't be described in detail.
          </p>
          <div className="space-y-2 mb-3">
            {veils.map((veil, index) => (
              <div key={index} className="flex items-center justify-between bg-gray-800 p-2 rounded">
                <span>{veil}</span>
                {isGM && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeVeil(index)}
                    className="text-red-500 hover:text-red-400"
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
          {isGM && (
            <div className="flex gap-2">
              <Input
                value={newVeil}
                onChange={(e) => setNewVeil(e.target.value)}
                placeholder="Add a soft boundary..."
                onKeyPress={(e) => e.key === 'Enter' && addVeil()}
              />
              <Button onClick={addVeil}>Add</Button>
            </div>
          )}
        </div>

        {/* Session Zero Status */}
        <div className="mb-6">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={settings.sessionZeroCompleted}
              disabled
              className="mr-2"
            />
            <span>Session Zero Completed</span>
          </label>
          {settings.sessionZeroDate && (
            <p className="text-sm text-gray-500 ml-6">
              Completed on {new Date(settings.sessionZeroDate).toLocaleDateString()}
            </p>
          )}
        </div>

        {isGM && (
          <Button
            onClick={saveSettings}
            disabled={isSaving}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {isSaving ? 'Saving...' : 'Save Safety Settings'}
          </Button>
        )}
      </Card>
    </div>
  );
}
