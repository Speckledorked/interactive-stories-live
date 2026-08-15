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
    // #317: a missing-step or unmet-prerequisite rejection from
    // completeStep is a client error, not a server fault — distinguished
    // by message prefix rather than a custom error class, matching this
    // service's existing plain-Error convention.
    const isValidationError = typeof error?.message === 'string' && /^(Tutorial step not found|Cannot complete)/.test(error.message);
    if (!isValidationError) {
      console.error('Error completing tutorial step:', error);
    }
    return NextResponse.json({ error: error.message }, { status: isValidationError ? 400 : 500 });
  }
}
