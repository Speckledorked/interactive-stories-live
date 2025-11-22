'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';

interface TutorialStep {
  id: string;
  stepKey: string;
  title: string;
  description: string;
  category: string;
  orderIndex: number;
  isOptional: boolean;
  contentBlocks?: Array<{
    type: 'text' | 'image' | 'video' | 'code' | 'tip' | 'warning';
    content: string;
    imageUrl?: string;
  }>;
  targetElement?: string;
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
  userProgress: any;
}

interface TutorialOverlayProps {
  campaignId?: string;
  onComplete?: () => void;
}

export function TutorialOverlay({ campaignId, onComplete }: TutorialOverlayProps) {
  const [currentStep, setCurrentStep] = useState<TutorialStep | null>(null);
  const [progress, setProgress] = useState<TutorialStep[]>([]);
  const [completionPercentage, setCompletionPercentage] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [highlightedElement, setHighlightedElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    loadProgress();
  }, []);

  useEffect(() => {
    if (currentStep?.targetElement) {
      const element = document.querySelector(currentStep.targetElement) as HTMLElement;
      if (element) {
        setHighlightedElement(element);
        element.classList.add('tutorial-highlight');
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      if (highlightedElement) {
        highlightedElement.classList.remove('tutorial-highlight');
      }
      setHighlightedElement(null);
    }

    return () => {
      if (highlightedElement) {
        highlightedElement.classList.remove('tutorial-highlight');
      }
    };
  }, [currentStep]);

  const loadProgress = async () => {
    try {
      const response = await fetch('/api/tutorial/progress');
      if (response.ok) {
        const data = await response.json();
        setProgress(data.progress);
        setCurrentStep(data.nextStep);
        setCompletionPercentage(data.completionPercentage);
        setIsVisible(!!data.nextStep);
      }
    } catch (error) {
      console.error('Error loading tutorial progress:', error);
    }
  };

  const completeStep = async () => {
    if (!currentStep) return;

    try {
      const response = await fetch(`/api/tutorial/steps/${currentStep.id}/complete`, {
        method: 'POST',
      });

      if (response.ok) {
        await loadProgress();
        if (completionPercentage >= 100 && onComplete) {
          onComplete();
        }
      }
    } catch (error) {
      console.error('Error completing step:', error);
    }
  };

  const skipStep = async () => {
    if (!currentStep) return;

    try {
      const response = await fetch(`/api/tutorial/steps/${currentStep.id}/skip`, {
        method: 'POST',
      });

      if (response.ok) {
        await loadProgress();
      }
    } catch (error) {
      console.error('Error skipping step:', error);
    }
  };

  const dismissTutorial = () => {
    setIsVisible(false);
  };

  if (!isVisible || !currentStep) return null;

  const getTooltipPosition = () => {
    if (!currentStep.targetElement || !highlightedElement) {
      return 'tutorial-tooltip-center';
    }

    const position = currentStep.tooltipPosition || 'bottom';
    return `tutorial-tooltip-${position}`;
  };

  return (
    <>
      {/* Overlay backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={dismissTutorial} />

      {/* Tutorial tooltip */}
      <div className={`fixed z-50 ${getTooltipPosition()}`}>
        <Card className="p-6 max-w-md shadow-xl border-2 border-blue-500">
          {/* Progress indicator */}
          <div className="mb-4">
            <div className="flex justify-between text-sm text-gray-400 mb-2">
              <span>{currentStep.category.toUpperCase()}</span>
              <span>{completionPercentage}% Complete</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${completionPercentage}%` }}
              />
            </div>
          </div>

          {/* Step content */}
          <h3 className="text-xl font-bold mb-2 text-gray-100">{currentStep.title}</h3>
          <p className="text-gray-300 mb-4">{currentStep.description}</p>

          {/* Content blocks */}
          <div className="space-y-3 mb-4">
            {currentStep.contentBlocks?.map((block, index) => (
              <div key={index}>
                {block.type === 'text' && (
                  <p className="text-gray-200">{block.content}</p>
                )}
                {block.type === 'tip' && (
                  <Alert className="bg-blue-900/50 border-blue-500">
                    <div className="flex items-start">
                      <span className="text-blue-400 mr-2">💡</span>
                      <p className="text-blue-200">{block.content}</p>
                    </div>
                  </Alert>
                )}
                {block.type === 'warning' && (
                  <Alert className="bg-yellow-900/50 border-yellow-500">
                    <div className="flex items-start">
                      <span className="text-yellow-400 mr-2">⚠️</span>
                      <p className="text-yellow-200">{block.content}</p>
                    </div>
                  </Alert>
                )}
                {block.type === 'image' && block.imageUrl && (
                  <img
                    src={block.imageUrl}
                    alt={block.content}
                    className="rounded-lg max-w-full"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={skipStep} className="text-gray-400">
              Skip
            </Button>
            <Button variant="ghost" onClick={dismissTutorial} className="text-gray-400">
              Dismiss
            </Button>
            <Button onClick={completeStep} className="bg-blue-600 hover:bg-blue-700">
              Got it!
            </Button>
          </div>

          {currentStep.isOptional && (
            <p className="text-xs text-gray-500 mt-2 text-center">This step is optional</p>
          )}
        </Card>
      </div>

      {/* CSS for tutorial highlight */}
      <style jsx global>{`
        .tutorial-highlight {
          position: relative;
          z-index: 45;
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.5);
          border-radius: 4px;
          animation: pulse-highlight 2s ease-in-out infinite;
        }

        @keyframes pulse-highlight {
          0%, 100% {
            box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.5);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(59, 130, 246, 0.3);
          }
        }

        .tutorial-tooltip-center {
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        }

        .tutorial-tooltip-top {
          bottom: calc(100% + 20px);
        }

        .tutorial-tooltip-bottom {
          top: calc(100% + 20px);
        }

        .tutorial-tooltip-left {
          right: calc(100% + 20px);
          top: 50%;
          transform: translateY(-50%);
        }

        .tutorial-tooltip-right {
          left: calc(100% + 20px);
          top: 50%;
          transform: translateY(-50%);
        }
      `}</style>
    </>
  );
}
