import { NextRequest, NextResponse } from 'next/server';
import { TutorialService } from '@/lib/tutorial/tutorial-service';
import { verifyAuth } from '@/lib/auth';

/**
 * POST /api/tutorial/steps/[stepId]/skip
 * Skip a tutorial step
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
    const progress = await TutorialService.skipStep(user.userId, stepId);

    return NextResponse.json(progress);
  } catch (error: any) {
    // #318: a missing-step or required-step rejection from skipStep is a
    // client error, not a server fault.
    const isValidationError = typeof error?.message === 'string' && /^(Tutorial step not found|Cannot skip)/.test(error.message);
    if (!isValidationError) {
      console.error('Error skipping tutorial step:', error);
    }
    return NextResponse.json({ error: error.message }, { status: isValidationError ? 400 : 500 });
  }
}
