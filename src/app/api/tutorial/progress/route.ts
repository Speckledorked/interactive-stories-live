import { NextRequest, NextResponse } from 'next/server';
import { TutorialService } from '@/lib/tutorial/tutorial-service';
import { verifyAuth } from '@/lib/auth';

/**
 * GET /api/tutorial/progress
 * Get user's tutorial progress
 */
export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const progress = await TutorialService.getUserProgress(user.userId);
    const nextStep = await TutorialService.getNextStep(user.userId);
    const completionPercentage = await TutorialService.getCompletionPercentage(user.userId);

    return NextResponse.json({
      progress,
      nextStep,
      completionPercentage,
    });
  } catch (error: any) {
    console.error('Error fetching tutorial progress:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
