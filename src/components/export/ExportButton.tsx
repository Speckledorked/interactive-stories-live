'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';

interface ExportButtonProps {
  campaignId: string;
  sessionId?: string;
  type?: 'campaign' | 'session';
  className?: string;
}

export function ExportButton({
  campaignId,
  sessionId,
  type = 'campaign',
  className,
}: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      let url = '';
      if (type === 'campaign') {
        url = `/api/campaigns/${campaignId}/export`;
      } else if (type === 'session' && sessionId) {
        url = `/api/campaigns/${campaignId}/export/session/${sessionId}`;
      }

      const response = await fetch(url);
      if (response.ok) {
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;

        // Get filename from Content-Disposition header if available
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `export_${Date.now()}.json`;
        if (contentDisposition) {
          const match = contentDisposition.match(/filename="(.+)"/);
          if (match) filename = match[1];
        }

        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
      } else {
        alert('Export failed. Please try again.');
      }
    } catch (error) {
      console.error('Error exporting:', error);
      alert('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      onClick={handleExport}
      disabled={isExporting}
      variant="outline"
      className={className}
    >
      {isExporting ? (
        <>
          <span className="animate-spin mr-2">⏳</span>
          Exporting...
        </>
      ) : (
        <>
          <span className="mr-2">📥</span>
          Export {type === 'campaign' ? 'Campaign' : 'Session'}
        </>
      )}
    </Button>
  );
}
