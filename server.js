// server.js
// Local dictionary server for Mechanical Engineering terms
// Backend: Express + CORS + better-sqlite3
// Frontend: served from /public (HTML/CSS/JS) with list, search, audio, and Google search

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Open database
let db;
try {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database file not found at: ${DB_PATH}`);
    process.exit(1);
  }
  db = new Database(DB_PATH, { fileMustExist: true });
} catch (err) {
  console.error('Failed to open database:', err.message);
  process.exit(1);
}

// Discover table/columns: assume first user table and first four columns are [word, meaning, audio, wiki]
function discoverSchema() {
  const tableRow = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 1").get();
  if (!tableRow) throw new Error('No user table found in database');
  const table = tableRow.name;
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all();
  if (!cols || cols.length < 3) {
    throw new Error(`Table "${table}" must have at least 3 columns [word, meaning, audio_url]`);
  }
  const [wordCol, meaningCol, audioCol, wikiCol] = cols.slice(0, 4).map(c => c.name);
  return { table, wordCol, meaningCol, audioCol, wikiCol: wikiCol || null };
}

let META;
try {
  META = discoverSchema();
  // Env overrides for table/columns if provided
  const ENV_TABLE = process.env.DB_TABLE;
  const ENV_WORD = process.env.DB_WORD_COL;
  const ENV_MEANING = process.env.DB_MEANING_COL;
  const ENV_AUDIO = process.env.DB_AUDIO_COL;
  const ENV_WIKI = process.env.DB_WIKI_COL;
  if (ENV_TABLE && ENV_WORD && ENV_MEANING && ENV_AUDIO) {
    META = { table: ENV_TABLE, wordCol: ENV_WORD, meaningCol: ENV_MEANING, audioCol: ENV_AUDIO, wikiCol: ENV_WIKI || null };
  }
  console.log('Using table/columns:', META);
} catch (err) {
  console.error('Schema discovery failed:', err.message);
  process.exit(1);
}

// Prepared statements
const stmtCount = db.prepare(`SELECT COUNT(*) as c FROM "${META.table}"`);
const stmtListWords = db.prepare(`
  SELECT "${META.wordCol}" AS w
  FROM "${META.table}"
  WHERE "${META.wordCol}" IS NOT NULL
  ORDER BY "${META.wordCol}" COLLATE NOCASE ASC
  LIMIT 10000
`);
const stmtSearchWords = db.prepare(`
  SELECT "${META.wordCol}" AS w
  FROM "${META.table}"
  WHERE "${META.wordCol}" LIKE ? ESCAPE '\\'
  ORDER BY "${META.wordCol}" COLLATE NOCASE ASC
  LIMIT 10000
`);
const stmtDetailsAll = db.prepare(`
  SELECT
    "${META.wordCol}"   AS w,
    "${META.meaningCol}" AS m,
    "${META.audioCol}"   AS a
    ${META.wikiCol ? `, "${META.wikiCol}" AS wiki` : ''}
  FROM "${META.table}"
`);
const stmtDetailByWord = db.prepare(`
  SELECT
    "${META.wordCol}"   AS w,
    "${META.meaningCol}" AS m,
    "${META.audioCol}"   AS a
    ${META.wikiCol ? `, "${META.wikiCol}" AS wiki` : ''}
  FROM "${META.table}"
  WHERE "${META.wordCol}" = ?
  LIMIT 1
`);

// Startup diagnostics
try {
  const cnt = stmtCount.get().c;
  console.log(`Row count in ${META.table}:`, cnt);
} catch (e) {
  console.warn('Could not read row count:', e.message);
}

function escapeLike(s) {
  return String(s).replace(/([%_\\])/g, '\\$1');
}

// Data access helpers
function fetchWords(search) {
  if (search) {
    const rows = stmtSearchWords.all(`%${escapeLike(search)}%`);
    const words = rows.map(r => r.w).filter(Boolean);
    words.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    return words;
  } else {
    const rows = stmtListWords.all();
    const words = rows.map(r => r.w).filter(Boolean);
    words.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    return words;
  }
}

function fetchDetailByWord(word) {
  const row = stmtDetailByWord.get(word);
  if (!row) return null;
  return {
    word: row.w,
    meaning: row.m,
    audioUrl: row.a,
    wikiUrl: row.wiki || null,
  };
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Serve whitelisted icons from project root
const ICONS = new Set(['ic1.ico', 'ic2.ico', 'ic3.ico', 'ic4.ico']);
app.get('/icons/:name', (req, res) => {
  const name = req.params.name;
  if (!ICONS.has(name)) return res.status(404).end();
  const filePath = path.join(__dirname, name);
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) return res.status(404).end();
    res.sendFile(filePath);
  });
});

// Routes
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/words', (req, res) => {
  try {
    const q = (req.query.search || '').trim();
    const items = fetchWords(q);
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch words' });
  }
});

app.get('/api/words/:word', (req, res) => {
  try {
    const word = req.params.word;
    const detail = fetchDetailByWord(word);
    if (!detail) return res.status(404).json({ error: 'Word not found' });
    res.json(detail);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch word detail' });
  }
});

// Fallback to index.html for SPA-like behavior (Express 5 safe, exclude /api/*)
app.get(/^\/(?!api\/).*/, (req, res, next) => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  fs.access(indexPath, fs.constants.F_OK, (err) => {
    if (err) return next();
    res.sendFile(indexPath);
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
});