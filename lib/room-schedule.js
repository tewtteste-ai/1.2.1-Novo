export const roomGenres = [
  { name: 'Terror', id: 'terror', count: 4 },
  { name: 'Ação', id: 'acao', count: 3 },
  { name: 'Comédia', id: 'comedia', count: 4 },
  { name: 'Drama', id: 'drama', count: 4 },
  { name: 'Ficção científica', id: 'ficcao-cientifica', count: 4 },
  { name: 'Animação', id: 'animacao', count: 4 },
  { name: 'Suspense', id: 'suspense', count: 3 },
  { name: 'Aventura', id: 'aventura', count: 3 },
  { name: 'Fantasia', id: 'fantasia', count: 3 }
];

export const additionalRoomGenres = [
  { name: 'Aventura', id: 'aventura' },
  { name: 'Animação', id: 'animacao' },
  { name: 'Comédia', id: 'comedia' },
  { name: 'Família', id: 'familia' },
  { name: 'Fantasia', id: 'fantasia' },
  { name: 'Ação', id: 'acao' },
  { name: 'Ficção científica', id: 'ficcao-cientifica' },
  { name: 'Suspense', id: 'suspense' },
  { name: 'Terror', id: 'terror' },
  { name: 'Terror e Mistério', id: 'terror-misterio' }
];

export const additionalRoomTimes = [
  [9, 0], [10, 30], [12, 0], [13, 30], [15, 0],
  [17, 0], [19, 0], [20, 0], [22, 0], [23, 30]
];

export const allRoomGenres = [...roomGenres, ...additionalRoomGenres];

export function buildRoomAssignments(resultsByGenre, scheduleDate = '1970-01-01') {
  const dayNumber = Math.floor(Date.parse(`${scheduleDate}T00:00:00Z`) / 86_400_000);
  if (!Number.isSafeInteger(dayNumber)) throw new Error('Invalid public schedule date.');
  const assignments = roomGenres.flatMap((genre) => {
    const movies = (resultsByGenre[genre.id] || []).filter((movie) =>
      Number.isSafeInteger(movie?.id) && movie.id > 0 && movie.id <= 2147483647 &&
      typeof movie.title === 'string' && movie.title.trim()
    );
    if (!movies.length) throw new Error(`The catalog provider returned no movies for genre ${genre.name}.`);
    const offset = ((dayNumber % movies.length) + movies.length) % movies.length;
    return Array.from({ length: genre.count }, (_, index) => ({
      genre: genre.name,
      movie: movies[(offset + index) % movies.length],
      startsAtMinute: null
    }));
  });
  const additions = additionalRoomGenres.map((genre, index) => {
    const movies = (resultsByGenre[genre.id] || []).filter((movie) =>
      Number.isSafeInteger(movie?.id) && movie.id > 0 && movie.id <= 2147483647 &&
      typeof movie.title === 'string' && movie.title.trim()
    );
    if (!movies.length) throw new Error(`The catalog provider returned no movies for genre ${genre.name}.`);
    const offset = ((dayNumber % movies.length) + movies.length) % movies.length;
    return {
      genre: genre.name,
      movie: movies[offset],
      startsAtMinute: additionalRoomTimes[index][0] * 60 + additionalRoomTimes[index][1]
    };
  });
  return [...assignments, ...additions];
}
