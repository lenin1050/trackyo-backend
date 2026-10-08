const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openrouter/free';

async function completeWithAi({
  systemPrompt,
  userPrompt,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  const apiKey = env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  if (typeof fetchImpl !== 'function') {
    throw new Error('The configured AI provider requires a Fetch API implementation');
  }

  const baseUrl = (env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const endpointUrl = new URL(`${baseUrl}/chat/completions`);
  if (endpointUrl.pathname.endsWith('/chat/completions/chat/completions')) {
    throw new Error('AI_BASE_URL must be the API base URL, not a completion endpoint');
  }
  if (endpointUrl.protocol !== 'https:' &&
      !(endpointUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpointUrl.hostname))) {
    throw new Error('AI_BASE_URL must use HTTPS, except for a localhost provider');
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(env.AI_TIMEOUT_MS) || 15000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://trackyo-frontend.onrender.com',
        'X-Title': 'TrackYo',
      },
      body: JSON.stringify({
        model: env.AI_MODEL?.trim() || DEFAULT_MODEL,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`AI provider returned HTTP ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('AI provider returned an empty completion');
    }
    return content.trim().slice(0, 4000);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { completeWithAi, DEFAULT_BASE_URL, DEFAULT_MODEL };
