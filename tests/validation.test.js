import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUsername,
  validBcryptPassword,
  validPassword,
  validPositiveId,
  validUsername
} from '../lib/validation.js';
import {
  additionalRoomGenres,
  additionalRoomTimes,
  allRoomGenres,
  buildRoomAssignments,
  roomGenres
} from '../lib/room-schedule.js';
import { roomSessionState } from '../lib/room-session.js';
import { localDateKey, localDateTimeToUtc, nextScheduleBase } from '../lib/schedule-time.js';
import {
  normalizeCalendarEntries,
  normalizeCatalogItems
} from '../lib/catalog.js';
import {
  buildPipocaEmbedUrl,
  parsePipocaIdList,
  validatePipocaContent
} from '../lib/pipoca-cine.js';

test('username normalization is case-insensitive and trims whitespace', () => {
  assert.equal(normalizeUsername('  Movie_Fan  '), 'movie_fan');
});

test('username validation accepts the supported boundary lengths', () => {
  assert.equal(validUsername('abc'), true);
  assert.equal(validUsername('a'.repeat(24)), true);
  assert.equal(validUsername('ab'), false);
  assert.equal(validUsername('a'.repeat(25)), false);
  assert.equal(validUsername('name with spaces'), false);
});

test('password validation enforces minimum characters and bcrypt byte limits', () => {
  assert.equal(validPassword('a'.repeat(12)), true);
  assert.equal(validPassword('a'.repeat(72)), true);
  assert.equal(validPassword('😀'.repeat(18)), true);
  assert.equal(validPassword('a'.repeat(11)), false);
  assert.equal(validPassword('a'.repeat(73)), false);
  assert.equal(validPassword('😀'.repeat(19)), false);
  assert.equal(validPassword(null), false);
  assert.equal(validBcryptPassword('12345678', 8), true);
  assert.equal(validBcryptPassword('1234567', 8), false);
});

test('positive numeric IDs reject zero, signs, decimals and oversized text', () => {
  assert.equal(validPositiveId('1'), true);
  assert.equal(validPositiveId('2147483647'), true);
  assert.equal(validPositiveId('0'), false);
  assert.equal(validPositiveId('-1'), false);
  assert.equal(validPositiveId('1.5'), false);
  assert.equal(validPositiveId('12345678901'), false);
});

test('Pipoca Cine ID lists accept the observed JSON array and newline TXT formats', () => {
  assert.deepEqual([...parsePipocaIdList('[738231, 603, 603]')], ['738231', '603']);
  assert.deepEqual([...parsePipocaIdList('738231\r\n603\n')], ['738231', '603']);
  assert.deepEqual([...parsePipocaIdList('')], []);
  assert.throws(() => parsePipocaIdList('{"error":"unavailable"}'), /formato inválido/);
  assert.throws(() => parsePipocaIdList('[738231, 0]'), /ID inválido/);
});

test('Pipoca Cine embed URLs preserve exact TMDb type and episode selection', () => {
  assert.equal(buildPipocaEmbedUrl('738231', 'movie'), 'https://pipocacine.online/embed/738231');
  assert.equal(buildPipocaEmbedUrl('312573', 'tv', '1', '1'),
    'https://pipocacine.online/embed/312573/1/1');
  assert.throws(() => buildPipocaEmbedUrl('312573', 'tv', '1', '0'), /inválidos/);
  assert.throws(() => buildPipocaEmbedUrl('312573', 'movie', '1', '1'), /não são válidos para um filme/);
});

test('Pipoca Cine content validation accepts the actual response and rejects mismatches', () => {
  const payload = {
    provider: 'PipocaCine',
    tmdb_id: 738231,
    type: 'movie',
    title: 'Pai Por Engano',
    embed_url: 'https://pipocacine.online/embed/738231'
  };
  assert.deepEqual(validatePipocaContent(payload, '738231', 'movie'), {
    id: '738231',
    type: 'movie',
    title: 'Pai Por Engano',
    embedUrl: 'https://pipocacine.online/embed/738231'
  });
  assert.throws(() => validatePipocaContent(payload, '603', 'movie'), /outro conteúdo/);
  assert.throws(() => validatePipocaContent({
    ...payload, embed_url: 'https://attacker.example/embed/738231'
  }, '738231', 'movie'), /não corresponde/);
  assert.throws(() => validatePipocaContent({ ...payload, ok: false }, '738231', 'movie'), /não confirmou/);
});

test('public schedule preserves 32 rooms and adds 10 varied daytime and night slots', () => {
  assert.equal(roomGenres.reduce((sum, genre) => sum + genre.count, 0), 32);
  assert.equal(roomGenres.find((genre) => genre.name === 'Terror').count, 4);
  assert.equal(roomGenres.find((genre) => genre.name === 'Ação').count, 3);
  assert.equal(additionalRoomGenres.length, 10);
  assert.equal(additionalRoomTimes.length, 10);
  assert.equal(additionalRoomTimes.at(-1).join(':'), '23:30');
});

test('schedule assignments use only real supplied movies and fail on missing genre data', () => {
  const genres = [...new Map(allRoomGenres.map((genre) => [genre.id, genre])).values()];
  const results = Object.fromEntries(genres.map((genre, index) => [
    genre.id,
    [{ id: index + 100, title: `Real movie ${genre.name}` }]
  ]));
  const assignments = buildRoomAssignments(results);
  assert.equal(assignments.length, 42);
  assert.equal(assignments.filter((slot) => slot.genre === 'Terror').length, 5);
  assert.equal(assignments.filter((slot) => slot.genre === 'Ação').length, 4);
  assert.equal(assignments[0].movie.title, 'Real movie Terror');
  assert.equal(assignments[32].startsAtMinute, 9 * 60);
  assert.equal(assignments[41].startsAtMinute, 23 * 60 + 30);
  assert.throws(() => buildRoomAssignments({}), /catalog provider returned no movies/);
  const idsOnly = Object.fromEntries(genres.map((genre) => [
    genre.id,
    [{ id: 501624, title: 'ID TMDb 501624', title_is_identifier: true }]
  ]));
  const idAssignments = buildRoomAssignments(idsOnly);
  assert.equal(idAssignments.length, 42);
  assert.equal(idAssignments[0].movie.title, 'ID TMDb 501624');
});

test('public schedule rotates through available movies on each date and repeats only as needed', () => {
  const genres = [...new Map(allRoomGenres.map((genre) => [genre.id, genre])).values()];
  const results = Object.fromEntries(genres.map((genre, index) => [
    genre.id,
    [
      { id: index + 100, title: `Movie one ${genre.name}` },
      { id: index + 200, title: `Movie two ${genre.name}` }
    ]
  ]));
  const firstDay = buildRoomAssignments(results, '2026-10-16');
  const nextDay = buildRoomAssignments(results, '2026-10-17');
  assert.equal(firstDay.length, 42);
  assert.equal(nextDay.length, 42);
  assert.notEqual(firstDay[0].movie.id, nextDay[0].movie.id);
  assert.equal(firstDay[0].movie.id, firstDay[2].movie.id);
  assert.throws(() => buildRoomAssignments(results, 'invalid'), /Invalid public schedule date/);
});

test('TMDb catalog normalization preserves TMDb IDs and rejects malformed results', () => {
  const items = normalizeCatalogItems({
    results: [
      {
        id: 603,
        title: 'The Matrix',
        poster_path: '/matrix.jpg',
        release_date: '1999-03-30',
        overview: 'A programmer discovers the truth.',
        vote_average: 8.7,
        genre_ids: [28, '878', 0],
        media_type: 'movie'
      },
      { id: 'bad', title: 'No numeric ID' },
      { id: 604, title: '' }
    ]
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 603);
  assert.equal(items[0].tmdb_id, '603');
  assert.equal(items[0].title, 'The Matrix');
  assert.equal(items[0].poster_path, '/matrix.jpg');
  assert.equal(items[0].release_date, '1999-03-30');
  assert.equal(items[0].media_type, 'movie');
  assert.deepEqual(items[0].genre_ids, [28, 878]);
});

test('Pipoca Cine ID-only entries are not treated as catalog metadata', () => {
  assert.deepEqual(normalizeCatalogItems(['63174'], 'tv'), []);
});

test('calendar normalization keeps TMDb and IMDb IDs separate for episode embeds', () => {
  const [entry] = normalizeCalendarEntries([{
    title: 'Example series',
    episode: 'Pilot',
    season: 1,
    number: 1,
    tmdb_id: '301139',
    imdb_id: 'tt43691424',
    poster: '/poster.jpg',
    status: 'Atualizado'
  }]);
  assert.equal(entry.tmdb_id, '301139');
  assert.equal(entry.imdb_id, 'tt43691424');
  assert.equal(entry.season, 1);
  assert.equal(entry.number, 1);
  assert.equal(entry.episode_title, 'Pilot');
});

test('public showtimes are planned at 18:00 in the configured timezone', () => {
  const base = nextScheduleBase(new Date('2026-10-15T15:00:00Z'), 'America/Sao_Paulo');
  assert.equal(base.toISOString(), '2026-10-15T21:00:00.000Z');
  assert.equal(localDateKey(base, 'America/Sao_Paulo'), '2026-10-15');
});

test('additional public showtimes use the configured timezone', () => {
  const start = localDateTimeToUtc('2026-10-15', 9, 0, 'America/Sao_Paulo');
  assert.equal(start.toISOString(), '2026-10-15T12:00:00.000Z');
  assert.throws(() => localDateTimeToUtc('2026-02-30', 9, 0, 'UTC'), /Invalid local schedule/);
});

test('session state obeys server timestamps and duration', () => {
  const room = {
    starts_at: '2026-10-18T18:00:00.000Z',
    duration_seconds: 6600,
    ends_at: '2026-10-18T20:00:00.000Z'
  };
  assert.equal(roomSessionState(room, new Date('2026-10-18T17:00:00.000Z')), 'scheduled');
  assert.equal(roomSessionState(room, new Date('2026-10-18T18:10:00.000Z')), 'playing');
  assert.equal(roomSessionState(room, new Date('2026-10-18T19:50:00.000Z')), 'finished');
  assert.equal(roomSessionState(room, new Date('2026-10-18T20:00:00.000Z')), 'ended');
});

test('schedule advances to the next local day after all 32 legacy half-hour slots pass', () => {
  const base = nextScheduleBase(new Date('2026-10-16T14:00:00Z'), 'America/Sao_Paulo');
  assert.equal(base.toISOString(), '2026-10-16T21:00:00.000Z');
  const startTimes = Array.from({ length: 32 }, (_, index) => base.getTime() + index * 30 * 60_000);
  assert.equal(new Set(startTimes).size, 32);
});
