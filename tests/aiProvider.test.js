const test = require('node:test');
const assert = require('node:assert/strict');
const {
  completeWithAi,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
} = require('../services/aiProvider');

test('AI provider remains disabled when no API key is configured', async () => {
  let called = false;
  const result = await completeWithAi({
    systemPrompt: 'system',
    userPrompt: 'user',
    env: {},
    fetchImpl: async () => {
      called = true;
      throw new Error('must not be called');
    },
  });

  assert.equal(result, null);
  assert.equal(called, false);
});

test('OpenRouter uses server configuration and returns completion text', async () => {
  let request;
  const logs = [];
  const result = await completeWithAi({
    systemPrompt: 'Use only supplied facts.',
    userPrompt: '{"expense":125}',
    env: {
      AI_API_KEY: 'test-secret',
      AI_BASE_URL: 'https://openrouter.example/api/v1/',
      AI_MODEL: 'openrouter/test-free:free',
    },
    fetchImpl: async (url, options) => {
      request = { url: String(url), options, body: JSON.parse(options.body) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Recorded expenses: ₹125.' } }],
        }),
      };
    },
    logger: {
      info: (...entry) => logs.push(entry),
      error: (...entry) => logs.push(entry),
    },
  });

  assert.equal(result, 'Recorded expenses: ₹125.');
  assert.equal(request.url, 'https://openrouter.example/api/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-secret');
  assert.equal(request.body.model, 'openrouter/test-free:free');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.equal(request.options.headers.Authorization.startsWith('Bearer '), true);
  assert.equal(request.options.headers.Authorization.endsWith('test-secret'), true);
  assert.equal(request.options.headers['HTTP-Referer'], 'https://trackyo-frontend.onrender.com');
  assert.equal(request.options.headers['X-Title'], 'TrackYo');
  assert.deepEqual(request.body.messages, [
    { role: 'system', content: 'Use only supplied facts.' },
    { role: 'user', content: '{"expense":125}' },
  ]);
  assert.deepEqual(logs[0][1], {
    url: 'https://openrouter.example/api/v1/chat/completions',
    model: 'openrouter/test-free:free',
    timeoutMs: 15000,
  });
});

test('AI provider defaults to OpenRouter free model', async () => {
  let requestUrl;
  let requestBody;
  await completeWithAi({
    systemPrompt: 'system',
    userPrompt: 'user',
    env: { AI_API_KEY: 'test-secret' },
    fetchImpl: async (url, options) => {
      requestUrl = String(url);
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"type":"expense"}' } }],
        }),
      };
    },
  });

  assert.equal(DEFAULT_BASE_URL, 'https://openrouter.ai/api/v1');
  assert.equal(DEFAULT_MODEL, 'openrouter/free');
  assert.equal(requestUrl, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(requestBody.model, 'openrouter/free');
});

test('AI provider rejects insecure non-local base URLs', async () => {
  await assert.rejects(
    completeWithAi({
      systemPrompt: 'system',
      userPrompt: 'user',
      env: { AI_API_KEY: 'test-secret', AI_BASE_URL: 'http://provider.example/api' },
      fetchImpl: async () => {
        throw new Error('must not be called');
      },
    }),
    /must use HTTPS/,
  );
});

test('AI provider exposes the HTTP status without including provider response data', async () => {
  const logs = [];
  await assert.rejects(
    completeWithAi({
      systemPrompt: 'system',
      userPrompt: 'user',
      env: { AI_API_KEY: 'test-secret' },
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        text: async () => 'response body must not be logged',
      }),
      logger: {
        info: (...entry) => logs.push(entry),
        error: (...entry) => logs.push(entry),
      },
    }),
    (error) => {
      assert.equal(error.statusCode, 429);
      assert.doesNotMatch(error.message, /test-secret|response body/);
      return true;
    },
  );
  const failureLog = logs.find(([message]) =>
    message === '[ai-provider] HTTP request failed',
  );
  assert.equal(failureLog[1].statusCode, 429);
  assert.equal(failureLog[1].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.doesNotMatch(JSON.stringify(logs), /test-secret|response body/);
});

test('AI provider logs network error details safely and rethrows the original error', async () => {
  const logs = [];
  const networkError = Object.assign(
    new TypeError('fetch failed'),
    {
      code: 'FETCH_ERROR',
      cause: Object.assign(
        new Error('connect failed with Bearer test-secret'),
        { code: 'EAI_AGAIN' },
      ),
    },
  );

  await assert.rejects(
    completeWithAi({
      systemPrompt: 'system',
      userPrompt: 'user',
      env: {
        AI_API_KEY: 'test-secret',
        AI_MODEL: 'openrouter/free',
        AI_TIMEOUT_MS: '9000',
      },
      fetchImpl: async () => {
        throw networkError;
      },
      logger: {
        info: (...entry) => logs.push(entry),
        error: (...entry) => logs.push(entry),
      },
    }),
    (error) => error === networkError,
  );

  const failureLog = logs.find(([message]) =>
    message === '[ai-provider] Network request failed',
  );
  assert.ok(failureLog);
  assert.equal(failureLog[1].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(failureLog[1].model, 'openrouter/free');
  assert.equal(failureLog[1].timeoutMs, 9000);
  assert.equal(failureLog[1].errorName, 'TypeError');
  assert.equal(failureLog[1].errorCode, 'FETCH_ERROR');
  assert.equal(failureLog[1].causeCode, 'EAI_AGAIN');
  assert.equal(failureLog[1].causeName, 'Error');
  assert.match(failureLog[1].causeMessage, /connect failed/);
  assert.doesNotMatch(JSON.stringify(logs), /test-secret/);
  assert.equal(failureLog[1].errorMessage, 'fetch failed');
  assert.equal(failureLog[1].causeMessage, 'connect failed with Bearer [REDACTED]');
});
