import { NextRequest, NextResponse } from 'next/server';
import { TutorialService } from '@/lib/tutorial/tutorial-service';
import { verifyAuth } from '@/lib/auth';

/**
 * POST /api/tutorial/steps/[stepId]/complete
 * Complete a tutorial step
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { stepId: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { stepId } = params;
    const progress = await TutorialService.completeStep(user.userId, stepId);

    return NextResponse.json(progress);
  } catch (error: any) {
    console.error('Error completing tutorial step:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
