const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTransactionDate,
  serializeTransactionDate,
} = require('../services/transactionDate');

test('date-only transaction values persist at UTC midnight regardless of host timezone', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'Pacific/Honolulu';
  try {
    const date = parseTransactionDate('2026-07-25');
    assert.equal(date.toISOString(), '2026-07-25T00:00:00.000Z');
    assert.equal(serializeTransactionDate(date, 'receipt'), '2026-07-25');
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
});

test('SMS timestamps remain full instants when serialized', () => {
  const date = parseTransactionDate('2026-07-24T18:30:00.000Z');
  assert.equal(
    serializeTransactionDate(date, 'sms'),
    '2026-07-24T18:30:00.000Z',
  );
});

test('invalid date-only values are rejected instead of rolling into another day', () => {
  assert.equal(Number.isNaN(parseTransactionDate('2026-02-30').getTime()), true);
});
