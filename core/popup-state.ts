import type { Job, JobPhase, JobWorkflow } from './jobs';

export type PopupMode = JobWorkflow;
export type PopupStep = 'setup' | 'extract' | 'preview' | 'import' | 'report';

export interface PopupUiSelection {
  source?: Job['sourceProvider'];
  target?: Job['targetProvider'];
  mode?: PopupMode;
}

export type RestoredPopupState =
  | { kind: 'idle'; mode: PopupMode }
  | { kind: 'active'; mode: 'migrate' | 'import-file'; step: Exclude<PopupStep, 'setup'>; job: Job };

function activePhase(job: Job): JobPhase | undefined {
  if (job.phase) return job.phase;
  if (job.status === 'extracting') return job.workflow === 'export' ? 'exporting' : 'extract';
  if (job.status === 'preview') return 'preview';
  if (job.status === 'importing') return 'report';
  return undefined;
}

function isRecoverable(job: Job): boolean {
  if (job.status === 'cancelled' || job.status === 'done' || job.status === 'failed' || job.status === 'draft') return false;
  if (job.workflow === 'export') return job.status === 'extracting' && activePhase(job) === 'exporting';
  return activePhase(job) !== undefined;
}

function stepFor(job: Job): Exclude<PopupStep, 'setup'> | undefined {
  const phase = activePhase(job);
  if (job.workflow === 'migrate') {
    if (phase === 'extract' || phase === 'preview' || phase === 'import' || phase === 'report') return phase;
  }
  if (job.workflow === 'import-file') {
    if (phase === 'preview' || phase === 'import' || phase === 'report') return phase;
  }
  return undefined;
}

/** Decide popup startup state without React or browser dependencies. */
export function restorePopupState(jobs: Job[], selection: PopupUiSelection, activeJobId?: string, tabScoped = false): RestoredPopupState {
  const candidates = jobs
    .filter(isRecoverable)
    .filter((job) => tabScoped ? job.id === activeJobId : activeJobId === undefined || job.id === activeJobId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const job = candidates[0];
  const step = job ? stepFor(job) : undefined;
  if (job && step) {
    return { kind: 'active', mode: job.workflow as 'migrate' | 'import-file', step, job };
  }
  return { kind: 'idle', mode: selection.mode ?? 'migrate' };
}
