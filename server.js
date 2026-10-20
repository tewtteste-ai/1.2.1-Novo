import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import connectPgSimple from 'connect-pg-simple';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';
import pg from 'pg';
import {
  allRoomGenres,
  buildRoomAssignments
} from './lib/room-schedule.js';
import { roomSessionState } from './lib/room-session.js';
import { localDateKey, localDateTimeToUtc, nextScheduleBase } from './lib/schedule-time.js';
import {
  normalizeCalendarEntries,
  normalizeCatalogItems,
} from './lib/catalog.js';
import {
  buildPipocaEmbedUrl,
  parsePipocaIdList,
  validatePipocaContent
} from './lib/pipoca-cine.js';
import { buildMyEmbedMovieUrl, buildMyEmbedSeriesUrl } from './lib/myembed.js';
import {
  normalizeUsername,
  validBcryptPassword,
  validPassword,
  validPositiveId,
  validUsername
} from './lib/validation.js';
import { Server } from 'socket.io';

const { Pool } = pg;
const root = path.dirname(fileURLToPath(import.meta.url));
const appTimezone = process.env.APP_TIMEZONE || 'UTC';
new Intl.DateTimeFormat('en-US', { timeZone: appTimezone });
const required = ['DATABASE_URL', 'SESSION_SECRET'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
if (process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters long.');
}
if (Boolean(process.env.ADMIN_USERNAME) !== Boolean(process.env.ADMIN_PASSWORD)) {
  throw new Error('Set both ADMIN_USERNAME and ADMIN_PASSWORD to bootstrap the admin.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
  max: Number(process.env.PG_POOL_MAX || 10),
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000
});
pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error:', error.message));
let io;
function disconnectUserSockets(userId) {
  for (const socket of io?.sockets.sockets.values() || []) {
    if (socket.data.user?.id === String(userId)) socket.disconnect(true);
  }
}
const dummyPasswordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);

async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const directory = path.join(root, 'migrations');
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  for (const filename of files) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [738291]);
      const applied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [filename]
      );
      if (!applied.rowCount) {
        await client.query(await readFile(path.join(directory, filename), 'utf8'));
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

const publicUser = (user) => ({
  id: String(user.id),
  username: user.username,
  role: user.role
});

async function audit(eventType, actorId = null, details = {}) {
  await pool.query(
    'INSERT INTO audit_events (actor_id, event_type, details) VALUES ($1, $2, $3)',
    [actorId, eventType, details]
  );
}

async function bootstrapAdmin() {
  if (!process.env.ADMIN_USERNAME) return;
  const username = process.env.ADMIN_USERNAME.trim();
  if (!validUsername(username) || !validPassword(process.env.ADMIN_PASSWORD)) {
    throw new Error('Admin username must be 3-24 letters, digits, or underscores; password must have 12 characters and fit bcrypt’s 72-byte limit.');
  }
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [912348]);
    const existing = await client.query("SELECT username_normalized FROM users WHERE role = 'admin' FOR UPDATE");
    if (existing.rowCount) {
      if (existing.rows[0].username_normalized !== normalizeUsername(username)) {
        throw new Error('An administrator already exists with a different username; refusing to create another.');
      }
    } else {
      await client.query(
        `INSERT INTO users (username, username_normalized, password_hash, role)
         VALUES ($1, $2, $3, 'admin')`,
        [username, normalizeUsername(username), hash]
      );
      await client.query(
        "INSERT INTO audit_events (event_type, details) VALUES ('admin.provisioned', $1)",
        [{ username: normalizeUsername(username) }]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.socket.io'],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https://image.tmdb.org'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      frameSrc: ["'self'", 'https://pipocacine.online', 'https://myembed.biz'],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'fullscreen=(self "https://pipocacine.online" "https://myembed.biz")');
  next();
});
app.use(express.json({ limit: '20kb' }));
const PgSession = connectPgSimple(session);
const sessionMiddleware = session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  name: 'cinemix.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
});
app.use(sessionMiddleware);
app.use(express.static(path.join(root, 'public'), { index: 'index.html', maxAge: '1h' }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' }
});
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Limite de cadastros atingido. Tente novamente mais tarde.' }
});
const catalogLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas consultas ao catálogo. Aguarde um pouco e tente novamente.' }
});

function requireCsrf(req, res, next) {
  if (!req.session.csrfToken || req.get('x-csrf-token') !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Sessão expirada. Atualize a página e tente novamente.' });
  }
  next();
}
function requireAuth(req, res, next) {
  const sessionUser = req.session.user;
  if (!sessionUser?.id) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  pool.query(
    'SELECT id, username, role FROM users WHERE id = $1 AND is_active = TRUE',
    [sessionUser.id]
  ).then(({ rows }) => {
    const user = rows[0];
    if (!user) {
      return destroySession(req).then(() => {
        clearSessionCookie(res);
        res.status(401).json({ error: 'Sua sessão não é mais válida. Entre novamente.' });
      });
    }
    req.session.user = publicUser(user);
    next();
  }).catch(next);
}
function requireAdmin(req, res, next) {
  if (req.session.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  }
  next();
}
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
}));
app.get('/api/csrf', (req, res) => {
  req.session.csrfToken ||= randomBytes(32).toString('hex');
  res.json({ csrfToken: req.session.csrfToken });
});

function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
}
function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
}
function destroySession(req) {
  return new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
}
function clearSessionCookie(res) {
  res.clearCookie('cinemix.sid', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });
}
async function authenticate(req, user) {
  await regenerateSession(req);
  req.session.user = publicUser(user);
  req.session.csrfToken = randomBytes(32).toString('hex');
  await saveSession(req);
}

app.get('/api/auth/me', asyncRoute(async (req, res) => {
  const sessionUser = req.session.user;
  if (!sessionUser?.id) return res.json({ user: null });
  const { rows } = await pool.query(
    'SELECT id, username, role FROM users WHERE id = $1 AND is_active = TRUE',
    [sessionUser.id]
  );
  if (!rows[0]) {
    await destroySession(req);
    clearSessionCookie(res);
    return res.json({ user: null });
  }
  req.session.user = publicUser(rows[0]);
  res.json({ user: req.session.user });
}));

app.post('/api/auth/register', signupLimiter, requireCsrf, asyncRoute(async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = req.body.password;
  if (!validUsername(username) || !validPassword(password)) {
    return res.status(400).json({
      error: 'Use um nome com 3 a 24 letras, números ou _ e uma senha com pelo menos 12 caracteres (limite de 72 bytes UTF-8).'
    });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  let result;
  try {
    result = await pool.query(
      `INSERT INTO users (username, username_normalized, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, role`,
      [username, normalizeUsername(username), passwordHash]
    );
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Esse nome de usuário já existe' });
    throw error;
  }
  const user = result.rows[0];
  await audit('account.registered', user.id);
  await authenticate(req, user);
  res.status(201).json({ user: publicUser(user) });
}));

app.post('/api/auth/login', loginLimiter, requireCsrf, asyncRoute(async (req, res) => {
  const username = typeof req.body.username === 'string' ? normalizeUsername(req.body.username) : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const { rows } = await pool.query(
    'SELECT id, username, username_normalized, password_hash, role, is_active FROM users WHERE username_normalized = $1',
    [username]
  );
  const user = rows[0];
  const passwordFits = Buffer.byteLength(password, 'utf8') <= 72;
  const matches = await bcrypt.compare(
    passwordFits ? password : '',
    user && passwordFits ? user.password_hash : dummyPasswordHash
  ) && Boolean(user && passwordFits && user.is_active);
  if (!matches) {
    await audit('auth.login_failed', null, { username });
    return res.status(401).json({ error: 'Nome de usuário ou senha incorretos.' });
  }
  await audit('auth.login_succeeded', user.id);
  await authenticate(req, user);
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', requireCsrf, asyncRoute(async (req, res) => {
  const userId = req.session.user?.id;
  if (userId) await audit('auth.logout', userId);
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: 'Não foi possível encerrar a sessão.' });
    clearSessionCookie(res);
    res.json({ success: true });
  });
}));

function tmdbAccessToken() {
  return process.env.TMDB_ACCESS_TOKEN || process.env.TMDB_TOKEN;
}
function tmdbConfiguration() {
  if (!tmdbAccessToken() && !process.env.TMDB_API_KEY) {
    const error = new Error('O catálogo está indisponível: o servidor ainda não está configurado com uma credencial TMDb.');
    error.status = 503;
    throw error;
  }
}
async function tmdb(endpoint, params = {}) {
  tmdbConfiguration();
  const accessToken = tmdbAccessToken();
  const url = new URL(`https://api.themoviedb.org/3/${endpoint.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  if (!accessToken) url.searchParams.set('api_key', process.env.TMDB_API_KEY);
  let response;
  try {
    response = await fetch(url, {
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
        : { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
  } catch (cause) {
    console.error('TMDb request unavailable:', endpoint, cause.name);
    const error = new Error('O serviço de catálogo está temporariamente indisponível.');
    error.status = 503;
    throw error;
  }
  if ((response.status === 401 || response.status === 403) && accessToken && process.env.TMDB_API_KEY) {
    try {
      const fallbackUrl = new URL(url);
      fallbackUrl.searchParams.set('api_key', process.env.TMDB_API_KEY);
      response = await fetch(fallbackUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
    } catch (cause) {
      console.error('TMDb API key fallback unavailable:', endpoint, cause.name);
      const error = new Error('O serviço de catálogo está temporariamente indisponível.');
      error.status = 503;
      throw error;
    }
  }
  if (!response.ok) {
    const error = new Error(response.status === 401 || response.status === 403
      ? 'A credencial TMDb foi recusada.'
      : 'O serviço de catálogo está temporariamente indisponível.');
    error.status = response.status === 401 || response.status === 403 ? 502 : 503;
    console.error('TMDb request failed:', response.status, endpoint);
    throw error;
  }
  try {
    return await response.json();
  } catch {
    console.error('TMDb returned invalid JSON:', endpoint);
    const error = new Error('O TMDb retornou uma resposta inválida.');
    error.status = 502;
    throw error;
  }
}

const pipocaBaseUrl = 'https://pipocacine.online';
const pipocaIdsCache = new Map();
const pipocaIdsRequests = new Map();
const tmdbGenresCache = new Map();
const calendarCache = { entries: null, expiresAt: 0 };

async function pipocaIds(mediaType) {
  const cached = pipocaIdsCache.get(mediaType);
  if (cached && cached.expiresAt > Date.now()) return cached.ids;
  if (pipocaIdsRequests.has(mediaType)) return pipocaIdsRequests.get(mediaType);

  const endpoint = mediaType === 'movie' ? '/api/list-ids-movies' : '/api/list-ids-series';
  const request = (async () => {
    let response;
    try {
      response = await fetch(`${pipocaBaseUrl}${endpoint}`, {
        headers: { Accept: 'application/json, text/plain' },
        signal: AbortSignal.timeout(10_000)
      });
    } catch (cause) {
      console.error('Pipoca Cine ID list unavailable:', endpoint, cause.name);
      const error = new Error('Não foi possível consultar a disponibilidade no Pipoca Cine.');
      error.status = 503;
      error.availabilityUnavailable = true;
      throw error;
    }
    if (!response.ok) {
      console.error('Pipoca Cine ID list failed:', response.status, endpoint);
      const error = new Error('A lista de disponibilidade do Pipoca Cine está indisponível.');
      error.status = response.status === 429 ? 503 : 502;
      error.availabilityUnavailable = true;
      throw error;
    }
    let ids;
    try {
      ids = parsePipocaIdList(await response.text());
    } catch (cause) {
      console.error('Pipoca Cine ID list invalid:', endpoint, cause.message);
      const error = new Error('A lista de disponibilidade do Pipoca Cine tem um formato inválido.');
      error.status = 502;
      throw error;
    }
    pipocaIdsCache.set(mediaType, { ids, expiresAt: Date.now() + 5 * 60_000 });
    return ids;
  })();
  pipocaIdsRequests.set(mediaType, request);
  try {
    return await request;
  } finally {
    pipocaIdsRequests.delete(mediaType);
  }
}

async function tmdbGenres(mediaType) {
  const cached = tmdbGenresCache.get(mediaType);
  if (cached && cached.expiresAt > Date.now()) return cached.genres;
  const payload = await tmdb(`genre/${mediaType}/list`, { language: 'pt-BR' });
  const genres = (payload.genres || []).filter((genre) =>
    Number.isSafeInteger(Number(genre.id)) && typeof genre.name === 'string'
  );
  tmdbGenresCache.set(mediaType, { genres, expiresAt: Date.now() + 60 * 60_000 });
  return genres;
}

function slugify(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function tmdbGenreId(mediaType, slug) {
  if (!slug) return '';
  const genres = await tmdbGenres(mediaType);
  const genre = genres.find((entry) => slugify(entry.name) === slug);
  if (!genre) {
    const error = new Error('O gênero selecionado não existe no catálogo TMDb.');
    error.status = 400;
    throw error;
  }
  return String(genre.id);
}

async function fetchPipocaContent(tmdbId, expectedType) {
  const url = `${pipocaBaseUrl}/api/embed/${encodeURIComponent(tmdbId)}`;
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000)
    });
  } catch (cause) {
    console.error('Pipoca Cine content lookup unavailable:', cause.name);
    const error = new Error('O serviço de reprodução está temporariamente indisponível.');
    error.status = 503;
    throw error;
  }
  if (!response.ok) {
    console.error('Pipoca Cine content lookup failed:', response.status, '/api/embed/:id');
    const error = new Error(response.status === 404
      ? 'Este título não está disponível para reprodução.'
      : 'Não foi possível confirmar a disponibilidade do título no Pipoca Cine.');
    error.status = response.status === 404 ? 404 : response.status === 429 ? 503 : 502;
    throw error;
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error('O Pipoca Cine retornou uma resposta de conteúdo inválida.');
    error.status = 502;
    throw error;
  }
  try {
    return validatePipocaContent(payload, tmdbId, expectedType);
  } catch (cause) {
    console.error('Pipoca Cine content response rejected:', cause.message);
    const error = new Error('A resposta do Pipoca Cine não corresponde ao título selecionado.');
    error.status = 502;
    throw error;
  }
}

function catalogPageNumber(value) {
  const page = Number(value || 1);
  return Number.isInteger(page) && page >= 1 && page <= 500 ? page : null;
}

app.use('/api/catalog', requireAuth, catalogLimiter);
app.use('/api/search', requireAuth, catalogLimiter);
app.use('/api/calendar', requireAuth, catalogLimiter);
app.use('/api/player', requireAuth, catalogLimiter);

app.get('/api/catalog/genres', asyncRoute(async (req, res) => {
  const mediaType = { movies: 'movie', movie: 'movie', series: 'tv', tv: 'tv' }[
    String(req.query.category || 'movies')
  ];
  if (!mediaType) return res.status(400).json({ error: 'Categoria inválida.' });
  const genres = await tmdbGenres(mediaType);
  res.json({
    genres: genres.map(({ id, name }) => ({ id, name, slug: slugify(name) }))
  });
}));

app.get('/api/search', asyncRoute(async (req, res) => {
  const query = typeof req.query.q === 'string'
    ? req.query.q.trim()
    : typeof req.query.query === 'string' ? req.query.query.trim() : '';
  const page = catalogPageNumber(req.query.page);
  if (query.length < 1 || query.length > 100) return res.status(400).json({ error: 'Informe um título com até 100 caracteres.' });
  if (!page) return res.status(400).json({ error: 'Página inválida.' });
  const payload = await tmdb('search/multi', {
    query, page, include_adult: false, language: 'pt-BR'
  });
  const results = normalizeCatalogItems((payload.results || []).filter((item) =>
    item.media_type === 'movie' || item.media_type === 'tv'
  ));
  res.json({
    page,
    total_pages: Math.min(Number(payload.total_pages) || 1, 500),
    total_results: results.length,
    has_more: page < Math.min(Number(payload.total_pages) || 1, 500),
    results
  });
}));

app.get('/api/calendar', asyncRoute(async (req, res) => {
  const tmdbId = typeof req.query.tmdb_id === 'string' ? req.query.tmdb_id : '';
  if (tmdbId && !validPositiveId(tmdbId)) return res.status(400).json({ error: 'ID TMDb inválido.' });
  if (!calendarCache.entries || calendarCache.expiresAt <= Date.now()) {
    const payload = await tmdb('tv/on_the_air', { language: 'pt-BR', page: 1 });
    const entries = (payload.results || []).filter((item) =>
      item.next_episode_to_air || item.latest_episode_to_air
    ).map((item) => ({
      title: item.name,
      tmdb_id: String(item.id),
      season: (item.next_episode_to_air || item.latest_episode_to_air).season_number,
      number: (item.next_episode_to_air || item.latest_episode_to_air).episode_number,
      episode_title: (item.next_episode_to_air || item.latest_episode_to_air).name,
      air_date: (item.next_episode_to_air || item.latest_episode_to_air).air_date,
      poster: item.poster_path,
      status: item.status || 'Lançado'
    }));
    calendarCache.entries = normalizeCalendarEntries(entries);
    calendarCache.expiresAt = Date.now() + 5 * 60_000;
  }
  res.json({
    entries: tmdbId
      ? calendarCache.entries.filter((entry) => entry.tmdb_id === tmdbId)
      : calendarCache.entries
  });
}));

app.get('/api/catalog/:type', asyncRoute(async (req, res) => {
  const mediaType = { movies: 'movie', movie: 'movie', series: 'tv', tv: 'tv' }[req.params.type];
  if (!mediaType) return res.status(400).json({ error: 'Categoria inválida.' });
  const page = catalogPageNumber(req.query.page);
  if (!page) return res.status(400).json({ error: 'Página inválida.' });
  const genre = typeof req.query.genre === 'string' ? req.query.genre.trim().toLowerCase() : '';
  if (genre && !/^[a-z0-9-]{1,60}$/.test(genre)) {
    return res.status(400).json({ error: 'Gênero inválido.' });
  }
  const genreId = await tmdbGenreId(mediaType, genre);
  const payload = await tmdb(`discover/${mediaType}`, {
    page,
    language: 'pt-BR',
    sort_by: 'popularity.desc',
    include_adult: false,
    with_genres: genreId
  });
  const results = normalizeCatalogItems(payload.results || [], mediaType);
  const totalPages = Math.min(Number(payload.total_pages) || 1, 500);
  res.json({
    page,
    total_pages: totalPages,
    total_results: results.length,
    has_more: page < totalPages,
    results
  });
}));

app.get('/api/player/:type/:tmdbId', asyncRoute(async (req, res) => {
  const { type, tmdbId } = req.params;
  if (!['movie', 'tv'].includes(type) || !validPositiveId(tmdbId)) {
    return res.status(400).json({ error: 'Tipo de conteúdo ou ID TMDb inválido.' });
  }
  const provider = req.query.provider ?? 'pipoca';
  if (typeof provider !== 'string' || !['pipoca', 'myembed'].includes(provider)) {
    return res.status(400).json({ error: 'Player inválido para este conteúdo.' });
  }
  let season;
  let episode;
  if (type === 'tv') {
    season = req.query.season;
    episode = req.query.episode;
    const hasSeason = season !== undefined;
    const hasEpisode = episode !== undefined;
    if (provider === 'pipoca' &&
        (typeof season !== 'string' || !/^\d{1,3}$/.test(season) ||
         typeof episode !== 'string' || !/^[1-9]\d{0,3}$/.test(episode))) {
      return res.status(400).json({ error: 'Informe uma temporada e um episódio válidos.' });
    }
    if (provider === 'myembed' &&
        ((hasSeason || hasEpisode) &&
         (typeof season !== 'string' || !/^\d{1,3}$/.test(season) ||
          typeof episode !== 'string' || !/^[1-9]\d{0,3}$/.test(episode)))) {
      return res.status(400).json({ error: 'Informe uma temporada e um episódio válidos.' });
    }
  } else if (req.query.season !== undefined || req.query.episode !== undefined) {
    return res.status(400).json({ error: 'Temporada e episódio não são aplicáveis a filmes.' });
  }

  if (provider === 'myembed') {
    return res.json({
      title: '',
      tmdb_id: tmdbId,
      type,
      provider,
      embed_url: type === 'movie'
        ? buildMyEmbedMovieUrl(tmdbId)
        : buildMyEmbedSeriesUrl(tmdbId, season, episode)
    });
  }

  const availableIds = await pipocaIds(type);
  if (!availableIds.has(tmdbId)) {
    return res.status(404).json({ error: 'Este título não está disponível para reprodução.' });
  }
  const content = type === 'movie'
    ? await fetchPipocaContent(tmdbId, type)
    : { id: tmdbId, type: 'tv', title: '' };
  const embedUrl = buildPipocaEmbedUrl(tmdbId, type, season, episode);
  res.json({
    title: content.title,
    tmdb_id: content.id,
    type: content.type,
    provider,
    embed_url: embedUrl
  });
}));

async function updateRoomLifecycle() {
  await pool.query(
    "DELETE FROM room_participants WHERE last_seen_at < NOW() - INTERVAL '2 minutes'"
  );
  const ended = await pool.query(
    `WITH expired AS (
       UPDATE rooms SET status = 'ended'
       WHERE status IN ('scheduled', 'waiting') AND ends_at <= NOW()
       RETURNING id
     ), logged AS (
       INSERT INTO audit_events (event_type, details)
       SELECT 'room.ended', jsonb_build_object('roomId', id::text) FROM expired
       RETURNING details->>'roomId' AS room_id
     )
     SELECT room_id FROM logged`
  );
  for (const room of ended.rows) io?.to(`room:${room.room_id}`).emit('room:ended');
  await pool.query(
    `UPDATE rooms SET status = 'waiting'
     WHERE status = 'scheduled' AND starts_at <= NOW() AND ends_at > NOW()`
  );
}

const movieRuntimeCache = new Map();
const estimatedMovieRuntimeSeconds = 170 * 60;
const roomGraceSeconds = 10 * 60;

async function movieRuntime(movieId) {
  if (movieRuntimeCache.has(String(movieId))) return movieRuntimeCache.get(String(movieId));
  const details = await tmdb(`movie/${encodeURIComponent(movieId)}`, { language: 'pt-BR' });
  const minutes = Number(details.runtime);
  const runtime = Number.isInteger(minutes) && minutes > 0
    ? { seconds: minutes * 60, estimated: false }
    : { seconds: estimatedMovieRuntimeSeconds, estimated: true };
  movieRuntimeCache.set(String(movieId), runtime);
  return runtime;
}

async function availableMoviesForRoomGenre(genre) {
  const genreIds = {
    terror: 27,
    acao: 28,
    comedia: 35,
    drama: 18,
    'ficcao-cientifica': 878,
    animacao: 16,
    suspense: 53,
    aventura: 12,
    fantasia: 14,
    familia: 10751,
    'terror-misterio': [27, 9648]
  };
  const genreId = genreIds[genre.id];
  if (!genreId) throw new Error(`No TMDb genre mapping exists for ${genre.name}.`);
  const ids = await pipocaIds('movie');
  for (let page = 1; page <= 10; page += 1) {
    const payload = await tmdb('discover/movie', {
      with_genres: genreId,
      page,
      sort_by: 'popularity.desc',
      include_adult: false,
      language: 'pt-BR'
    });
    const matches = normalizeCatalogItems((payload.results || []).filter((item) =>
      ids.has(String(item.id))
    ), 'movie');
    if (matches.length) return matches;
    if (page >= Number(payload.total_pages || 1)) break;
  }
  return [];
}

async function ensurePublicSchedule() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [194002]);
    const base = nextScheduleBase(new Date(), appTimezone);
    const date = localDateKey(base, appTimezone);
    const existing = await client.query(
      'SELECT COUNT(*)::int AS count FROM rooms WHERE room_type = $1 AND schedule_date = $2',
      ['public', date]
    );
    const count = existing.rows[0].count;
    if (count === 42) {
      await client.query('COMMIT');
      return;
    }
    if (count !== 0 && count !== 32) {
      await client.query('ROLLBACK');
      throw new Error('A partial public schedule exists; it will not be silently replaced.');
    }
    const genres = [...new Map(allRoomGenres.map((genre) => [genre.id, genre])).values()];
    const responses = await Promise.all(genres.map((genre) => availableMoviesForRoomGenre(genre)));
    const resultsByGenre = Object.fromEntries(genres.map((genre, index) => [genre.id, responses[index]]));
    if (!resultsByGenre.familia?.length) {
      resultsByGenre.familia = [...(resultsByGenre.animacao || []), ...(resultsByGenre.comedia || [])];
    }
    if (!resultsByGenre['terror-misterio']?.length) {
      resultsByGenre['terror-misterio'] = resultsByGenre.terror || [];
    }
    const assignments = buildRoomAssignments(resultsByGenre, date);
    if (assignments.length !== 42) throw new Error('The public schedule did not produce exactly 42 rooms.');
    const firstSlot = count;
    const movieIds = [...new Set(assignments.slice(firstSlot).map(({ movie }) => String(movie.id)))];
    const runtimes = new Map();
    for (let offset = 0; offset < movieIds.length; offset += 8) {
      const batch = await Promise.all(movieIds.slice(offset, offset + 8).map(async (movieId) => [
        movieId, await movieRuntime(movieId)
      ]));
      for (const [movieId, runtime] of batch) runtimes.set(movieId, runtime);
    }
    for (let index = firstSlot; index < assignments.length; index += 1) {
      const { genre, movie, startsAtMinute } = assignments[index];
      const startsAt = startsAtMinute === null
        ? new Date(base.getTime() + index * 30 * 60 * 1000)
        : localDateTimeToUtc(date, Math.floor(startsAtMinute / 60), startsAtMinute % 60, appTimezone);
      const runtime = runtimes.get(String(movie.id));
      const endsAt = new Date(startsAt.getTime() + (runtime.seconds + roomGraceSeconds) * 1000);
      await client.query(
        `INSERT INTO rooms
          (room_type, slot_number, schedule_date, genre, movie_id, movie_title, poster_path,
           starts_at, ends_at, duration_seconds, duration_is_estimate)
         VALUES ('public', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [index + 1, date, genre, movie.id, movie.title, movie.poster_path, startsAt, endsAt,
          runtime.seconds, runtime.estimated]
      );
    }
    await client.query(
      `INSERT INTO audit_events (event_type, details)
       VALUES ('public_schedule.created', $1)`,
      [{ date, roomCount: 42, addedRooms: 42 - count }]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function roomRows(where = '', values = []) {
  return pool.query(
    `SELECT r.id, r.room_type, r.slot_number, r.genre, r.movie_id, r.movie_title,
            r.poster_path, r.status, r.starts_at, r.ends_at, r.duration_seconds,
            r.duration_is_estimate, r.capacity,
            CASE
              WHEN r.status IN ('cancelled', 'failed') THEN r.status
              WHEN r.status = 'ended' THEN 'ended'
              WHEN NOW() < r.starts_at THEN 'scheduled'
              WHEN NOW() >= r.ends_at THEN 'ended'
              WHEN NOW() >= r.starts_at + r.duration_seconds * INTERVAL '1 second' THEN 'finished'
              ELSE 'playing'
            END AS session_state,
            u.id AS creator_id, u.username AS creator,
            COUNT(p.user_id) FILTER (WHERE p.last_seen_at > NOW() - INTERVAL '2 minutes')::int AS participants
     FROM rooms r
     LEFT JOIN users u ON u.id = r.creator_id
     LEFT JOIN room_participants p ON p.room_id = r.id
     ${where}
     GROUP BY r.id, u.id, u.username
     ORDER BY r.starts_at ASC`,
    values
  );
}

app.get('/api/rooms', requireAuth, asyncRoute(async (req, res) => {
  await updateRoomLifecycle();
  const type = req.query.type === 'private' ? 'private' : 'public';
  if (type === 'public') await ensurePublicSchedule();
  const where = type === 'public'
    ? "WHERE r.room_type = 'public' AND (r.schedule_date = $1 OR (r.schedule_date < $1 AND r.ends_at > NOW()))"
    : "WHERE r.room_type = 'private' AND r.status IN ('scheduled', 'waiting', 'playing')";
  const values = type === 'public' ? [localDateKey(nextScheduleBase(new Date(), appTimezone), appTimezone)] : [];
  const result = await roomRows(where, values);
  res.json({ rooms: result.rows, timezone: process.env.APP_TIMEZONE || 'UTC' });
}));

app.post('/api/rooms/private', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  const movieId = String(req.body.movieId || '');
  const startsAt = new Date(req.body.startsAt);
  const password = req.body.password;
  if (!validPositiveId(movieId) || Number(movieId) > 2147483647) {
    return res.status(400).json({ error: 'Filme inválido.' });
  }
  if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date() ||
      startsAt > new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)) {
    return res.status(400).json({ error: 'Escolha um horário futuro dentro dos próximos 30 dias.' });
  }
  if (!validBcryptPassword(password, 8)) {
    return res.status(400).json({ error: 'A senha da sala deve ter pelo menos 8 caracteres e até 72 bytes UTF-8.' });
  }
  const title = typeof req.body.movieTitle === 'string' ? req.body.movieTitle.trim() : '';
  const posterPath = typeof req.body.posterPath === 'string' ? req.body.posterPath : '';
  const genre = typeof req.body.genre === 'string' ? req.body.genre.trim() : 'Filme';
  if (!title || title.length > 250 || posterPath.length > 1000 || !genre || genre.length > 100) {
    return res.status(400).json({ error: 'Os dados do filme são inválidos.' });
  }
  const availableIds = await pipocaIds('movie');
  if (!availableIds.has(movieId)) {
    return res.status(404).json({ error: 'Este filme não está disponível para reprodução.' });
  }
  const runtime = await movieRuntime(movieId);
  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.session.user.id]);
    const active = await client.query(
      `SELECT COUNT(*)::int AS count FROM rooms
       WHERE creator_id = $1 AND room_type = 'private'
         AND status IN ('scheduled', 'waiting', 'playing')`,
      [req.session.user.id]
    );
    if (active.rows[0].count >= 3) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Você já possui 3 salas privadas ativas.' });
    }
    const result = await client.query(
      `INSERT INTO rooms
        (room_type, genre, movie_id, movie_title, poster_path, creator_id, password_hash,
         starts_at, ends_at, duration_seconds, duration_is_estimate)
       VALUES ('private', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [genre, Number(movieId), title, posterPath || null, req.session.user.id,
        passwordHash, startsAt,
        new Date(startsAt.getTime() + (runtime.seconds + roomGraceSeconds) * 1000),
        runtime.seconds, runtime.estimated]
    );
    await client.query(
      'INSERT INTO audit_events (actor_id, event_type, details) VALUES ($1, $2, $3)',
      [req.session.user.id, 'room.private_created', { roomId: String(result.rows[0].id) }]
    );
    await client.query('COMMIT');
    res.status(201).json({ roomId: String(result.rows[0].id) });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.delete('/api/rooms/:id', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  if (!validPositiveId(req.params.id)) return res.status(400).json({ error: 'Sala inválida.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roomResult = await client.query(
      'SELECT id, room_type, creator_id, status, starts_at FROM rooms WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    const room = roomResult.rows[0];
    if (!room) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sala não encontrada.' });
    }
    if (room.room_type !== 'private' || String(room.creator_id) !== req.session.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Somente o criador pode excluir a própria sala privada.' });
    }
    if (room.status !== 'scheduled' || room.starts_at <= new Date()) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A sala só pode ser excluída antes do horário de início.' });
    }
    const participants = await client.query(
      `SELECT COUNT(*)::int AS count FROM room_participants
       WHERE room_id = $1 AND last_seen_at > NOW() - INTERVAL '2 minutes'`,
      [room.id]
    );
    if (participants.rows[0].count > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Saia da sala com todos os participantes antes de excluí-la.' });
    }
    await client.query('DELETE FROM rooms WHERE id = $1', [room.id]);
    await client.query(
      'INSERT INTO audit_events (actor_id, event_type, details) VALUES ($1, $2, $3)',
      [req.session.user.id, 'room.private_deleted', { roomId: String(room.id) }]
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/rooms/:id/join', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  if (!validPositiveId(req.params.id)) return res.status(400).json({ error: 'Sala inválida.' });
  await updateRoomLifecycle();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roomResult = await client.query('SELECT * FROM rooms WHERE id = $1 FOR UPDATE', [req.params.id]);
    const room = roomResult.rows[0];
    if (!room) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sala não encontrada.' });
    }
    if (room.status === 'ended' || room.status === 'cancelled' || room.status === 'failed' ||
        room.ends_at <= new Date()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'Essa sala foi encerrada e não aceita novas entradas.' });
    }
    if (room.room_type === 'private') {
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      if (Buffer.byteLength(password, 'utf8') > 72 || !await bcrypt.compare(password, room.password_hash)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Senha da sala incorreta.' });
      }
    }
    const existing = await client.query(
      'SELECT 1 FROM room_participants WHERE room_id = $1 AND user_id = $2',
      [room.id, req.session.user.id]
    );
    if (existing.rowCount) {
      await client.query(
        'UPDATE room_participants SET last_seen_at = NOW() WHERE room_id = $1 AND user_id = $2',
        [room.id, req.session.user.id]
      );
    } else {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM room_participants
         WHERE room_id = $1 AND last_seen_at > NOW() - INTERVAL '2 minutes'`,
        [room.id]
      );
      if (rows[0].count >= room.capacity) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Essa sala atingiu o limite de 42 participantes.' });
      }
      await client.query(
        'INSERT INTO room_participants (room_id, user_id, last_seen_at) VALUES ($1, $2, NOW())',
        [room.id, req.session.user.id]
      );
    }
    const count = await client.query(
      `SELECT COUNT(*)::int AS count FROM room_participants
       WHERE room_id = $1 AND last_seen_at > NOW() - INTERVAL '2 minutes'`,
      [room.id]
    );
    await client.query('COMMIT');
    res.json({ roomId: String(room.id), participants: count.rows[0].count });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

async function getRoomForParticipant(roomId, userId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.status, r.movie_id, r.starts_at, r.ends_at, r.duration_seconds,
            r.duration_is_estimate, r.room_type,
            p.user_id AS participant_id, NOW() AS server_now
     FROM rooms r
     LEFT JOIN room_participants p ON p.room_id = r.id AND p.user_id = $2
     WHERE r.id = $1`,
    [roomId, userId]
  );
  const room = rows[0];
  if (!room) return { error: { status: 404, message: 'Sala não encontrada.' } };
  if (!room.participant_id) return { error: { status: 403, message: 'Você não participa desta sala.' } };
  return { room, state: roomSessionState(room, new Date(room.server_now)) };
}

app.get('/api/rooms/:id/player', requireAuth, asyncRoute(async (req, res) => {
  if (!validPositiveId(req.params.id)) return res.status(400).json({ error: 'Sala inválida.' });
  const { room, state: sessionState, error } = await getRoomForParticipant(
    req.params.id, req.session.user.id
  );
  if (error) return res.status(error.status).json({ error: error.message });
  if (['cancelled', 'failed'].includes(room.status)) {
    return res.json({ state: room.status });
  }
  if (sessionState !== 'playing') {
    return res.json({
      state: sessionState,
      starts_at: room.starts_at,
      ends_at: room.ends_at
    });
  }
  const availableIds = await pipocaIds('movie');
  if (!availableIds.has(String(room.movie_id))) {
    return res.status(404).json({ error: 'Este filme não está mais disponível para reprodução.' });
  }
  const latest = await getRoomForParticipant(req.params.id, req.session.user.id);
  if (latest.error) return res.status(latest.error.status).json({ error: latest.error.message });
  if (latest.state !== 'playing') {
    return res.json({
      state: latest.state,
      starts_at: latest.room.starts_at,
      ends_at: latest.room.ends_at
    });
  }
  res.json({
    state: 'playing',
    embed_url: buildPipocaEmbedUrl(String(room.movie_id), 'movie'),
    starts_at: room.starts_at,
    ends_at: room.ends_at
  });
}));

app.post('/api/rooms/:id/leave', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  if (!validPositiveId(req.params.id)) return res.status(400).json({ error: 'Sala inválida.' });
  await pool.query('DELETE FROM room_participants WHERE room_id = $1 AND user_id = $2', [
    req.params.id, req.session.user.id
  ]);
  res.json({ success: true });
}));

app.get('/api/rooms/:id/messages', requireAuth, asyncRoute(async (req, res) => {
  if (!validPositiveId(req.params.id)) return res.status(400).json({ error: 'Sala inválida.' });
  const member = await pool.query(
    'SELECT 1 FROM room_participants WHERE room_id = $1 AND user_id = $2',
    [req.params.id, req.session.user.id]
  );
  if (!member.rowCount) return res.status(403).json({ error: 'Entre na sala para consultar o chat.' });
  const { rows } = await pool.query(
    `SELECT id, username, body, created_at FROM (
       SELECT id, username, body, created_at FROM room_messages
       WHERE room_id = $1 ORDER BY id DESC LIMIT 100
     ) history ORDER BY id ASC`,
    [req.params.id]
  );
  res.json({ messages: rows });
}));

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
app.get('/api/admin/accounts', requireAuth, requireAdmin, adminLimiter, asyncRoute(async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 64) : '';
  const { rows } = await pool.query(
    `SELECT id, username, role, is_active, created_at FROM users
     WHERE username ILIKE $1 ORDER BY created_at DESC LIMIT 100`,
    [`%${search.replace(/[\\%_]/g, '\\$&')}%`]
  );
  res.json({ accounts: rows });
}));
app.patch('/api/admin/accounts/:id/status', requireAuth, requireAdmin, requireCsrf, adminLimiter, asyncRoute(async (req, res) => {
  if (!validPositiveId(req.params.id) || typeof req.body.isActive !== 'boolean') {
    return res.status(400).json({ error: 'Informe um estado válido e uma conta válida.' });
  }
  const result = await pool.query(
    "UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 AND role <> 'admin' RETURNING id",
    [req.body.isActive, req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Conta não encontrada ou protegida.' });
  if (!req.body.isActive) {
    await pool.query("DELETE FROM user_sessions WHERE sess->'user'->>'id' = $1", [String(req.params.id)]);
    disconnectUserSockets(req.params.id);
  }
  await audit('admin.account_status_changed', req.session.user.id, {
    targetUserId: String(req.params.id), isActive: req.body.isActive
  });
  res.json({ success: true });
}));
app.post('/api/admin/accounts/:id/password', requireAuth, requireAdmin, requireCsrf, adminLimiter, asyncRoute(async (req, res) => {
  if (!validPositiveId(req.params.id) || !validPassword(req.body.password)) {
    return res.status(400).json({ error: 'Informe uma senha com pelo menos 12 caracteres (limite de 72 bytes UTF-8) e uma conta válida.' });
  }
  const result = await pool.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND role <> $3 RETURNING id',
    [await bcrypt.hash(req.body.password, 12), req.params.id, 'admin']
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Conta não encontrada ou protegida.' });
  await pool.query("DELETE FROM user_sessions WHERE sess->'user'->>'id' = $1", [String(req.params.id)]);
  disconnectUserSockets(req.params.id);
  await audit('admin.password_reset', req.session.user.id, { targetUserId: String(req.params.id) });
  res.json({ success: true });
}));
app.delete('/api/admin/accounts/:id', requireAuth, requireAdmin, requireCsrf, adminLimiter, asyncRoute(async (req, res) => {
  if (!validPositiveId(req.params.id) || String(req.params.id) === req.session.user.id) {
    return res.status(400).json({ error: 'Conta inválida.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cancelled = await client.query(
      `UPDATE rooms SET status = 'cancelled'
       WHERE creator_id = $1 AND room_type = 'private'
         AND status IN ('scheduled', 'waiting', 'playing')
       RETURNING id`,
      [req.params.id]
    );
    for (const room of cancelled.rows) {
      await client.query(
        'INSERT INTO audit_events (actor_id, event_type, details) VALUES ($1, $2, $3)',
        [req.session.user.id, 'room.private_cancelled', { roomId: String(room.id) }]
      );
    }
    const deleted = await client.query(
      "DELETE FROM users WHERE id = $1 AND role <> 'admin' RETURNING id",
      [req.params.id]
    );
    if (!deleted.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Conta não encontrada ou protegida.' });
    }
    await client.query("DELETE FROM user_sessions WHERE sess->'user'->>'id' = $1", [String(req.params.id)]);
    await client.query(
      'INSERT INTO audit_events (actor_id, event_type, details) VALUES ($1, $2, $3)',
      [req.session.user.id, 'admin.account_deleted', { targetUserId: String(req.params.id) }]
    );
    await client.query('COMMIT');
    disconnectUserSockets(req.params.id);
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));
app.get('/api/admin/audit', requireAuth, requireAdmin, adminLimiter, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, u.username AS actor, a.event_type, a.details, a.created_at
     FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC LIMIT 200`
  );
  res.json({ events: rows });
}));
app.get('/api/admin/stats', requireAuth, requireAdmin, adminLimiter, asyncRoute(async (_req, res) => {
  const [accounts, activeRooms, sessions] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE is_active)::int AS active FROM users`),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM room_participants p
       JOIN rooms r ON r.id = p.room_id
       WHERE p.last_seen_at > NOW() - INTERVAL '2 minutes'
         AND r.status IN ('scheduled', 'waiting', 'playing')`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM audit_events
       WHERE event_type IN ('auth.login_succeeded', 'account.registered')
         AND created_at > NOW() - INTERVAL '24 hours'`
    )
  ]);
  res.json({
    totalAccounts: accounts.rows[0].total,
    activeAccounts: accounts.rows[0].active,
    roomMemberships: activeRooms.rows[0].total,
    sessionsLast24Hours: sessions.rows[0].total
  });
}));

app.get('/api/time', (_req, res) => {
  res.json({ now: new Date().toISOString(), timezone: process.env.APP_TIMEZONE || 'UTC' });
});

await migrate();
await bootstrapAdmin();
await updateRoomLifecycle();
const httpServer = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
  console.log(`Cinemix listening on port ${process.env.PORT || 3000}`);
});
io = new Server(httpServer, {
  serveClient: true,
  maxHttpBufferSize: 16 * 1024,
  cors: { origin: false }
});
io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  const sessionUser = socket.request.session?.user;
  if (!sessionUser?.id) return next(new Error('Authentication required'));
  pool.query(
    'SELECT id, username, role FROM users WHERE id = $1 AND is_active = TRUE',
    [sessionUser.id]
  ).then(({ rows }) => {
    if (!rows[0]) return next(new Error('Authentication required'));
    socket.data.user = publicUser(rows[0]);
    next();
  }).catch((error) => {
    console.error('Socket authentication lookup failed:', error.message);
    next(new Error('Authentication unavailable'));
  });
});
io.on('connection', (socket) => {
  socket.on('room:join', async (roomId, callback = () => {}) => {
    if (!validPositiveId(roomId)) return callback({ error: 'Sala inválida.' });
    try {
      const member = await pool.query(
        `UPDATE room_participants p SET last_seen_at = NOW()
         FROM rooms r
         WHERE p.room_id = r.id AND r.id = $1 AND p.user_id = $2
           AND r.status IN ('scheduled', 'waiting', 'playing')
           AND EXISTS (SELECT 1 FROM users u WHERE u.id = p.user_id AND u.is_active = TRUE)
         RETURNING p.room_id`,
        [roomId, socket.data.user.id]
      );
      if (!member.rowCount) return callback({ error: 'Você não participa desta sala.' });
      socket.join(`room:${roomId}`);
      callback({ success: true });
    } catch (error) {
      console.error('Socket room authorization failed:', error.message);
      callback({ error: 'Não foi possível conectar ao chat.' });
    }
  });
  socket.on('room:heartbeat', async (roomId) => {
    if (!validPositiveId(roomId) || !socket.rooms.has(`room:${roomId}`)) return;
    try {
      await pool.query(
        `UPDATE room_participants p SET last_seen_at = NOW()
         FROM users u WHERE p.room_id = $1 AND p.user_id = $2
           AND u.id = p.user_id AND u.is_active = TRUE`,
        [roomId, socket.data.user.id]
      );
    } catch (error) {
      console.error('Room presence update failed:', error.message);
    }
  });
  socket.on('room:message', async (payload, callback = () => {}) => {
    const roomId = String(payload?.roomId || '');
    const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
    if (!validPositiveId(roomId) || !body || body.length > 500) {
      return callback({ error: 'A mensagem deve ter de 1 a 500 caracteres.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        String(socket.data.user.id)
      ]);
      const member = await client.query(
        `SELECT u.username FROM room_participants p
         JOIN users u ON u.id = p.user_id
         JOIN rooms r ON r.id = p.room_id
         WHERE p.room_id = $1 AND p.user_id = $2
           AND r.status IN ('scheduled', 'waiting', 'playing')
           AND u.is_active = TRUE`,
        [roomId, socket.data.user.id]
      );
      if (!member.rowCount || !socket.rooms.has(`room:${roomId}`)) {
        await client.query('ROLLBACK');
        return callback({ error: 'Você não está autorizado a enviar mensagens nesta sala.' });
      }
      const recent = await client.query(
        `SELECT COUNT(*)::int AS count FROM room_messages
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '10 seconds'`,
        [socket.data.user.id]
      );
      if (recent.rows[0].count >= 5) {
        await client.query('ROLLBACK');
        return callback({ error: 'Aguarde antes de enviar outra mensagem.' });
      }
      const { rows } = await client.query(
        `INSERT INTO room_messages (room_id, user_id, username, body)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, body, created_at`,
        [roomId, socket.data.user.id, member.rows[0].username, body]
      );
      await client.query('COMMIT');
      io.to(`room:${roomId}`).emit('room:message', rows[0]);
      callback({ success: true });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Could not persist room message:', error.message);
      callback({ error: 'Não foi possível enviar a mensagem.' });
    } finally {
      client.release();
    }
  });
});

app.use('/api', (error, _req, res, _next) => {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error('API request failed:', error.message);
  res.status(status).json({
    error: status >= 500
      ? 'Não foi possível concluir a solicitação. Tente novamente.'
      : error.type === 'entity.parse.failed'
        ? 'O corpo da solicitação não contém JSON válido.'
        : error.message
  });
});

setInterval(() => updateRoomLifecycle().catch((error) => {
  console.error('Room lifecycle update failed:', error.message);
}), 60_000).unref();

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    httpServer.close(() => {
      io.close();
      pool.end().finally(() => process.exit(0));
    });
  });
}
