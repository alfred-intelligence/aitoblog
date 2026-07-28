import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Repo-committad observability för cron-publish (06-ci-cd-plan §4.3, §7b).
// Paus vid PAUSE_THRESHOLD fel i rad — cron slutar köra tills operatören
// återställer filen manuellt.

const STATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'cron-state.json',
);

export const PAUSE_THRESHOLD = 3;

export type CronState = {
  consecutive_failures: number;
  last_success: string | null;
  paused: boolean;
};

export async function readState(): Promise<CronState> {
  const raw = await readFile(STATE_PATH, 'utf8');
  return JSON.parse(raw) as CronState;
}

async function writeState(state: CronState): Promise<void> {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export async function markSuccess(): Promise<CronState> {
  const state = await readState();
  state.consecutive_failures = 0;
  state.last_success = new Date().toISOString();
  state.paused = false;
  await writeState(state);
  return state;
}

export async function markFailure(): Promise<CronState> {
  const state = await readState();
  state.consecutive_failures += 1;
  if (state.consecutive_failures >= PAUSE_THRESHOLD) {
    state.paused = true;
  }
  await writeState(state);
  return state;
}

// CLI-läge för workflow-steg: `tsx scripts/cron-state.ts <mark-success|mark-failure|status>`
// Failure räknas ENDAST härifrån (workflowens failure-steg) så att ett fel
// aldrig dubbelräknas mellan script och workflow.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const cmd = process.argv[2];
  const run = async () => {
    switch (cmd) {
      case 'mark-success': {
        const s = await markSuccess();
        console.log(JSON.stringify(s));
        break;
      }
      case 'mark-failure': {
        const s = await markFailure();
        console.log(JSON.stringify(s));
        break;
      }
      case 'status': {
        console.log(JSON.stringify(await readState()));
        break;
      }
      default:
        console.error('Usage: tsx scripts/cron-state.ts <mark-success|mark-failure|status>');
        process.exitCode = 2;
    }
  };
  run().catch((err) => {
    console.error('[cron-state]', err);
    process.exitCode = 1;
  });
}
