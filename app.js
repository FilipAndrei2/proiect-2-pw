const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const csrf = require('csurf');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs/promises');
const Database = require('better-sqlite3');

const app = express();
const port = 6789;

app.set('view engine', 'ejs');
app.use(expressLayouts);
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.set('trust proxy', 1);

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'schimba-acest-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 2,
    },
  })
);

app.use(csrf());

const db = new Database(path.join(__dirname, 'cumparaturi.db'));

const loginAttemptsByIp = new Map();
const loginAttemptsByUser = new Map();
const blockedIps = new Map();
const notFoundTracker = new Map();

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BASE_COOLDOWN_MS = 15 * 60 * 1000;
const NOT_FOUND_LIMIT = 10;
const NOT_FOUND_WINDOW_MS = 60 * 1000;
const NOT_FOUND_BLOCK_MS = 10 * 60 * 1000;

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Prea multe cereri de autentificare. Reincearca mai tarziu.',
});

function sanitizeUsername(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9._-]{3,20}$/.test(trimmed)) {
    return '';
  }
  return trimmed;
}

function sanitizeText(value, maxLength = 80) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim().replace(/[<>]/g, '');
  if (trimmed.length < 2 || trimmed.length > maxLength) {
    return '';
  }
  return trimmed;
}

function sanitizePrice(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

async function loadJson(fileName) {
  const filePath = path.join(__dirname, fileName);
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

function createProduseTable() {
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS produse (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL
    )
  `
  ).run();
}

const insertProdusStmt = db.prepare(
  'INSERT INTO produse (name, price) VALUES (?, ?)'
);
const selectProduseStmt = db.prepare(
  'SELECT id, name, price FROM produse ORDER BY id'
);

function getProduse() {
  return selectProduseStmt.all();
}

function getProdusById(id) {
  return db
    .prepare('SELECT id, name, price FROM produse WHERE id = ?')
    .get(id);
}

function getProduseByIds(ids) {
  if (!ids.length) {
    return [];
  }
  const placeholders = ids.map(() => '?').join(',');
  return db
    .prepare(`SELECT id, name, price FROM produse WHERE id IN (${placeholders})`)
    .all(...ids);
}

const insertSampleProduse = db.transaction((produse) => {
  for (const produs of produse) {
    insertProdusStmt.run(produs.name, produs.price);
  }
});

createProduseTable();

function getLoginState(map, key, now) {
  const existing = map.get(key);
  if (existing) {
    if (existing.blockedUntil && existing.blockedUntil <= now) {
      existing.blockedUntil = 0;
      existing.count = 0;
      existing.firstAttemptAt = now;
    }
    return existing;
  }
  const fresh = {
    count: 0,
    firstAttemptAt: now,
    blockedUntil: 0,
    cooldownLevel: 0,
  };
  map.set(key, fresh);
  return fresh;
}

function getRemainingBlock(map, key, now) {
  const state = map.get(key);
  if (!state || !state.blockedUntil) {
    return 0;
  }
  if (state.blockedUntil <= now) {
    map.delete(key);
    return 0;
  }
  return state.blockedUntil - now;
}

function isLoginBlocked(ip, username, now) {
  const ipBlocked = getRemainingBlock(loginAttemptsByIp, ip, now);
  const userBlocked = username
    ? getRemainingBlock(loginAttemptsByUser, username, now)
    : 0;
  return Math.max(ipBlocked, userBlocked);
}

function registerFailedLogin(ip, username, now) {
  const ipState = getLoginState(loginAttemptsByIp, ip, now);
  if (now - ipState.firstAttemptAt > LOGIN_WINDOW_MS) {
    ipState.count = 0;
    ipState.firstAttemptAt = now;
  }
  ipState.count += 1;
  if (ipState.count >= LOGIN_MAX_ATTEMPTS) {
    ipState.cooldownLevel += 1;
    ipState.blockedUntil =
      now + LOGIN_BASE_COOLDOWN_MS * Math.pow(2, ipState.cooldownLevel - 1);
    ipState.count = 0;
  }

  if (!username) {
    return;
  }
  const userState = getLoginState(loginAttemptsByUser, username, now);
  if (now - userState.firstAttemptAt > LOGIN_WINDOW_MS) {
    userState.count = 0;
    userState.firstAttemptAt = now;
  }
  userState.count += 1;
  if (userState.count >= LOGIN_MAX_ATTEMPTS) {
    userState.cooldownLevel += 1;
    userState.blockedUntil =
      now + LOGIN_BASE_COOLDOWN_MS * Math.pow(2, userState.cooldownLevel - 1);
    userState.count = 0;
  }
}

function clearLoginState(ip, username) {
  loginAttemptsByIp.delete(ip);
  if (username) {
    loginAttemptsByUser.delete(username);
  }
}

function blockIfNeeded(ip, now) {
  const blockedUntil = blockedIps.get(ip);
  if (!blockedUntil) {
    return false;
  }
  if (blockedUntil <= now) {
    blockedIps.delete(ip);
    return false;
  }
  return true;
}

function registerNotFound(ip, now) {
  const current = notFoundTracker.get(ip);
  if (!current || now - current.firstSeen > NOT_FOUND_WINDOW_MS) {
    notFoundTracker.set(ip, { count: 1, firstSeen: now });
    return;
  }
  current.count += 1;
  if (current.count >= NOT_FOUND_LIMIT) {
    blockedIps.set(ip, now + NOT_FOUND_BLOCK_MS);
    notFoundTracker.delete(ip);
  }
}

app.use((req, res, next) => {
  const now = Date.now();
  if (blockIfNeeded(req.ip, now)) {
    return res
      .status(429)
      .send('Acces blocat temporar din cauza prea multor cereri.');
  }
  next();
});

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.isAuthenticated = Boolean(req.session.user);
  res.locals.cartCount = Array.isArray(req.session.cart)
    ? req.session.cart.length
    : 0;
  res.locals.usernameCookie = req.cookies.username || null;
  if (typeof req.csrfToken === 'function') {
    try {
      res.locals.csrfToken = req.csrfToken();
    } catch (error) {
      res.locals.csrfToken = null;
    }
  }
  next();
});

app.get('/', (req, res) => {
  res.render('index', { produse: getProduse() });
});

app.get('/chestionar', async (req, res) => {
  try {
    const intrebari = await loadJson('intrebari.json');
    res.render('chestionar', { intrebari });
  } catch (error) {
    res.status(500).send('Nu am putut incarca intrebarile.');
  }
});

app.post('/rezultat-chestionar', async (req, res) => {
  try {
    const intrebari = await loadJson('intrebari.json');
    let corecte = 0;
    intrebari.forEach((intrebare, index) => {
      const raspuns = Number(req.body[`q${index}`]);
      if (Number.isInteger(raspuns) && raspuns === intrebare.corect) {
        corecte += 1;
      }
    });
    res.render('rezultat-chestionar', {
      corecte,
      total: intrebari.length,
    });
  } catch (error) {
    res.status(500).send('Nu am putut procesa chestionarul.');
  }
});

app.get('/autentificare', (req, res) => {
  const now = Date.now();
  const blockedMs = getRemainingBlock(loginAttemptsByIp, req.ip, now);
  const errorMessage = req.cookies.mesajEroare || null;
  res.clearCookie('mesajEroare');
  res.render('autentificare', {
    errorMessage,
    blockedMs,
  });
});

app.post('/verificare-autentificare', loginRateLimiter, async (req, res) => {
  const now = Date.now();
  const username = sanitizeUsername(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const blockedMs = isLoginBlocked(req.ip, username, now);
  if (blockedMs) {
    return res.status(429).render('autentificare', {
      errorMessage: `Prea multe incercari nereusite. Incearca peste ${Math.ceil(
        blockedMs / 60000
      )} minute.`,
      blockedMs,
    });
  }

  if (!username || !password) {
    registerFailedLogin(req.ip, username, now);
    res.cookie('mesajEroare', 'Date de autentificare invalide.', {
      httpOnly: true,
    });
    return res.redirect('/autentificare');
  }

  try {
    const users = await loadJson('utilizatori.json');
    const user = users.find((entry) => entry.username === username);
    if (!user) {
      registerFailedLogin(req.ip, username, now);
      res.cookie('mesajEroare', 'Utilizator sau parola incorecte.', {
        httpOnly: true,
      });
      return res.redirect('/autentificare');
    }

    const match = await bcrypt.compare(password, user.parola_hash);
    if (!match) {
      registerFailedLogin(req.ip, username, now);
      res.cookie('mesajEroare', 'Utilizator sau parola incorecte.', {
        httpOnly: true,
      });
      return res.redirect('/autentificare');
    }

    clearLoginState(req.ip, username);
    res.cookie('username', username, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });
    res.clearCookie('mesajEroare');
    req.session.user = {
      username: user.username,
      role: user.role,
      nume: user.nume,
      prenume: user.prenume,
    };
    return res.redirect('/');
  } catch (error) {
    return res.status(500).send('Autentificarea a esuat.');
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('username');
    res.redirect('/');
  });
});

app.post('/creare-bd', (req, res) => {
  createProduseTable();
  res.redirect('/');
});

app.post('/inserare-bd', (req, res) => {
  createProduseTable();
  const sample = [
    { name: 'Baterie auto Li-Ion 60Ah', price: 799.99 },
    { name: 'Incarcator portabil 11kW', price: 1299.5 },
    { name: 'Anvelope all-season 205/55 R16', price: 399.99 },
    { name: 'Kit intretinere detailing', price: 159.9 },
  ];
  insertSampleProduse(sample);
  res.redirect('/');
});

app.post('/adaugare-cos', (req, res) => {
  if (!req.session.user) {
    return res.status(403).send('Trebuie sa fii autentificat.');
  }
  const id = Number(req.body.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('Produs invalid.');
  }
  const produs = getProdusById(id);
  if (!produs) {
    return res.status(404).send('Produs inexistent.');
  }
  if (!Array.isArray(req.session.cart)) {
    req.session.cart = [];
  }
  req.session.cart.push(id);
  res.redirect('/vizualizare-cos');
});

app.get('/vizualizare-cos', (req, res) => {
  const cartIds = Array.isArray(req.session.cart) ? req.session.cart : [];
  const produseMap = new Map(
    getProduseByIds(cartIds).map((produs) => [produs.id, produs])
  );
  const produse = cartIds
    .map((id) => produseMap.get(id))
    .filter((produs) => produs);
  res.render('vizualizare-cos', { produse });
});

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'ADMIN') {
    return res.status(403).render('mesaj', {
      title: 'Acces interzis',
      message: 'Nu aveti drepturi pentru aceasta resursa.',
    });
  }
  next();
}

app.get('/admin', requireAdmin, (req, res) => {
  res.render('admin');
});

app.post('/admin/adaugare-produs', requireAdmin, (req, res) => {
  const name = sanitizeText(req.body.name);
  const price = sanitizePrice(req.body.price);
  if (!name || price == null) {
    return res.status(400).render('mesaj', {
      title: 'Date invalide',
      message: 'Numele sau pretul produsului nu sunt valide.',
    });
  }
  insertProdusStmt.run(name, price);
  res.redirect('/');
});

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('mesaj', {
      title: 'Cerere invalida',
      message: 'Token CSRF invalid. Reincarca pagina si incearca din nou.',
    });
  }
  return next(err);
});

app.use((req, res) => {
  registerNotFound(req.ip, Date.now());
  res.status(404).render('mesaj', {
    title: 'Pagina inexistenta',
    message: 'Resursa solicitata nu exista.',
  });
});

app.listen(port, () => {
  console.log(`Serverul ruleaza pe http://localhost:${port}`);
});
