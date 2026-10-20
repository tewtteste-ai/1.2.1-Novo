export function buildMyEmbedMovieUrl(tmdbId) {
  validateTmdbId(tmdbId);
  return `https://myembed.biz/filme/${tmdbId}`;
}

export function buildMyEmbedSeriesUrl(tmdbId, season, episode) {
  validateTmdbId(tmdbId);
  if (season === undefined && episode === undefined) {
    return `https://myembed.biz/serie/${tmdbId}`;
  }
  if (season === undefined || episode === undefined ||
      !/^\d{1,3}$/.test(String(season)) || !/^[1-9]\d{0,3}$/.test(String(episode))) {
    throw new Error('Temporada ou episódio inválidos para o player MyEmbed.');
  }
  return `https://myembed.biz/serie/${tmdbId}/${season}/${episode}`;
}

function validateTmdbId(tmdbId) {
  if (!/^\d{1,10}$/.test(String(tmdbId)) || Number(tmdbId) < 1) {
    throw new Error('ID TMDb inválido para o player MyEmbed.');
  }
}
