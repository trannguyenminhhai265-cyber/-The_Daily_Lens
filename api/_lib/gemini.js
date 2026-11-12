// Gemini embedding client (REST). Never logs or returns the API key.
export const MODEL = 'gemini-embedding-2';
export const DIMENSIONS = 768;
// Query prefix for text -> document search. Image queries use no prefix (see docs/search-engine-tasks.md, section 2).
export const QUERY_PREFIX = 'task: search result | query: ';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`;

export class GeminiError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.retryable = retryable;
  }
}

export function normalize(values) {
  let sum = 0;
  for (const x of values) sum += x * x;
  const norm = Math.sqrt(sum);
  if (!norm || !Number.isFinite(norm)) throw new GeminiError('Gemini returned a zero or invalid vector');
  return values.map(x => x / norm);
}

// pgvector text literal, accepted by PostgREST for extensions.vector columns/arguments.
export const toVectorLiteral = vec => `[${vec.join(',')}]`;

function abortError(signal) {
  return new GeminiError(signal?.reason?.name === 'TimeoutError' ? 'Gemini request timed out' : 'Gemini request aborted', { retryable: false });
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError(signal)); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Embed a list of Gemini "parts" and return a normalized 768-d vector.
 * opts: retries (default 5; retried on 429/5xx/network errors with exponential backoff),
 *       baseDelayMs (default 2000), timeoutMs (per attempt, default 30000), signal (overall deadline).
 */
export async function embedParts(parts, { retries = 5, baseDelayMs = 2000, timeoutMs = 30000, signal } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError('GEMINI_API_KEY is not configured');
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortError(signal);
    const attemptSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    let failure;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ content: { parts }, outputDimensionality: DIMENSIONS }),
        signal: attemptSignal,
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const values = body.embedding?.values ?? body.embeddings?.[0]?.values;
        if (!Array.isArray(values) || values.length !== DIMENSIONS) throw new GeminiError('Gemini returned an unexpected embedding shape');
        return normalize(values);
      }
      const detail = String(body.error?.message ?? '').slice(0, 200);
      failure = new GeminiError(`Gemini HTTP ${res.status}${detail ? ': ' + detail : ''}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 });
    } catch (err) {
      if (err instanceof GeminiError) failure = err;
      else if (signal?.aborted) throw abortError(signal);
      else failure = new GeminiError(err?.name === 'TimeoutError' ? 'Gemini request timed out' : 'Gemini network error', { retryable: true });
    }
    if (!failure.retryable || attempt >= retries) throw failure;
    await sleep(baseDelayMs * 2 ** attempt, signal);
  }
}

export const embedText = (text, opts) => embedParts([{ text }], opts);
export const embedQuery = (q, opts) => embedText(QUERY_PREFIX + q, opts);
export const embedImage = (mimeType, base64, opts) => embedParts([{ inlineData: { mimeType, data: base64 } }], opts);
