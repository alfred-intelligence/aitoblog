// Retry för transienta API-fel (06-ci-cd-plan §4.3): max 3 försök,
// backoff 2s → 5s → 15s. Permanenta fel (auth, 4xx utom 408/429) retrias inte.

const BACKOFF_MS = [2000, 5000, 15000];

function statusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const anyErr = err as { status?: unknown; response?: { status?: unknown } };
  const status = anyErr.status ?? anyErr.response?.status;
  return typeof status === 'number' ? status : undefined;
}

export function isTransient(err: unknown): boolean {
  const status = statusOf(err);
  if (status !== undefined) {
    return status === 408 || status === 429 || status >= 500;
  }
  // Nätverksfel utan HTTP-status (fetch failed, ECONNRESET, timeout).
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(
    msg,
  );
}

export async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === BACKOFF_MS.length) throw err;
      const delay = BACKOFF_MS[attempt];
      console.warn(
        `[retry] ${label}: transient fel (försök ${attempt + 1}), nytt försök om ${delay / 1000}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
