const collectionKeys = ['results', 'data', 'items', 'list', 'catalog'];

function collectionFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of collectionKeys) {
    if (payload[key] !== undefined) return collectionFrom(payload[key]);
  }
  if (payload.id !== undefined && (payload.title || payload.name)) {
    return [payload];
  }
  const values = Object.values(payload);
  return values.length && values.every((value) => value && typeof value === 'object')
    ? values.flatMap(collectionFrom)
    : [];
}

function firstValue(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

export function normalizeCatalogItems(payload, fallbackMediaType = 'movie') {
  return collectionFrom(payload).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const id = Number(item.id);
    const title = String(item.title || item.name || '').trim();
    if (!Number.isSafeInteger(id) || id <= 0 || !title) return [];
    return [{
      id,
      tmdb_id: String(id),
      imdb_id: '',
      title,
      name: title,
      title_is_identifier: false,
      poster_path: String(item.poster_path || ''),
      overview: String(item.overview || ''),
      release_date: String(item.release_date || ''),
      first_air_date: String(item.first_air_date || ''),
      vote_average: Number(item.vote_average) || 0,
      genre_ids: Array.isArray(item.genre_ids)
        ? item.genre_ids.map(Number).filter((genreId) => Number.isSafeInteger(genreId) && genreId > 0)
        : [],
      genres: [],
      seasons: Array.isArray(item.seasons) ? item.seasons : [],
      media_type: item.media_type === 'tv' || item.media_type === 'movie'
        ? item.media_type
        : fallbackMediaType
    }];
  });
}

export function normalizeCalendarEntries(payload) {
  return collectionFrom(payload).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const title = String(firstValue(entry, ['title', 'name', 'nome'])).trim();
    const tmdbId = String(firstValue(entry, ['tmdb_id', 'tmdbId', 'tmdb']));
    const season = Number(firstValue(entry, ['season', 'season_number']));
    const episode = Number(firstValue(entry, ['number', 'episode_number', 'episode']));
    if (!title || !/^\d{1,10}$/.test(tmdbId) || Number(tmdbId) < 1 ||
        !Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1) return [];
    return [{
      title,
      episode_title: String(firstValue(entry, ['episode', 'episode_title']) || ''),
      season,
      number: episode,
      air_date: String(firstValue(entry, ['air_date', 'release_date']) || ''),
      type: entry.type,
      tmdb_id: tmdbId,
      imdb_id: String(firstValue(entry, ['imdb_id', 'imdbId', 'imdb']) || ''),
      poster: String(firstValue(entry, ['poster', 'poster_path', 'poster_url']) || ''),
      backdrop: String(firstValue(entry, ['backdrop', 'backdrop_path', 'backdrop_url']) || ''),
      status: String(firstValue(entry, ['status']) || '')
    }];
  });
}
