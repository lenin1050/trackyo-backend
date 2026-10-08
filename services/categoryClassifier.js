const categoryKeywords = [
  {
    category: ['fuel', 'petrol'],
    fallbackCategory: ['transport', 'travel'],
    keywords: [
      'petrol',
      'diesel',
      'fuel',
      'indian oil',
      'bharat petroleum',
      'hpcl',
      'bpcl',
    ],
  },
  {
    category: ['groceries', 'grocery', 'supermarket'],
    keywords: [
      'grocery',
      'groceries',
      'supermarket',
      'vegetable',
      'fruit',
      'milk',
      'market',
    ],
  },
  {
    category: ['food', 'dining', 'restaurant'],
    keywords: [
      'kfc',
      'mcdonald',
      'domino',
      'dominos',
      'pizza hut',
      'swiggy',
      'zomato',
      'restaurant',
      'cafe',
      'coffee',
      'food',
      'bakery',
    ],
  },
  {
    category: ['transport', 'travel'],
    keywords: [
      'uber',
      'ola',
      'rapido',
      'metro',
      'flight',
      'train',
      'bus',
      'taxi',
      'transport',
    ],
  },
  {
    category: ['shopping', 'retail'],
    keywords: ['amazon', 'flipkart', 'myntra', 'shopping', 'retail'],
  },
  {
    category: ['bills', 'utilities', 'utility', 'billsutilities', 'recharge'],
    keywords: [
      'electricity',
      'water bill',
      'internet',
      'broadband',
      'utility',
      'mobile bill',
      'mobile recharge',
      'recharge',
      'phone bill',
      'gas bill',
      'telecom',
    ],
  },
  {
    category: ['entertainment'],
    keywords: ['netflix', 'spotify', 'cinema', 'movie', 'theatre'],
  },
  {
    category: ['medical', 'health', 'healthcare', 'pharmacy'],
    keywords: [
      'apollo',
      'pharmacy',
      'medical',
      'hospital',
      'medicine',
      'clinic',
      'chemist',
    ],
  },
];

const normalizeCategory = (name) =>
  String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function classifyExpenseCategory({ merchant = '', description = '', categories = [] }) {
  const text = `${merchant} ${description}`.toLowerCase();
  if (!text.trim() || !Array.isArray(categories) || categories.length === 0) {
    return null;
  }

  for (const mapping of categoryKeywords) {
    if (!mapping.keywords.some((keyword) => text.includes(keyword))) continue;
    const match = categories.find((category) =>
      mapping.category.includes(normalizeCategory(category.name)),
    );
    if (match) return match.name;
    if (mapping.fallbackCategory) {
      const fallback = categories.find((category) =>
        mapping.fallbackCategory.includes(normalizeCategory(category.name)),
      );
      if (fallback) return fallback.name;
    }
  }

  return categories.find((category) => category.name.toLowerCase() === 'other')
    ?.name || null;
}

module.exports = { classifyExpenseCategory };
