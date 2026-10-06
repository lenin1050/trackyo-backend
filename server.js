const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const User = require('./models/User');
const Transaction = require('./models/Transaction');
const Category = require('./models/Category');
const IncomeSource = require('./models/IncomeSource');
const Budget = require('./models/Budget');
const {
  defaultExpenseCategories,
  defaultIncomeSources,
} = require('./services/transactionCatalog');
const { summarize } = require('./services/financeSummary');
const {
  answerFinancialQuestion,
  generateFinancialInsights,
} = require('./services/financialAssistant');
const {
  parseTransactionDate,
  serializeTransactionDate,
} = require('./services/transactionDate');
const { calculateBudgetUsage } = require('./services/budgetMath');

const app = express();
const port = Number(process.env.PORT || 5000);
const isProduction = process.env.NODE_ENV === 'production';
const configuredJwtSecret = process.env.JWT_SECRET?.trim();
const jwtSecret = configuredJwtSecret || crypto.randomBytes(32).toString('hex');
const configuredMongoUri = process.env.MONGODB_URI?.trim();
const mongoUri =
  configuredMongoUri ||
  (isProduction ? null : 'mongodb://127.0.0.1:27017/trackyo');
let databaseMode = 'connecting';

if (isProduction && !configuredJwtSecret) {
  throw new Error('JWT_SECRET is required when NODE_ENV=production');
}
if (isProduction && configuredJwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}
if (isProduction && !configuredMongoUri) {
  throw new Error('MONGODB_URI is required when NODE_ENV=production');
}
if (isProduction && !configuredMongoUri.startsWith('mongodb+srv://')) {
  throw new Error('MONGODB_URI must be a MongoDB Atlas mongodb+srv URI in production');
}

const memory = {
  users: [],
  transactions: [],
  categories: [],
  incomeSources: [],
  budgets: [],
};
app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
app.use(express.json({ limit: '10mb' }));

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const userIdOf = (user) => String(user._id || user.id);
const mongoAvailable = () => databaseMode === 'mongodb' && mongoose.connection.readyState === 1;
const validObjectId = (id) => mongoose.isValidObjectId(id);
const validMonth = (month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(month));
const cleanString = (value, max = 120) => String(value || '').trim().slice(0, max);
const toPublic = (doc) => {
  const item = doc.toObject ? doc.toObject() : doc;
  return { id: String(item._id || item.id), fullName: item.fullName, email: item.email };
};
const toTransaction = (doc) => {
  const item = doc.toObject ? doc.toObject() : doc;
  const source = item.source || 'manual';
  return {
    id: String(item._id || item.id), type: item.type, amount: Number(item.amount),
    category: item.category || '',
    incomeSource: item.incomeSource || (item.type === 'income' ? item.category || '' : ''),
    description: item.description || '', merchant: item.merchant || '',
    paymentMethod: item.paymentMethod || 'UPI',
    date: serializeTransactionDate(item.date, source),
    source, receiptImage: item.receiptImage || '',
    smsFingerprint: item.smsFingerprint || '',
  };
};
const toCategory = (doc) => {
  const item = doc.toObject ? doc.toObject() : doc;
  return { id: String(item._id || item.id), name: item.name, icon: item.icon || 'category', color: item.color || '#3B82F6', isDefault: Boolean(item.isDefault) };
};
const toIncomeSource = (doc) => {
  const item = doc.toObject ? doc.toObject() : doc;
  return { id: String(item._id || item.id), name: item.name, isDefault: Boolean(item.isDefault) };
};
const toBudget = (doc) => {
  const item = doc.toObject ? doc.toObject() : doc;
  return { id: String(item._id || item.id), category: item.category, amount: Number(item.amount), month: item.month };
};
const orderOptions = (rows, preferredNames) => {
  const priority = new Map(
    preferredNames.map((name, index) => [name.toLowerCase(), index]),
  );
  return rows.sort((a, b) => {
    const rankA = priority.get(a.name.toLowerCase()) ?? preferredNames.length;
    const rankB = priority.get(b.name.toLowerCase()) ?? preferredNames.length;
    return rankA - rankB || a.name.localeCompare(b.name);
  });
};

function authenticate(req, res, next) {
  const authorization = req.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return res.status(401).json({ message: 'Bearer token required' });
  try {
    const payload = jwt.verify(authorization.slice(7), jwtSecret, {
      issuer: 'trackyo-api',
      algorithms: ['HS256'],
    });
    if (typeof payload !== 'object' || !payload.sub) throw new Error('Invalid token payload');
    req.userId = String(payload.sub);
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function createToken(user) {
  return jwt.sign(
    { sub: userIdOf(user) },
    jwtSecret,
    { expiresIn: '7d', issuer: 'trackyo-api', algorithm: 'HS256' },
  );
}

function inCurrentMonth(date) {
  const value = new Date(date);
  const now = new Date();
  return value.getFullYear() === now.getFullYear() && value.getMonth() === now.getMonth();
}

async function listTransactions(userId) {
  if (mongoAvailable()) return (await Transaction.find({ userId }).sort({ date: -1 })).map(toTransaction);
  return memory.transactions
    .filter((item) => item.userId === userId)
    .map(toTransaction);
}

async function findUserByEmail(email) {
  const normalized = cleanString(email, 254).toLowerCase();
  return mongoAvailable()
    ? User.findOne({ email: normalized })
    : memory.users.find((user) => user.email === normalized) || null;
}

function validateTransaction(input) {
  const type = input.type;
  const amount = Number(input.amount);
  const date = input.date == null ? new Date() : parseTransactionDate(input.date);
  if (!['income', 'expense'].includes(type)) return 'Type must be income or expense';
  if (!Number.isFinite(amount) || amount <= 0) return 'Amount must be greater than zero';
  const category = cleanString(input.category, 80);
  const incomeSource = cleanString(input.incomeSource, 80);
  if (type === 'expense' && (!category || incomeSource)) {
    return 'Expense transactions require an expense category only';
  }
  if (type === 'income' && (!incomeSource || category)) {
    return 'Income transactions require an income source only';
  }
  if (Number.isNaN(date.getTime())) return 'Date is invalid';
  return null;
}

async function ensureUserTransactionOptions(userId) {
  if (mongoAvailable()) {
    const legacyIncomes = await Transaction.find({
      userId,
      type: 'income',
      category: { $nin: ['', null] },
      $or: [{ incomeSource: { $exists: false } }, { incomeSource: '' }],
    }).select('category');
    for (const transaction of legacyIncomes) {
      const name = cleanString(transaction.category, 80);
      if (!name) continue;
      const existingSource = await IncomeSource.findOne({
        userId,
        name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      });
      if (!existingSource) {
        try {
          await IncomeSource.create({ userId, name });
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
      }
      const storedSourceName = existingSource?.name || name;
      await Transaction.updateOne(
        { _id: transaction._id, userId },
        { $set: { incomeSource: storedSourceName }, $unset: { category: '' } },
      );
    }
  } else {
    for (const transaction of memory.transactions.filter(
      (item) => item.userId === userId && item.type === 'income' && !item.incomeSource && item.category,
    )) {
      transaction.incomeSource = transaction.category;
      transaction.category = '';
      if (
        !memory.incomeSources.some(
          (source) =>
            source.userId === userId &&
            source.name.toLowerCase() === transaction.incomeSource.toLowerCase(),
        )
      ) {
        memory.incomeSources.push({
          id: crypto.randomUUID(),
          userId,
          name: transaction.incomeSource,
          isDefault: false,
        });
      }
    }
  }

  for (const name of defaultExpenseCategories) {
    if (mongoAvailable()) {
      const match = await Category.findOne({
        userId,
        name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      });
      if (match && !match.isDefault) {
        match.isDefault = true;
        await match.save();
      } else if (!match) {
        try {
          await Category.create({ userId, name, isDefault: true });
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
      }
    } else {
      const match = memory.categories.find(
        (item) => item.userId === userId && item.name.toLowerCase() === name.toLowerCase(),
      );
      if (match) {
        match.isDefault = true;
      } else {
        memory.categories.push({
          id: crypto.randomUUID(),
          userId,
          name,
          icon: 'category',
          color: '#3B82F6',
          isDefault: true,
        });
      }
    }
  }

  for (const name of defaultIncomeSources) {
    if (mongoAvailable()) {
      const match = await IncomeSource.findOne({
        userId,
        name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      });
      if (match && !match.isDefault) {
        match.isDefault = true;
        await match.save();
      } else if (!match) {
        try {
          await IncomeSource.create({ userId, name, isDefault: true });
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
      }
    } else {
      const match = memory.incomeSources.find(
        (item) => item.userId === userId && item.name.toLowerCase() === name.toLowerCase(),
      );
      if (match) {
        match.isDefault = true;
      } else {
        memory.incomeSources.push({
          id: crypto.randomUUID(),
          userId,
          name,
          isDefault: true,
        });
      }
    }
  }
}

app.get('/health', (req, res) => {
  const ready = !isProduction || mongoAvailable();
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'unavailable',
    app: 'TrackYo API',
    database: mongoAvailable() ? 'mongodb' : 'memory',
    mongodb: mongoAvailable() ? 'connected' : databaseMode,
  });
});

app.use((req, res, next) => {
  if (databaseMode === 'unavailable' && req.path !== '/health') {
    return res.status(503).json({ message: 'Database connection was lost. Retry after storage is restored.' });
  }
  return next();
});

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const fullName = cleanString(req.body?.fullName, 100);
  const email = cleanString(req.body?.email, 254).toLowerCase();
  const password = req.body?.password;
  if (!fullName || !email || typeof password !== 'string' ||
      typeof req.body?.confirmPassword !== 'string') {
    return res.status(400).json({ message: 'All fields are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Email is invalid' });
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ message: 'Password must be 8-72 bytes' });
  }
  if (!mongoAvailable() && process.env.NODE_ENV === 'production') {
    return res.status(503).json({ message: 'Persistent storage is unavailable; registration is temporarily disabled' });
  }
  if (password !== req.body.confirmPassword) return res.status(400).json({ message: 'Passwords do not match' });
  if (await findUserByEmail(email)) return res.status(409).json({ message: 'Email already registered' });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = mongoAvailable()
    ? await User.create({ fullName, email, passwordHash })
    : { id: crypto.randomUUID(), fullName, email, passwordHash };
  if (!mongoAvailable()) memory.users.push(user);
  await ensureUserTransactionOptions(userIdOf(user));
  return res.status(201).json({ token: createToken(user), user: toPublic(user) });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = cleanString(req.body?.email, 254).toLowerCase();
  const password = req.body?.password;
  if (!email || typeof password !== 'string') return res.status(400).json({ message: 'Email and password are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'Email is invalid' });
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ message: 'Password is invalid' });
  }
  if (!mongoAvailable() && process.env.NODE_ENV === 'production') {
    return res.status(503).json({ message: 'Persistent storage is unavailable; login is temporarily disabled' });
  }
  const user = await findUserByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ message: 'Invalid credentials' });
  await ensureUserTransactionOptions(userIdOf(user));
  return res.json({ token: createToken(user), user: toPublic(user) });
}));

app.get('/api/auth/me', authenticate, asyncRoute(async (req, res) => {
  const user = mongoAvailable()
    ? (validObjectId(req.userId) ? await User.findById(req.userId) : null)
    : memory.users.find((item) => item.id === req.userId);
  if (!user) return res.status(404).json({ message: 'User not found' });
  return res.json(toPublic(user));
}));

app.get('/api/transactions', authenticate, asyncRoute(async (req, res) => {
  let items = await listTransactions(req.userId);
  const { type, category, search, startDate, endDate, sort = 'date', order = 'desc' } = req.query;
  if (type && ['income', 'expense'].includes(type)) items = items.filter((item) => item.type === type);
  if (category) items = items.filter((item) => item.type === 'expense' && item.category.toLowerCase() === String(category).toLowerCase());
  if (search) {
    const query = String(search).toLowerCase();
    items = items.filter((item) => [
      item.type === 'income' ? item.incomeSource || item.category : item.category,
      item.description,
      item.merchant,
    ].some((field) => String(field || '').toLowerCase().includes(query)));
  }
  if (startDate) {
    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) return res.status(400).json({ message: 'startDate is invalid' });
    items = items.filter((item) => new Date(item.date) >= start);
  }
  if (endDate) {
    const end = new Date(endDate);
    if (Number.isNaN(end.getTime())) return res.status(400).json({ message: 'endDate is invalid' });
    items = items.filter((item) => new Date(item.date) <= end);
  }
  if (!['date', 'amount'].includes(sort) || !['asc', 'desc'].includes(order)) {
    return res.status(400).json({ message: 'Invalid sort or order value' });
  }
  items.sort((a, b) => {
    const comparison = sort === 'amount' ? a.amount - b.amount : new Date(a.date) - new Date(b.date);
    return order === 'asc' ? comparison : -comparison;
  });
  return res.json(items);
}));

app.post('/api/transactions', authenticate, asyncRoute(async (req, res) => {
  const error = validateTransaction(req.body || {});
  if (error) return res.status(400).json({ message: error });
  const source = ['manual', 'sms', 'receipt'].includes(req.body.source)
    ? req.body.source
    : 'manual';
  const smsFingerprint = cleanString(req.body.smsFingerprint, 64).toLowerCase();
  if (source === 'sms' && !/^[a-f0-9]{16}$/.test(smsFingerprint)) {
    return res.status(400).json({ message: 'SMS transactions require a valid message fingerprint' });
  }
  if (source === 'sms') {
    const duplicate = mongoAvailable()
      ? await Transaction.exists({ userId: req.userId, source: 'sms', smsFingerprint })
      : memory.transactions.some((item) =>
          item.userId === req.userId &&
          item.source === 'sms' &&
          item.smsFingerprint === smsFingerprint);
    if (duplicate) {
      return res.status(409).json({ message: 'This SMS transaction has already been added' });
    }
  }
  const classification = cleanString(
    req.body.type === 'expense' ? req.body.category : req.body.incomeSource,
    80,
  );
  const classificationExists = mongoAvailable()
    ? req.body.type === 'expense'
      ? await Category.exists({ userId: req.userId, name: classification })
      : await IncomeSource.exists({ userId: req.userId, name: classification })
    : req.body.type === 'expense'
      ? memory.categories.some((item) => item.userId === req.userId && item.name === classification)
      : memory.incomeSources.some((item) => item.userId === req.userId && item.name === classification);
  if (!classificationExists) {
    return res.status(400).json({
      message: req.body.type === 'expense'
        ? 'Select one of your expense categories'
        : 'Select one of your income sources',
    });
  }
  const payload = {
    userId: req.userId, type: req.body.type, amount: Number(req.body.amount),
    category: req.body.type === 'expense' ? classification : '',
    incomeSource: req.body.type === 'income' ? classification : '',
    description: cleanString(req.body.description, 500),
    merchant: cleanString(req.body.merchant, 160), paymentMethod: cleanString(req.body.paymentMethod, 60) || 'Other',
    date: req.body.date ? parseTransactionDate(req.body.date) : new Date(),
    source,
    receiptImage: cleanString(req.body.receiptImage, 1000),
    ...(source === 'sms' ? { smsFingerprint } : {}),
  };
  let created;
  try {
    created = mongoAvailable()
      ? await Transaction.create(payload)
      : { ...payload, id: crypto.randomUUID() };
  } catch (createError) {
    if (createError?.code === 11000 && source === 'sms') {
      return res.status(409).json({ message: 'This SMS transaction has already been added' });
    }
    throw createError;
  }
  if (!mongoAvailable()) memory.transactions.unshift({ ...created });
  return res.status(201).json(toTransaction(created));
}));

app.put('/api/transactions/:id', authenticate, asyncRoute(async (req, res) => {
  const error = validateTransaction(req.body || {});
  if (error) return res.status(400).json({ message: error });
  const classification = cleanString(
    req.body.type === 'expense' ? req.body.category : req.body.incomeSource,
    80,
  );
  const classificationExists = mongoAvailable()
    ? req.body.type === 'expense'
      ? await Category.exists({ userId: req.userId, name: classification })
      : await IncomeSource.exists({ userId: req.userId, name: classification })
    : req.body.type === 'expense'
      ? memory.categories.some((item) => item.userId === req.userId && item.name === classification)
      : memory.incomeSources.some((item) => item.userId === req.userId && item.name === classification);
  if (!classificationExists) {
    return res.status(400).json({
      message: req.body.type === 'expense'
        ? 'Select one of your expense categories'
        : 'Select one of your income sources',
    });
  }
  const patch = {
    type: req.body.type, amount: Number(req.body.amount),
    category: req.body.type === 'expense' ? classification : '',
    incomeSource: req.body.type === 'income' ? classification : '',
    description: cleanString(req.body.description, 500), merchant: cleanString(req.body.merchant, 160),
    paymentMethod: cleanString(req.body.paymentMethod, 60) || 'Other',
    date: parseTransactionDate(req.body.date), source: req.body.source, receiptImage: cleanString(req.body.receiptImage, 1000),
    ...(req.body.smsFingerprint
      ? { smsFingerprint: cleanString(req.body.smsFingerprint, 64).toLowerCase() }
      : {}),
  };
  let updated;
  if (mongoAvailable()) {
    if (!validObjectId(req.params.id)) return res.status(404).json({ message: 'Transaction not found' });
    updated = await Transaction.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, patch, { new: true, runValidators: true });
  } else {
    const item = memory.transactions.find((row) => row.id === req.params.id && row.userId === req.userId);
    if (item) Object.assign(item, patch), updated = item;
  }
  if (!updated) return res.status(404).json({ message: 'Transaction not found' });
  return res.json(toTransaction(updated));
}));

app.delete('/api/transactions/:id', authenticate, asyncRoute(async (req, res) => {
  let deleted;
  if (mongoAvailable()) {
    if (!validObjectId(req.params.id)) return res.status(404).json({ message: 'Transaction not found' });
    deleted = await Transaction.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  } else {
    const index = memory.transactions.findIndex((row) => row.id === req.params.id && row.userId === req.userId);
    if (index !== -1) deleted = memory.transactions.splice(index, 1)[0];
  }
  if (!deleted) return res.status(404).json({ message: 'Transaction not found' });
  return res.json({ message: 'Transaction deleted' });
}));

app.get('/api/categories', authenticate, asyncRoute(async (req, res) => {
  await ensureUserTransactionOptions(req.userId);
  const rows = mongoAvailable()
    ? await Category.find({ userId: req.userId }).sort({ name: 1 })
    : memory.categories.filter((item) => item.userId === req.userId);
  return res.json(orderOptions(rows, defaultExpenseCategories).map(toCategory));
}));

app.get('/api/income-sources', authenticate, asyncRoute(async (req, res) => {
  await ensureUserTransactionOptions(req.userId);
  const rows = mongoAvailable()
    ? await IncomeSource.find({ userId: req.userId }).sort({ name: 1 })
    : memory.incomeSources.filter((item) => item.userId === req.userId);
  return res.json(orderOptions(rows, defaultIncomeSources).map(toIncomeSource));
}));

app.post('/api/categories', authenticate, asyncRoute(async (req, res) => {
  const name = cleanString(req.body?.name, 80);
  if (!name) return res.status(400).json({ message: 'Category name is required' });
  const duplicate = mongoAvailable()
    ? await Category.exists({ userId: req.userId, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
    : memory.categories.some((item) => item.userId === req.userId && item.name.toLowerCase() === name.toLowerCase());
  if (duplicate) return res.status(409).json({ message: 'Category already exists' });
  const payload = { userId: req.userId, name, icon: cleanString(req.body.icon, 40) || 'category', color: cleanString(req.body.color, 20) || '#3B82F6' };
  const created = mongoAvailable() ? await Category.create(payload) : { ...payload, id: crypto.randomUUID() };
  if (!mongoAvailable()) memory.categories.push(created);
  return res.status(201).json(toCategory(created));
}));

app.put('/api/categories/:id', authenticate, asyncRoute(async (req, res) => {
  const name = cleanString(req.body?.name, 80);
  if (!name) return res.status(400).json({ message: 'Category name is required' });
  let updated;
  if (mongoAvailable()) {
    if (!validObjectId(req.params.id)) return res.status(404).json({ message: 'Category not found' });
    const existing = await Category.findOne({ _id: req.params.id, userId: req.userId });
    if (!existing) return res.status(404).json({ message: 'Category not found' });
    if (existing.isDefault) return res.status(403).json({ message: 'Default expense categories cannot be edited' });
    if (existing.name.toLowerCase() !== name.toLowerCase()) {
      const duplicate = await Category.exists({ userId: req.userId, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), _id: { $ne: existing._id } });
      if (duplicate) return res.status(409).json({ message: 'Category already exists' });
      await Promise.all([
        Transaction.updateMany({ userId: req.userId, type: 'expense', category: existing.name }, { $set: { category: name } }),
        Budget.updateMany({ userId: req.userId, category: existing.name }, { $set: { category: name } }),
      ]);
    }
    existing.name = name;
    existing.icon = cleanString(req.body.icon, 40) || 'category';
    existing.color = cleanString(req.body.color, 20) || '#3B82F6';
    updated = await existing.save();
  } else {
    updated = memory.categories.find((item) => item.id === req.params.id && item.userId === req.userId);
    if (updated) {
      const previousName = updated.name;
      if (updated.isDefault) return res.status(403).json({ message: 'Default expense categories cannot be edited' });
      if (previousName.toLowerCase() !== name.toLowerCase()) {
        for (const item of memory.transactions.filter((row) => row.userId === req.userId && row.type === 'expense' && row.category === previousName)) item.category = name;
        for (const item of memory.budgets.filter((row) => row.userId === req.userId && row.category === previousName)) item.category = name;
      }
      Object.assign(updated, { name, icon: req.body.icon || 'category', color: req.body.color || '#3B82F6' });
    }
  }
  if (!updated) return res.status(404).json({ message: 'Category not found' });
  return res.json(toCategory(updated));
}));

app.delete('/api/categories/:id', authenticate, asyncRoute(async (req, res) => {
  let deleted;
  if (mongoAvailable()) {
    if (!validObjectId(req.params.id)) return res.status(404).json({ message: 'Category not found' });
    const category = await Category.findOne({ _id: req.params.id, userId: req.userId });
    if (category?.isDefault) return res.status(403).json({ message: 'Default expense categories cannot be deleted' });
    if (category && (await Transaction.exists({ userId: req.userId, type: 'expense', category: category.name }) || await Budget.exists({ userId: req.userId, category: category.name }))) {
      return res.status(409).json({ message: 'Category is in use by transactions' });
    }
    deleted = category ? await Category.deleteOne({ _id: category._id, userId: req.userId }) : null;
  } else {
    const index = memory.categories.findIndex((item) => item.id === req.params.id && item.userId === req.userId);
    if (index !== -1) {
      if (memory.categories[index].isDefault) return res.status(403).json({ message: 'Default expense categories cannot be deleted' });
      const name = memory.categories[index].name;
      if (memory.transactions.some((item) => item.userId === req.userId && item.type === 'expense' && item.category === name)
        || memory.budgets.some((item) => item.userId === req.userId && item.category === name)) {
        return res.status(409).json({ message: 'Category is in use by transactions' });
      }
      deleted = memory.categories.splice(index, 1)[0];
    }
  }
  if (!deleted) return res.status(404).json({ message: 'Category not found' });
  return res.json({ message: 'Category deleted' });
}));

app.get('/api/budgets', authenticate, asyncRoute(async (req, res) => {
  const rows = mongoAvailable()
    ? await Budget.find({ userId: req.userId }).sort({ month: -1, category: 1 })
    : memory.budgets.filter((item) => item.userId === req.userId);
  const transactions = await listTransactions(req.userId);
  const enriched = rows.map((row) => {
    const budget = toBudget(row);
    return { ...budget, ...calculateBudgetUsage(budget, transactions) };
  });
  return res.json(enriched);
}));

app.post('/api/budgets', authenticate, asyncRoute(async (req, res) => {
  const category = cleanString(req.body?.category, 80);
  const amount = Number(req.body?.amount);
  const month = req.body?.month || new Date().toISOString().slice(0, 7);
  if (!category || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: 'Category and positive amount are required' });
  if (!validMonth(month)) return res.status(400).json({ message: 'Month must use a valid YYYY-MM value' });
  const payload = { userId: req.userId, category, amount, month };
  const created = mongoAvailable() ? await Budget.create(payload) : { ...payload, id: crypto.randomUUID() };
  if (!mongoAvailable()) memory.budgets.push(created);
  return res.status(201).json({ ...toBudget(created), spent: 0, remaining: amount, percentUsed: 0 });
}));

app.put('/api/budgets/:id', authenticate, asyncRoute(async (req, res) => {
  const category = cleanString(req.body?.category, 80);
  const amount = Number(req.body?.amount);
  const month = req.body?.month;
  if (!category || !Number.isFinite(amount) || amount <= 0 || !validMonth(month)) {
    return res.status(400).json({ message: 'Category, positive amount, and YYYY-MM month are required' });
  }
  let updated;
  if (mongoAvailable()) {
    if (!validObjectId(req.params.id)) return res.status(404).json({ message: 'Budget not found' });
    if (await Budget.exists({ userId: req.userId, category, month, _id: { $ne: req.params.id } })) {
      return res.status(409).json({ message: 'A budget already exists for this category and month' });
    }
    updated = await Budget.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { category, amount, month }, { new: true, runValidators: true });
  } else {
    updated = memory.budgets.find((item) => item.id === req.params.id && item.userId === req.userId);
    if (memory.budgets.some((item) => item.userId === req.userId && item.id !== req.params.id && item.category === category && item.month === month)) {
      return res.status(409).json({ message: 'A budget already exists for this category and month' });
    }
    if (updated) Object.assign(updated, { category, amount, month });
  }
  if (!updated) return res.status(404).json({ message: 'Budget not found' });
  return res.json(toBudget(updated));
}));

app.delete('/api/budgets/:id', authenticate, asyncRoute(async (req, res) => {
  let deleted;
  if (mongoAvailable()) {
    if (!validObjectId(req.params.id)) return res.status(404).json({ message: 'Budget not found' });
    deleted = await Budget.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  } else {
    const index = memory.budgets.findIndex((item) => item.id === req.params.id && item.userId === req.userId);
    if (index !== -1) deleted = memory.budgets.splice(index, 1)[0];
  }
  if (!deleted) return res.status(404).json({ message: 'Budget not found' });
  return res.json({ message: 'Budget deleted' });
}));

function currentMonthKey(now = new Date()) {
  return `${now.getFullYear().toString().padStart(4, '0')}-${(now.getMonth() + 1)
    .toString()
    .padStart(2, '0')}`;
}

async function getCurrentUserBudgets(userId, now = new Date()) {
  const month = currentMonthKey(now);
  const rows = mongoAvailable()
    ? await Budget.find({ userId, month })
    : memory.budgets.filter((item) => item.userId === userId && item.month === month);
  return rows.map(toBudget);
}

app.get('/api/analytics/summary', authenticate, asyncRoute(async (req, res) => res.json(summarize(await listTransactions(req.userId)))));
app.get('/api/analytics/monthly', authenticate, asyncRoute(async (req, res) => {
  const items = (await listTransactions(req.userId)).filter((item) => item.type === 'expense');
  const grouped = {};
  for (const item of items) {
    const month = new Date(item.date).toISOString().slice(0, 7);
    grouped[month] = (grouped[month] || 0) + item.amount;
  }
  return res.json(Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, total]) => ({ month, total })));
}));
app.get('/api/analytics/categories', authenticate, asyncRoute(async (req, res) => res.json(summarize(await listTransactions(req.userId)).categoryTotals)));

app.post('/api/ai/insights', authenticate, asyncRoute(async (req, res) => {
  const items = await listTransactions(req.userId);
  const budgets = await getCurrentUserBudgets(req.userId);
  const result = generateFinancialInsights(items, budgets);
  return res.json({
    ...result,
    generatedBy: 'rules',
    message: items.length
      ? ''
      : 'Add transactions to receive personalized insights.',
  });
}));

app.post('/api/ai/chat', authenticate, asyncRoute(async (req, res) => {
  const message = cleanString(req.body?.message, 500);
  if (!message) return res.status(400).json({ message: 'A message is required' });
  const items = await listTransactions(req.userId);
  const budgets = await getCurrentUserBudgets(req.userId);
  return res.json({
    answer: answerFinancialQuestion(message, items, budgets),
    generatedBy: 'rules',
  });
}));

app.use((error, req, res, next) => {
  console.error('API request failed:', error);
  if (res.headersSent) return next(error);
  if (error.code === 11000) return res.status(409).json({ message: 'A record with these details already exists' });
  if (error.name === 'ValidationError' || error.name === 'CastError') return res.status(400).json({ message: error.message });
  return res.status(500).json({ message: 'Internal server error' });
});

async function startServer() {
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: Number(process.env.MONGO_TIMEOUT_MS || 5000) });
    databaseMode = 'mongodb';
    console.log(`MongoDB connected at ${mongoose.connection.name}.`);
  } catch (error) {
    if (isProduction) {
      throw new Error(
        'MongoDB Atlas connection failed; verify MONGODB_URI and Atlas network access.',
      );
    }
    databaseMode = 'memory-fallback';
    console.error(`MongoDB unavailable (${error.message}); starting with temporary in-memory fallback.`);
  }
  mongoose.connection.on('disconnected', () => {
    databaseMode = 'unavailable';
    console.error('MongoDB disconnected after startup; API writes are paused until persistent storage is restored.');
  });
  mongoose.connection.on('connected', () => {
    databaseMode = 'mongodb';
    console.log('MongoDB connection restored.');
  });
  app.listen(port, '0.0.0.0', () =>
    console.log(`TrackYo backend running on http://0.0.0.0:${port}`),
  );
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Unable to start TrackYo backend:', error);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };
