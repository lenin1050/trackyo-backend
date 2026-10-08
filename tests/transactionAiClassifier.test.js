const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyTransaction,
  redactSensitiveText,
} = require('../services/transactionAiClassifier');

const categories = [
  { name: 'Food' },
  { name: 'Fuel' },
  { name: 'Transport' },
  { name: 'Shopping' },
  { name: 'Bills' },
  { name: 'Other' },
];
const incomeSources = [
  { name: 'Salary' },
  { name: 'Freelance' },
  { name: 'Other' },
];

async function classify(aiResult, { source = 'sms', text = 'source transaction' } = {}) {
  return classifyTransaction({
    text,
    source,
    categories,
    incomeSources,
    complete: async ({ userPrompt }) => {
      const prompt = JSON.parse(userPrompt);
      assert.equal(prompt.transactionText.includes('source transaction'), text.includes('source transaction'));
      return JSON.stringify(aiResult);
    },
  });
}

test('classifies a confident Swiggy UPI food expense', async () => {
  const result = await classify({
    type: 'expense',
    amount: 450,
    merchant: 'Swiggy',
    category: 'Food',
    paymentMethod: 'UPI',
    date: '2026-10-08T12:00:00Z',
    description: 'Food order',
    confidence: 0.95,
  });

  assert.equal(result.available, true);
  assert.equal(result.reviewRequired, false);
  assert.equal(result.category, 'Food');
  assert.equal(result.paymentMethod, 'UPI');
});

test('classifies fuel and shopping into existing categories', async () => {
  const fuel = await classify({
    type: 'expense',
    amount: 1500,
    merchant: 'Indian Oil',
    category: 'Fuel',
    paymentMethod: 'Card',
    date: null,
    description: 'Fuel purchase',
    confidence: 0.9,
  });
  const shopping = await classify({
    type: 'expense',
    amount: 2200,
    merchant: 'Amazon',
    category: 'Shopping',
    paymentMethod: 'UPI',
    date: null,
    description: 'Online order',
    confidence: 0.91,
  });

  assert.equal(fuel.category, 'Fuel');
  assert.equal(shopping.category, 'Shopping');
  assert.equal(fuel.reviewRequired, false);
  assert.equal(shopping.reviewRequired, false);
});

test('classifies salary as a user income source', async () => {
  const result = await classify({
    type: 'income',
    amount: 35000,
    merchant: 'Acme Corp',
    category: 'Salary',
    paymentMethod: 'Bank',
    date: null,
    description: 'Salary received',
    confidence: 0.97,
  });

  assert.equal(result.type, 'income');
  assert.equal(result.category, 'Salary');
  assert.equal(result.reviewRequired, false);
});

test('requires review for low confidence, invalid amount, or unknown category', async () => {
  const lowConfidence = await classify({
    type: 'expense',
    amount: 450,
    merchant: 'Unknown',
    category: 'Food',
    paymentMethod: 'UPI',
    date: null,
    description: 'Payment',
    confidence: 0.5,
  });
  const invalid = await classify({
    type: 'income',
    amount: -5,
    merchant: '',
    category: 'Made up',
    paymentMethod: 'Bank',
    date: 'not a date',
    description: 'Payment',
    confidence: 0.99,
  });

  assert.equal(lowConfidence.reviewRequired, true);
  assert.equal(invalid.reviewRequired, true);
  assert.equal(invalid.amount, null);
  assert.equal(invalid.category, '');
});

test('invalid or ambiguous model text returns a review-required result', async () => {
  const result = await classify('not json');

  assert.equal(result.available, true);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.confidence, 0);
});

test('provider failure and absent configuration allow the parser fallback', async () => {
  const unavailable = await classifyTransaction({
    text: 'Rs.500 debited at Swiggy',
    source: 'sms',
    categories,
    incomeSources,
    complete: async () => null,
  });
  const failed = await classifyTransaction({
    text: 'Rs.500 debited at Swiggy',
    source: 'sms',
    categories,
    incomeSources,
    complete: async () => {
      throw new Error('provider failure');
    },
  });

  assert.equal(unavailable.available, false);
  assert.equal(unavailable.reviewRequired, false);
  assert.equal(failed.available, false);
  assert.equal(failed.reviewRequired, false);
});

test('redacts OTPs, account identifiers and long number sequences', () => {
  const sanitized = redactSensitiveText(
    'OTP 481902, A/c XX1234, account number 1234567890123456 paid Rs.500',
  );
  assert.doesNotMatch(sanitized, /481902|1234567890123456/);
  assert.match(sanitized, /REDACTED/);
  assert.match(sanitized, /Rs\.500/);
});
