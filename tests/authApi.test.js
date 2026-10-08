const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'trackyo-auth-api-test-secret-that-is-long-enough';

const { app } = require('../server');

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('health reports a successful response for a running non-production API', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.app, 'TrackYo API');
});

test('health and authentication routes allow the Android native client', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://trackyo-project1.onrender.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    'https://trackyo-project1.onrender.com',
  );
  assert.match(
    response.headers.get('access-control-allow-methods') || '',
    /POST/,
  );
});

test('production startup requires Atlas URI and a sufficiently strong JWT secret', () => {
  const runWithProductionEnvironment = (overrides) =>
    spawnSync(process.execPath, ['-e', "require('./server')"], {
      cwd: __dirname + '/..',
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        JWT_SECRET: 'a-production-secret-with-at-least-32-characters',
        MONGODB_URI: 'mongodb+srv://example.invalid/trackyo',
        ...overrides,
      },
    });

  const missingMongoUri = runWithProductionEnvironment({ MONGODB_URI: '' });
  assert.notEqual(missingMongoUri.status, 0);
  assert.match(missingMongoUri.stderr, /MONGODB_URI is required/);

  const nonAtlasMongoUri = runWithProductionEnvironment({
    MONGODB_URI: 'mongodb://127.0.0.1:27017/trackyo',
  });
  assert.notEqual(nonAtlasMongoUri.status, 0);
  assert.match(nonAtlasMongoUri.stderr, /mongodb\+srv URI/);

  const missingJwtSecret = runWithProductionEnvironment({ JWT_SECRET: '' });
  assert.notEqual(missingJwtSecret.status, 0);
  assert.match(missingJwtSecret.stderr, /JWT_SECRET is required/);

  const weakJwtSecret = runWithProductionEnvironment({ JWT_SECRET: 'too-short' });
  assert.notEqual(weakJwtSecret.status, 0);
  assert.match(weakJwtSecret.stderr, /at least 32 characters/);
});

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

test('registration validates input, hashes password, and never returns hash', async () => {
  const shortPassword = await request('/api/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Auth Test',
      email: 'short@example.com',
      password: 'short',
      confirmPassword: 'short',
    },
  });
  assert.equal(shortPassword.status, 400);

  const mismatch = await request('/api/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Auth Test',
      email: 'mismatch@example.com',
      password: 'secure-pass-1',
      confirmPassword: 'secure-pass-2',
    },
  });
  assert.equal(mismatch.status, 400);

  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Auth Test',
      email: `auth-${Date.now()}@example.com`,
      password: 'correct-horse-1',
      confirmPassword: 'correct-horse-1',
    },
  });
  assert.equal(registered.status, 201);
  assert.ok(registered.body.token);
  assert.deepEqual(Object.keys(registered.body.user).sort(), [
    'email',
    'fullName',
    'id',
  ]);
  assert.equal('passwordHash' in registered.body, false);
  assert.equal('passwordHash' in registered.body.user, false);

  const profile = await request('/api/auth/me', {
    token: registered.body.token,
  });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.email, registered.body.user.email);
  assert.equal('passwordHash' in profile.body, false);
});

test('login verifies hashed credentials and protected routes reject invalid tokens', async () => {
  const email = `login-${Date.now()}@example.com`;
  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Login Test',
      email,
      password: 'correct-horse-2',
      confirmPassword: 'correct-horse-2',
    },
  });
  assert.equal(registration.status, 201);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'correct-horse-2' },
  });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);

  const badLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'incorrect-pass' },
  });
  assert.equal(badLogin.status, 401);
  const invalidEmail = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'invalid-email', password: 'incorrect-pass' },
  });
  assert.equal(invalidEmail.status, 400);
  const oversizedPassword = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'x'.repeat(73) },
  });
  assert.equal(oversizedPassword.status, 400);

  const missing = await request('/api/transactions');
  assert.equal(missing.status, 401);
  const invalid = await request('/api/transactions', {
    token: 'not-a-valid-token',
  });
  assert.equal(invalid.status, 401);
});

test('transactions and budgets are isolated by authenticated user', async () => {
  const register = async (prefix) => {
    const response = await request('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: `${prefix} User`,
        email: `${prefix.toLowerCase()}-${Date.now()}@example.com`,
        password: 'isolation-test-pass',
        confirmPassword: 'isolation-test-pass',
      },
    });
    assert.equal(response.status, 201);
    return response.body.token;
  };

  const userA = await register('Alpha');
  const userB = await register('Bravo');
  const added = await request('/api/transactions', {
    method: 'POST',
    token: userA,
    body: {
      type: 'expense',
      amount: 125,
      category: 'Food',
      incomeSource: '',
      date: new Date().toISOString(),
      source: 'manual',
    },
  });
  assert.equal(added.status, 201);

  const userATransactions = await request('/api/transactions', {
    token: userA,
  });
  const userBTransactions = await request('/api/transactions', {
    token: userB,
  });
  assert.equal(userATransactions.body.length, 1);
  assert.equal(userBTransactions.body.length, 0);

  const userASummary = await request('/api/analytics/summary', {
    token: userA,
  });
  const userBSummary = await request('/api/analytics/summary', {
    token: userB,
  });
  assert.equal(userASummary.body.totalExpense, 125);
  assert.equal(userBSummary.body.totalExpense, 0);

  const userBAnswer = await request('/api/ai/chat', {
    method: 'POST',
    token: userB,
    body: { message: 'How much did I spend this month?' },
  });
  assert.equal(userBAnswer.status, 200);
  assert.match(userBAnswer.body.answer, /no .*transaction|no expenses/i);

  const createdBudget = await request('/api/budgets', {
    method: 'POST',
    token: userA,
    body: {
      category: 'Overall spending',
      amount: 1000,
      month: new Date().toISOString().slice(0, 7),
    },
  });
  assert.equal(createdBudget.status, 201);
  const userBBudgets = await request('/api/budgets', { token: userB });
  assert.equal(userBBudgets.body.length, 0);

  const foreignDelete = await request(
    `/api/transactions/${added.body.id}`,
    { method: 'DELETE', token: userB },
  );
  assert.equal(foreignDelete.status, 404);
});

test('transaction classification endpoint is authenticated and falls back without AI config', async () => {
  const originalApiKey = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  try {
    const unauthorized = await request('/api/ai/classify-transaction', {
      method: 'POST',
      body: { source: 'sms', text: 'Rs.450 spent at Swiggy using UPI' },
    });
    assert.equal(unauthorized.status, 401);

    const registration = await request('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'AI Classifier Test',
        email: `ai-classifier-${Date.now()}@example.com`,
        password: 'correct-horse-ai-classifier',
        confirmPassword: 'correct-horse-ai-classifier',
      },
    });
    assert.equal(registration.status, 201);

    const fallback = await request('/api/ai/classify-transaction', {
      method: 'POST',
      token: registration.body.token,
      body: { source: 'sms', text: 'Rs.450 spent at Swiggy using UPI' },
    });
    assert.equal(fallback.status, 200);
    assert.equal(fallback.body.available, false);
    assert.equal(fallback.body.reviewRequired, false);
    assert.match(fallback.body.message, /existing parser results were retained/);

    const invalidSource = await request('/api/ai/classify-transaction', {
      method: 'POST',
      token: registration.body.token,
      body: { source: 'manual', text: 'some text' },
    });
    assert.equal(invalidSource.status, 400);
  } finally {
    if (originalApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalApiKey;
  }
});
