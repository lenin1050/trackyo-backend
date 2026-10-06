const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseTransactionDate(value) {
  if (typeof value === 'string') {
    const match = dateOnlyPattern.exec(value);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
      ) {
        return new Date(NaN);
      }
      return date;
    }
  }
  return new Date(value);
}

function serializeTransactionDate(value, source) {
  const date = new Date(value);
  if (source === 'sms') return date.toISOString();
  return date.toISOString().slice(0, 10);
}

module.exports = { parseTransactionDate, serializeTransactionDate };
