import type { PostedRecord, Source } from './schema.js';

const COOLDOWN_DAYS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function selectCandidate(
  sources: Source[],
  posted: PostedRecord,
  now: Date = new Date(),
): Source {
  if (sources.length === 0) {
    throw new Error('No sources available — check data/sources.json or SOURCES_URL.');
  }

  const cooldownCutoff = now.getTime() - COOLDOWN_DAYS * MS_PER_DAY;
  const eligible = sources.filter((src) => {
    const last = posted[src.key];
    if (!last) return true;
    const lastTime = new Date(last).getTime();
    return Number.isFinite(lastTime) && lastTime < cooldownCutoff;
  });

  if (eligible.length > 0) {
    return eligible[Math.floor(Math.random() * eligible.length)];
  }

  console.warn('[topic-selector] All sources in cooldown — falling back to least-recently-posted.');
  const sorted = [...sources].sort((a, b) => {
    const aTime = posted[a.key] ? new Date(posted[a.key]).getTime() : 0;
    const bTime = posted[b.key] ? new Date(posted[b.key]).getTime() : 0;
    return aTime - bTime;
  });
  return sorted[0];
}
