// src/lib/ai/worldState.ts
// Convert database records into a clean format for the AI GM
//
// This file used to hold all of the below directly; it's now a thin
// barrel re-exporting from the focused modules it was split into, so
// existing importers (@/lib/ai/worldState) don't need to change:
//   - worldSummary.ts: scopeCharactersToParticipants, buildOptimizedWorldSummary,
//     buildWorldSummaryForAI (and why there's deliberately no buildFullWorldState)
//   - sceneResolutionRequest.ts: buildSceneResolutionRequest (memory/lore/
//     exchange-guidance/corruption assembly)
//   - sceneIntro.ts: generateNewSceneIntro
//   - sceneRecap.ts: summarizeSceneForLog, generateMilestoneRecap

export { scopeCharactersToParticipants, buildOptimizedWorldSummary, buildWorldSummaryForAI } from './worldSummary'
export { buildSceneResolutionRequest } from './sceneResolutionRequest'
export { generateNewSceneIntro } from './sceneIntro'
export { summarizeSceneForLog, generateMilestoneRecap } from './sceneRecap'
