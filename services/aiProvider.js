const DEFAULT_API_URL = 'https://api.openai.com/v1/chat/completions';

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

  const endpoint = env.AI_API_URL?.trim() || DEFAULT_API_URL;
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== 'https:' &&
      !(endpointUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpointUrl.hostname))) {
    throw new Error('AI_API_URL must use HTTPS, except for a localhost provider');
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
      },
      body: JSON.stringify({
        model: env.AI_MODEL?.trim() || 'gpt-4o-mini',
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
      throw new Error(`AI provider returned HTTP ${response.status}`);
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

module.exports = { completeWithAi };
