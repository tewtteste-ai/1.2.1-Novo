const baseUrl = 'https://pipocacine.online';

export function parsePipocaIdList(body) {
  let values;
  try {
    values = JSON.parse(body);
  } catch {
    values = body.trim()
      ? body.trim().split(/[\s,;]+/)
      : [];
  }

  if (!Array.isArray(values)) {
    throw new Error('A lista de IDs do Pipoca Cine tem um formato inválido.');
  }
  const ids = new Set();
  for (const value of values) {
    const id = String(value);
    if (!/^\d{1,10}$/.test(id) || Number(id) < 1) {
      throw new Error('A lista de IDs do Pipoca Cine contém um ID inválido.');
    }
    ids.add(id);
  }
  return ids;
}

export function buildPipocaEmbedUrl(tmdbId, type, season, episode) {
  if (!/^\d{1,10}$/.test(String(tmdbId)) || Number(tmdbId) < 1) {
    throw new Error('ID TMDb inválido para o player do Pipoca Cine.');
  }
  if (type === 'movie') {
    if (season !== undefined || episode !== undefined) {
      throw new Error('Temporada e episódio não são válidos para um filme.');
    }
    return `${baseUrl}/embed/${tmdbId}`;
  }
  if (type !== 'tv') throw new Error('Tipo de conteúdo inválido para o player.');

  const seasonNumber = Number(season);
  const episodeNumber = Number(episode);
  if (!Number.isInteger(seasonNumber) || seasonNumber < 0 ||
      !Number.isInteger(episodeNumber) || episodeNumber < 1) {
    throw new Error('Temporada ou episódio inválidos para o player do Pipoca Cine.');
  }
  return `${baseUrl}/embed/${tmdbId}/${seasonNumber}/${episodeNumber}`;
}

export function validatePipocaContent(payload, requestedId, expectedType) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      (payload.ok !== undefined && payload.ok !== true)) {
    throw new Error('A resposta do Pipoca Cine não confirmou o conteúdo solicitado.');
  }

  const id = String(payload.tmdb_id ?? '');
  const type = payload.type === 'series' ? 'tv' : payload.type;
  if (id !== String(requestedId) || type !== expectedType) {
    throw new Error('O Pipoca Cine retornou dados de outro conteúdo ou tipo.');
  }
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (!title || typeof payload.embed_url !== 'string') {
    throw new Error('A resposta do Pipoca Cine não incluiu os dados necessários.');
  }

  let embed;
  try {
    embed = new URL(payload.embed_url);
  } catch {
    throw new Error('A URL de reprodução retornada pelo Pipoca Cine é inválida.');
  }
  if (embed.origin !== baseUrl || embed.pathname !== `/embed/${id}` ||
      embed.search || embed.hash) {
    throw new Error('A URL de reprodução retornada pelo Pipoca Cine não corresponde ao conteúdo.');
  }
  return { id, type, title, embedUrl: embed.toString() };
}
