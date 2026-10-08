const test = require('node:test');
const assert = require('node:assert/strict');
const { completeWithAi } = require('../services/aiProvider');

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

test('AI provider uses server configuration and returns completion text', async () => {
  let request;
  const result = await completeWithAi({
    systemPrompt: 'Use only supplied facts.',
    userPrompt: '{"expense":125}',
    env: {
      AI_API_KEY: 'test-secret',
      AI_API_URL: 'https://provider.example/v1/chat/completions',
      AI_MODEL: 'test-model',
    },
    fetchImpl: async (url, options) => {
      request = { url: String(url), options, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Recorded expenses: ₹125.' } }],
        }),
      };
    },
  });

  assert.equal(result, 'Recorded expenses: ₹125.');
  assert.equal(request.url, 'https://provider.example/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-secret');
  assert.equal(request.body.model, 'test-model');
  assert.deepEqual(request.body.messages, [
    { role: 'system', content: 'Use only supplied facts.' },
    { role: 'user', content: '{"expense":125}' },
  ]);
});

test('AI provider rejects insecure non-local endpoints', async () => {
  await assert.rejects(
    completeWithAi({
      systemPrompt: 'system',
      userPrompt: 'user',
      env: { AI_API_KEY: 'test-secret', AI_API_URL: 'http://provider.example/api' },
      fetchImpl: async () => {
        throw new Error('must not be called');
      },
    }),
    /must use HTTPS/,
  );
});

test('AI provider exposes the HTTP status without including provider response data', async () => {
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
    }),
    (error) => {
      assert.equal(error.statusCode, 429);
      assert.doesNotMatch(error.message, /test-secret|response body/);
      return true;
    },
  );
});
