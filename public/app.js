const state = {
  user: null,
  csrf: '',
  view: 'movies',
  category: '',
  type: 'movie',
  genres: [],
  page: 1,
  totalPages: 1,
  query: '',
  roomType: 'public',
  room: null,
  deleteRoomTimer: null,
  deleteRoomId: null,
  socket: null,
  heartbeat: null,
  roomPlayerTimer: null,
  playerLoadTimer: null,
  playerRequestId: 0,
  playerProvider: 'pipoca',
  playerItem: null,
  playerType: null,
  playerEpisode: { season: 1, episode: 1 },
  myEmbedSeriesList: false,
  timezone: 'UTC',
  register: false,
  toastTimer: null
};
const $ = (selector) => document.querySelector(selector);
const catalogItems = new Map();
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const api = async (url, options = {}) => {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  if (options.method && options.method !== 'GET') headers['x-csrf-token'] = state.csrf;
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
  return data;
};
const imageUrl = (path, size = 'w500') => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `https://image.tmdb.org/t/p/${size}${encodeURI(path)}`;
};
function catalogGenreNames(item) {
  const genresById = new Map(state.genres.map((genre) => [Number(genre.id), genre.name]));
  return (item.genre_ids || []).map((id) => genresById.get(Number(id))).filter(Boolean);
}
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove('show'), 3500);
}
function loadEmbeddedPlayer(frame, url, statusElement) {
  clearTimeout(state.playerLoadTimer);
  frame.removeAttribute('src');
  statusElement.textContent = 'Carregando o player…';
  frame.onload = () => {
    if (frame.getAttribute('src') !== url) return;
    clearTimeout(state.playerLoadTimer);
    statusElement.textContent = 'Embed carregado. A reprodução depende da disponibilidade e das permissões do provedor.';
  };
  frame.onerror = () => {
    clearTimeout(state.playerLoadTimer);
    statusElement.textContent = 'Não foi possível carregar o player. Verifique a disponibilidade e as permissões de incorporação.';
  };
  frame.src = url;
  state.playerLoadTimer = setTimeout(() => {
    if (frame.getAttribute('src') === url) {
      statusElement.textContent = 'O player ainda não respondeu. Verifique a conexão e se o provedor permite incorporação.';
    }
  }, 15_000);
}
function formatDate(date, timezone = 'UTC') {
  if (!date) return 'Horário não informado';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short', timeStyle: 'short', timeZone: timezone
    }).format(new Date(date));
  } catch {
    return new Date(date).toLocaleString('pt-BR');
  }
}
function showAuthenticated() {
  $('#auth-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#home-view').classList.remove('hidden');
  $('#watch-view').classList.add('hidden');
  $('#header-actions').classList.remove('hidden');
  $('#header-actions').innerHTML = `<span class="user-chip">Olá, ${escapeHtml(state.user.username)}</span><button class="button button-secondary" id="logout-button">Sair</button>`;
  $('#logout-button').addEventListener('click', logout);
  $('#admin-tab').classList.toggle('hidden', state.user.role !== 'admin');
  renderCategories();
  loadGenres();
  loadCatalog();
}
function showLoggedOut() {
  state.user = null;
  state.room = null;
  clearInterval(state.roomPlayerTimer);
  state.roomPlayerTimer = null;
  state.playerRequestId += 1;
  $('#auth-view').classList.remove('hidden');
  $('#app-view').classList.add('hidden');
  $('#header-actions').classList.add('hidden');
  $('#watch-view').classList.add('hidden');
  $('#home-view').classList.remove('hidden');
  clearTimeout(state.playerLoadTimer);
  $('#detail-player-frame').removeAttribute('src');
  $('#room-player-frame').removeAttribute('src');
  $('#chat-messages').innerHTML = '';
  $('#catalog-grid').innerHTML = '';
  $('#rooms-grid').innerHTML = '';
  $('#calendar-grid').innerHTML = '';
  $('#room-note').textContent = '';
  $('#accounts-list').innerHTML = '';
  $('#audit-list').innerHTML = '';
  $('#admin-stats').innerHTML = '';
  $('#detail-content').innerHTML = '';
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  catalogItems.clear();
  $('#auth-error').textContent = '';
  $('#username').value = '';
  $('#password').value = '';
}
async function loadCsrf() {
  const data = await api('/api/csrf');
  state.csrf = data.csrfToken;
}
async function submitAuth(event) {
  event.preventDefault();
  const button = $('#auth-submit');
  const error = $('#auth-error');
  button.disabled = true;
  error.textContent = '';
  const payload = {
    username: $('#username').value,
    password: $('#password').value
  };
  try {
    const result = await api(`/api/auth/${state.register ? 'register' : 'login'}`, {
      method: 'POST', body: JSON.stringify(payload)
    });
    state.user = result.user;
    await loadCsrf();
    showAuthenticated();
    toast(state.register ? 'Conta criada com sucesso.' : 'Você entrou no Cinemix.');
  } catch (failure) {
    error.textContent = failure.message;
    if (failure.message === 'Esse nome de usuário já existe') $('#username').classList.add('invalid');
    else $('#username').classList.remove('invalid');
  } finally {
    button.disabled = false;
  }
}
async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    clearInterval(state.heartbeat);
    clearInterval(state.roomPlayerTimer);
    state.socket?.disconnect();
    showLoggedOut();
    await loadCsrf();
  } catch (error) {
    toast(error.message);
  }
}
const catalogViews = ['movies', 'series'];
const catalogTypeLabels = { movies: 'filme', series: 'série' };
function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
  $('#catalog-controls').classList.toggle('hidden', !catalogViews.includes(view));
  $('#catalog-grid').classList.toggle('hidden', !catalogViews.includes(view));
  $('#catalog-message').classList.add('hidden');
  $('.pagination').classList.toggle('hidden', !catalogViews.includes(view));
  $('#rooms-panel').classList.toggle('hidden', view !== 'rooms');
  $('#admin-panel').classList.toggle('hidden', view !== 'admin');
  $('#calendar-panel').classList.toggle('hidden', view !== 'calendar');
  if (catalogViews.includes(view)) {
    state.type = view === 'series' ? 'tv' : 'movie';
    state.category = '';
    state.page = 1;
    state.genres = [];
    renderCategories();
    loadGenres();
    loadCatalog();
  } else if (view === 'rooms') {
    loadRooms();
  } else if (view === 'calendar') {
    loadCalendar();
  } else if (view === 'admin') {
    loadAdmin();
  }
}
function renderCategories() {
  $('#catalog-categories').innerHTML = [
    `<button class="category ${!state.category ? 'active' : ''}" data-category="">Todos</button>`,
    ...state.genres.map((genre) =>
      `<button class="category ${state.category === genre.slug ? 'active' : ''}" data-category="${escapeHtml(genre.slug)}">${escapeHtml(genre.name)}</button>`
    )
  ].join('');
  $('#catalog-categories').querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', () => {
      state.category = button.dataset.category;
      state.page = 1;
      renderCategories();
      loadCatalog();
    });
  });
}
async function loadGenres() {
  const requestedView = state.view;
  try {
    const data = await api(`/api/catalog/genres?category=${encodeURIComponent(requestedView)}`);
    if (state.view !== requestedView) return;
    state.genres = data.genres || [];
    renderCategories();
  } catch (error) {
    toast(error.message);
  }
}
function renderCards(results, append = false) {
  const grid = $('#catalog-grid');
  const cards = results.map((item) => {
    const title = item.title || item.name || 'Título sem nome';
    const date = item.release_date || item.first_air_date || '';
    const rating = Number(item.vote_average);
    const type = item.media_type || state.type;
    catalogItems.set(`${item.id}:${type}`, item);
    return `<article class="movie-card" data-id="${Number(item.id)}" data-type="${type}">
      <div class="poster-wrap">
        ${item.poster_path ? `<img src="${escapeHtml(imageUrl(item.poster_path))}" alt="Pôster de ${escapeHtml(title)}" loading="lazy">` : ''}
        ${Number.isFinite(rating) && rating > 0 ? `<span class="rating">★ ${rating.toFixed(1)}</span>` : ''}
      </div>
      <div class="card-info"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(date ? date.slice(0, 4) : 'Data indisponível')}</p></div>
    </article>`;
  }).join('');
  grid.innerHTML = append ? grid.innerHTML + cards : cards;
  grid.querySelectorAll('.movie-card').forEach((card) => {
    if (card.dataset.bound) return;
    card.dataset.bound = 'true';
    card.addEventListener('click', () => loadDetails(card.dataset.id, card.dataset.type));
  });
}
async function loadCatalog(append = false) {
  if (!catalogViews.includes(state.view)) return;
  const message = $('#catalog-message');
  const button = $('#load-more');
  message.classList.add('hidden');
  button.disabled = true;
  button.textContent = 'Carregando...';
  if (!append) $('#catalog-grid').innerHTML = '<div class="empty-state">Carregando catálogo...</div>';
  try {
    const url = state.query
      ? `/api/search?q=${encodeURIComponent(state.query)}&page=${state.page}`
      : `/api/catalog/${state.view}?page=${state.page}${state.category ? `&genre=${encodeURIComponent(state.category)}` : ''}`;
    const data = await api(url);
    state.totalPages = Math.min(Number(data.total_pages || 1), 500);
    renderCards(data.results || [], append);
    if (data.metadata_warning) {
      message.textContent = data.metadata_warning;
      message.classList.remove('hidden');
    }
    $('#catalog-page').textContent = data.total_results ? `Página ${state.page} de ${state.totalPages}` : '';
    if (!data.results?.length) {
      if (!append) $('#catalog-grid').innerHTML = '';
      message.textContent = data.has_more
        ? 'Nenhum título disponível nesta página. Continue carregando para buscar mais resultados.'
        : append ? 'Não há mais títulos disponíveis.' : 'Nenhum título encontrado.';
      message.classList.remove('hidden');
    }
    button.classList.toggle('hidden', !data.has_more);
    button.textContent = 'Carregar mais';
  } catch (error) {
    if (!append) $('#catalog-grid').innerHTML = '';
    message.textContent = error.message;
    message.classList.remove('hidden');
    button.classList.add('hidden');
  } finally {
    button.disabled = false;
  }
}
async function loadDetails(id, type = state.type) {
  try {
    const item = catalogItems.get(`${id}:${type}`);
    if (!item) throw new Error('Este título não está mais disponível no catálogo. Atualize a lista e tente novamente.');
    const title = item.title || item.name || '';
    const date = item.release_date || item.first_air_date || '';
    const genres = ((item.genres?.length ? item.genres : catalogGenreNames(item)) || []).map((genre) =>
      typeof genre === 'string' ? genre : genre?.name
    ).filter(Boolean).join(' · ');
    $('#detail-content').innerHTML = `<div class="detail-layout">
      ${item.poster_path ? `<img class="detail-poster" src="${escapeHtml(imageUrl(item.poster_path))}" alt="Pôster de ${escapeHtml(title)}">` : '<div class="detail-poster"></div>'}
      <div class="detail-content">
        <p class="eyebrow">${escapeHtml((catalogTypeLabels[state.view] || (type === 'movie' ? 'filme' : 'série')).toUpperCase())}</p>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml([date, genres, item.vote_average ? `★ ${Number(item.vote_average).toFixed(1)}` : ''].filter(Boolean).join(' · '))}</p>
        <p>${escapeHtml(item.overview || (item.title_is_identifier
          ? 'O provedor retornou o ID do título sem os metadados; a reprodução ainda pode ser aberta.'
          : 'Sinopse não disponível.'))}</p>
        <div class="detail-actions">
          <button id="play-title" class="button button-primary">Assistir ${type === 'tv' ? 'série' : escapeHtml(catalogTypeLabels[state.view] || 'filme')}</button>
          ${type === 'movie' && state.view === 'movies' ? '<button id="create-private-room" class="button button-secondary">Criar sala privada</button>' : ''}
        </div>
      </div>
    </div>`;
    $('#detail-dialog').showModal();
    $('#play-title').addEventListener('click', () => openPlayer(item, type));
    $('#create-private-room')?.addEventListener('click', () =>
      showCreateRoom({ ...item, genres: catalogGenreNames(item) }));
  } catch (error) {
    toast(error.message);
  }
}
async function loadSelectedPlayer(frame, type, id, season, episode, statusElement) {
  const requestId = ++state.playerRequestId;
  clearTimeout(state.playerLoadTimer);
  frame.removeAttribute('src');
  statusElement.textContent = 'Verificando a disponibilidade e carregando o player...';
  try {
    const params = new URLSearchParams({ provider: state.playerProvider });
    if (type === 'tv' && !state.myEmbedSeriesList) {
      params.set('season', String(season));
      params.set('episode', String(episode));
    }
    const query = `?${params}`;
    const data = await api(`/api/player/${type}/${encodeURIComponent(id)}${query}`);
    if (requestId !== state.playerRequestId) return;
    loadEmbeddedPlayer(frame, data.embed_url, statusElement);
  } catch (error) {
    if (requestId !== state.playerRequestId) return;
    statusElement.textContent = error.message;
  }
}
async function openPlayer(item, type, selectedEpisode = {}) {
  if (!['movie', 'tv'].includes(type) || !Number.isSafeInteger(Number(item.id)) || Number(item.id) < 1) {
    toast('Não foi possível abrir o player deste título.');
    return;
  }
  const frame = $('#detail-player-frame');
  $('#player-title').textContent = item.title || item.name || 'Reprodução';
  const controls = $('#series-controls');
  state.playerItem = item;
  state.playerType = type;
  state.playerProvider = 'pipoca';
  state.myEmbedSeriesList = false;
  $('#switch-player-button').classList.remove('hidden');
  $('#switch-player-button').textContent = 'Trocar para MyEmbed';
  if (type === 'movie') {
    controls.classList.add('hidden');
    $('#player-dialog').showModal();
    await loadSelectedPlayer(frame, type, item.id, undefined, undefined, $('#player-status'));
  } else {
    const seasonSelect = $('#player-season');
    const episodeSelect = $('#player-episode');
    const seasonManual = $('#player-season-manual');
    const episodeManual = $('#player-episode-manual');
    $('#player-status').textContent = 'Consultando o calendário de episódios...';
    controls.classList.remove('hidden');
    $('#player-dialog').showModal();
    let entries = [];
    let calendarError = '';
    try {
      const data = await api(`/api/calendar?tmdb_id=${encodeURIComponent(item.id)}`);
      entries = data.entries || [];
    } catch (error) {
      calendarError = error.message;
    }

    const availableEntries = entries.filter((entry) =>
      Number.isInteger(Number(entry.season)) && Number(entry.season) >= 0 &&
      Number.isInteger(Number(entry.number)) && Number(entry.number) > 0
    );
    if (availableEntries.length) {
      const seasons = [...new Set(availableEntries.map((entry) => Number(entry.season)))].sort((a, b) => a - b);
      seasonSelect.innerHTML = [...seasons.map((season) =>
        `<option value="${season}">Temporada ${season}</option>`
      ), '<option value="manual">Outra temporada/episódio...</option>'].join('');
      seasonSelect.value = String(seasons.includes(Number(selectedEpisode.season))
        ? Number(selectedEpisode.season)
        : seasons[0]);
      seasonSelect.classList.remove('hidden');
      episodeSelect.classList.remove('hidden');
      seasonManual.classList.add('hidden');
      episodeManual.classList.add('hidden');
      const updateAvailableEpisodes = () => {
        if (seasonSelect.value === 'manual') {
          episodeSelect.classList.add('hidden');
          seasonManual.classList.remove('hidden');
          episodeManual.classList.remove('hidden');
          seasonManual.value = '1';
          episodeManual.value = '1';
          updateManualPlayer();
          return;
        }
        episodeSelect.classList.remove('hidden');
        seasonManual.classList.add('hidden');
        episodeManual.classList.add('hidden');
        const season = Number(seasonSelect.value);
        const seasonEntries = [...new Map(availableEntries
          .filter((entry) => Number(entry.season) === season)
          .map((entry) => [Number(entry.number), entry])).values()];
        episodeSelect.innerHTML = seasonEntries.map((entry) =>
          `<option value="${Number(entry.number)}">${escapeHtml(entry.episode_title || `Episódio ${entry.number}`)} · ${Number(entry.number)}</option>`
        ).join('');
        episodeSelect.value = String(seasonEntries.some((entry) => Number(entry.number) === Number(selectedEpisode.episode))
          ? Number(selectedEpisode.episode)
          : Number(seasonEntries[0].number));
        state.playerEpisode = { season, episode: Number(episodeSelect.value) };
        updatePlayer();
      };
      const updatePlayer = () => {
        const season = Number(seasonSelect.value);
        const episode = Number(episodeSelect.value);
        if (Number.isInteger(season) && Number.isInteger(episode)) {
          state.playerEpisode = { season, episode };
          state.myEmbedSeriesList = false;
          loadSelectedPlayer(frame, type, item.id, season, episode, $('#player-status'));
        }
      };
      const updateManualPlayer = () => {
        const season = Number(seasonManual.value);
        const episode = Number(episodeManual.value);
        if (Number.isInteger(season) && season >= 0 && Number.isInteger(episode) && episode > 0) {
          state.playerEpisode = { season, episode };
          state.myEmbedSeriesList = false;
          loadSelectedPlayer(frame, type, item.id, season, episode, $('#player-status'));
        }
      };
      seasonSelect.onchange = updateAvailableEpisodes;
      episodeSelect.onchange = updatePlayer;
      seasonManual.onchange = updateManualPlayer;
      episodeManual.onchange = updateManualPlayer;
      updateAvailableEpisodes();
    } else {
      seasonSelect.classList.add('hidden');
      episodeSelect.classList.add('hidden');
      seasonManual.classList.remove('hidden');
      episodeManual.classList.remove('hidden');
      seasonManual.value = String(Number.isInteger(Number(selectedEpisode.season)) ? selectedEpisode.season : 1);
      episodeManual.value = String(Number.isInteger(Number(selectedEpisode.episode)) ? selectedEpisode.episode : 1);
      const updatePlayer = () => {
        const season = Number(seasonManual.value);
        const episode = Number(episodeManual.value);
        if (Number.isInteger(season) && season >= 0 && Number.isInteger(episode) && episode > 0) {
          state.playerEpisode = { season, episode };
          state.myEmbedSeriesList = false;
          loadSelectedPlayer(frame, type, item.id, season, episode, $('#player-status'));
        }
      };
      state.playerEpisode = {
        season: Number(seasonManual.value),
        episode: Number(episodeManual.value)
      };
      seasonManual.onchange = updatePlayer;
      episodeManual.onchange = updatePlayer;
      updatePlayer();
      $('#player-status').textContent = calendarError
        ? `Calendário indisponível (${calendarError}); temporada e episódio podem ser informados manualmente.`
        : 'O calendário não listou episódios para esta série; informe temporada e episódio.';
    };
  }
}
function showCreateRoom(movie) {
  $('#detail-dialog').close();
  $('#room-dialog-content').innerHTML = `<h2>Criar sala privada</h2>
    <p class="muted">Filme: <strong>${escapeHtml(movie.title)}</strong>. Você pode manter até 3 salas privadas ativas.</p>
    <form id="create-room-form">
      <label for="room-start">Horário de início</label><input id="room-start" type="datetime-local" required>
      <p class="muted small">Informe no fuso do seu dispositivo; a programação será exibida em ${escapeHtml(state.timezone)}.</p>
      <label for="room-password">Senha da sala</label><input id="room-password" type="password" minlength="8" maxlength="72" required>
      <p class="muted small">A sala encerra 10 minutos após a duração do filme. Quando o catálogo não informa a duração, o horário é estimado.</p>
      <p class="form-error" id="room-form-error"></p>
      <button class="button button-primary" type="submit">Criar sala</button>
    </form>`;
  const input = $('#room-start');
  const min = new Date(Date.now() + 60_000);
  input.min = new Date(min.getTime() - min.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const max = new Date(Date.now() + 30 * 86400_000);
  input.max = new Date(max.getTime() - max.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  $('#create-room-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const startAt = new Date(input.value);
    try {
      await api('/api/rooms/private', {
        method: 'POST',
        body: JSON.stringify({
          movieId: movie.id,
          movieTitle: movie.title,
          posterPath: movie.poster_path,
          genre: movie.genres?.[0] || 'Filme',
          startsAt: startAt.toISOString(),
          password: $('#room-password').value
        })
      });
      $('#room-dialog').close();
      toast('Sala criada e salva.');
      state.roomType = 'private';
      document.querySelector('[data-view="rooms"]').click();
      document.querySelector('[data-room-type="private"]').click();
    } catch (error) {
      $('#room-form-error').textContent = error.message;
    }
  });
  $('#room-dialog').showModal();
}
async function loadRooms() {
  const grid = $('#rooms-grid');
  grid.innerHTML = '<div class="empty-state">Carregando salas...</div>';
  try {
    const data = await api(`/api/rooms?type=${state.roomType}`);
    const rooms = data.rooms || [];
    $('#room-note').textContent = state.roomType === 'public'
      ? `42 salas programadas · horários em ${data.timezone} · participantes são membros atuais da sala.`
      : 'Salas privadas ativas. A senha é solicitada ao entrar e nunca aparece nesta lista.';
    if (!rooms.length) {
      grid.innerHTML = '<div class="empty-state">Nenhuma sala disponível no momento.</div>';
      return;
    }
    grid.innerHTML = rooms.map((room) => {
      const sessionState = room.session_state || room.status;
      const status = {
        scheduled: 'Agendada', waiting: 'Aguardando', playing: 'Sessão liberada',
        finished: 'Filme encerrado · sala em fechamento', ended: 'Encerrada',
        cancelled: 'Cancelada', failed: 'Falha'
      }[sessionState] || sessionState;
      return `<article class="room-card">
        ${room.poster_path ? `<img class="room-poster" src="${escapeHtml(imageUrl(room.poster_path, 'w185'))}" alt="">` : '<div class="room-poster"></div>'}
        <div class="room-info">
          <span class="room-number">${room.room_type === 'public' ? `SALA ${String(room.slot_number).padStart(2, '0')} · ` : ''}${escapeHtml(room.genre)}</span>
          <h3>${escapeHtml(room.movie_title)}</h3>
          <p>${room.creator ? `Criada por ${escapeHtml(room.creator)} · ` : ''}${formatDate(room.starts_at, data.timezone)}</p>
          <p>${room.participants}/${room.capacity} participantes · ${status}</p>
          ${room.duration_is_estimate ? '<p class="muted small">Duração estimada; a fonte não forneceu o tempo.</p>' : ''}
          <div class="room-footer"><span class="room-state">Player</span><div class="room-actions">
            ${room.room_type === 'private' && String(room.creator_id) === state.user.id
              ? `<button class="button button-secondary delete-room-button" data-delete-room="${escapeHtml(room.id)}" ${room.status === 'scheduled' && new Date(room.starts_at) > new Date() && room.participants === 0 ? '' : 'disabled title="Só pode apagar antes do início e quando ninguém estiver na sala."'} aria-label="Apagar sua sala privada" title="Apagar sala">
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3"/></svg>
              </button>` : ''}
            <button class="button button-primary" data-join-room="${escapeHtml(room.id)}" data-private="${room.room_type === 'private'}" ${['ended', 'cancelled', 'failed'].includes(sessionState) ? 'disabled' : ''}>Entrar</button>
          </div></div>
        </div>
      </article>`;
    }).join('');
    grid.querySelectorAll('[data-join-room]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.private === 'true') return showJoinPrivate(button.dataset.joinRoom);
      joinRoom(button.dataset.joinRoom);
    }));
    grid.querySelectorAll('[data-delete-room]').forEach((button) => button.addEventListener('click', async () => {
      if (button.disabled) return;
      startDeleteRoomCountdown(button.dataset.deleteRoom);
    }));
  } catch (error) {
    grid.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}
function cancelDeleteRoomCountdown() {
  clearInterval(state.deleteRoomTimer);
  state.deleteRoomTimer = null;
  state.deleteRoomId = null;
  const dialog = $('#delete-room-dialog');
  if (dialog.open) dialog.close();
}
function startDeleteRoomCountdown(roomId) {
  cancelDeleteRoomCountdown();
  state.deleteRoomId = roomId;
  let remaining = 3;
  $('#delete-room-countdown').textContent = `A sala será apagada em ${remaining}...`;
  $('#delete-room-dialog').showModal();
  state.deleteRoomTimer = setInterval(async () => {
    remaining -= 1;
    if (remaining > 0) {
      $('#delete-room-countdown').textContent = `A sala será apagada em ${remaining}...`;
      return;
    }
    const id = state.deleteRoomId;
    cancelDeleteRoomCountdown();
    try {
      await api(`/api/rooms/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Sala apagada.');
      loadRooms();
    } catch (error) {
      toast(error.message);
    }
  }, 1000);
}
async function loadCalendar() {
  const grid = $('#calendar-grid');
  grid.innerHTML = '<div class="empty-state">Carregando calendário...</div>';
  try {
    const data = await api('/api/calendar');
    const entries = data.entries || [];
    if (!entries.length) {
      grid.innerHTML = '<div class="empty-state">O provedor não retornou lançamentos.</div>';
      return;
    }
    grid.innerHTML = entries.map((entry, index) => `
      <article class="room-card">
        ${entry.poster ? `<img class="room-poster" src="${escapeHtml(imageUrl(entry.poster, 'w185'))}" alt="">` : '<div class="room-poster"></div>'}
        <div class="room-info">
          <span class="room-number">${escapeHtml(entry.status || 'Episódio')}</span>
          <h3>${escapeHtml(entry.title)}</h3>
          <p>${escapeHtml(entry.episode_title || `Temporada ${entry.season} · Episódio ${entry.number}`)}</p>
          <p>${escapeHtml(entry.air_date || 'Data não informada')}</p>
          <div class="room-footer"><span class="room-state">T${Number(entry.season)} · E${Number(entry.number)}</span>
            <button class="button button-primary" data-calendar-entry="${index}">Assistir</button>
          </div>
        </div>
      </article>`).join('');
    grid.querySelectorAll('[data-calendar-entry]').forEach((button) => {
      button.addEventListener('click', () => {
        const entry = entries[Number(button.dataset.calendarEntry)];
        if (!entry) return;
        openPlayer(
          { id: Number(entry.tmdb_id), title: entry.title },
          'tv',
          { season: Number(entry.season), episode: Number(entry.number) }
        );
      });
    });
  } catch (error) {
    grid.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}
function showJoinPrivate(roomId) {
  $('#room-dialog-content').innerHTML = `<h2>Entrar na sala privada</h2><form id="join-room-form">
    <label for="join-password">Senha da sala</label><input id="join-password" type="password" required maxlength="72">
    <p class="form-error" id="join-room-error"></p><button class="button button-primary" type="submit">Entrar</button>
    </form>`;
  $('#join-room-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await joinRoom(roomId, $('#join-password').value);
      $('#room-dialog').close();
    } catch (error) {
      $('#join-room-error').textContent = error.message;
    }
  });
  $('#room-dialog').showModal();
}
async function joinRoom(roomId, password) {
  await api(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST', body: JSON.stringify({ password })
  });
  const data = await api(`/api/rooms?type=${state.roomType}`);
  state.room = data.rooms.find((room) => String(room.id) === String(roomId));
  if (!state.room) throw new Error('A sala não está mais disponível.');
  $('#home-view').classList.add('hidden');
  $('#watch-view').classList.remove('hidden');
  $('#watch-title').textContent = state.room.movie_title;
  $('#watch-genre').textContent = state.room.genre;
  $('#watch-meta').textContent = `${state.room.participants}/${state.room.capacity} participantes · ${formatDate(state.room.starts_at, data.timezone)}`;
  $('#watch-status').textContent = 'verificando';
  $('#room-player-frame').removeAttribute('src');
  $('#chat-messages').innerHTML = '';
  await loadMessages(roomId);
  connectChat(roomId);
  clearInterval(state.roomPlayerTimer);
  await loadRoomPlayer();
  state.roomPlayerTimer = setInterval(loadRoomPlayer, 15_000);
}
async function loadRoomPlayer() {
  if (!state.room) return;
  try {
    const data = await api(`/api/rooms/${encodeURIComponent(state.room.id)}/player`);
    const frame = $('#room-player-frame');
    const status = $('#room-player-status');
    $('#watch-status').textContent = {
      scheduled: 'agendada',
      playing: 'sessão liberada',
      finished: 'filme encerrado',
      ended: 'encerrada',
      cancelled: 'cancelada',
      failed: 'indisponível'
    }[data.state] || data.state;
    if (data.state === 'scheduled') {
      frame.removeAttribute('src');
      status.textContent = `Esta sessão ainda não começou. A exibição será liberada em ${formatDate(data.starts_at, state.timezone)}.`;
    } else if (data.state === 'playing') {
      if (frame.getAttribute('src') !== data.embed_url) {
        loadEmbeddedPlayer(frame, data.embed_url, status);
      }
    } else {
      frame.removeAttribute('src');
      status.textContent = data.state === 'finished'
        ? `O filme terminou. A sala será encerrada em ${formatDate(data.ends_at, state.timezone)}.`
        : 'Esta sessão foi encerrada e o player está bloqueado.';
    }
  } catch (error) {
    $('#room-player-status').textContent = error.message;
  }
}
async function loadMessages(roomId) {
  try {
    const data = await api(`/api/rooms/${roomId}/messages`);
    data.messages.forEach(renderMessage);
  } catch (error) {
    $('#chat-error').textContent = error.message;
  }
}
function renderMessage(message) {
  const list = $('#chat-messages');
  const row = document.createElement('div');
  row.className = 'message';
  const name = document.createElement('strong');
  name.textContent = message.username;
  const time = document.createElement('time');
  time.textContent = new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const body = document.createElement('p');
  body.textContent = message.body;
  row.append(name, time, body);
  list.append(row);
  list.scrollTop = list.scrollHeight;
}
function connectChat(roomId) {
  clearInterval(state.heartbeat);
  state.socket?.disconnect();
  state.socket = window.io({ transports: ['websocket', 'polling'] });
  state.socket.on('connect', () => state.socket.emit('room:join', roomId, (result) => {
    if (result?.error) $('#chat-error').textContent = `${result.error} Saia e entre na sala novamente.`;
    else state.heartbeat = setInterval(() => state.socket?.emit('room:heartbeat', roomId), 30_000);
  }));
  state.socket.on('room:message', renderMessage);
  state.socket.on('connect_error', () => {
    $('#chat-error').textContent = 'Conexão do chat indisponível. Tentando reconectar...';
  });
  state.socket.on('room:ended', () => {
    $('#watch-status').textContent = 'encerrada';
    $('#chat-error').textContent = 'Esta sala foi encerrada.';
    $('#chat-input').disabled = true;
    $('#room-player-frame').removeAttribute('src');
    $('#room-player-status').textContent = 'Esta sessão foi encerrada e o player está bloqueado.';
    clearInterval(state.roomPlayerTimer);
    state.roomPlayerTimer = null;
  });
  state.socket.on('connect', () => { $('#chat-error').textContent = ''; });
}
async function leaveRoom() {
  if (!state.room) return;
  clearInterval(state.heartbeat);
  clearInterval(state.roomPlayerTimer);
  state.roomPlayerTimer = null;
  state.socket?.disconnect();
  clearTimeout(state.playerLoadTimer);
  $('#room-player-frame').removeAttribute('src');
  $('#room-player-status').textContent = '';
  try {
    await api(`/api/rooms/${state.room.id}/leave`, { method: 'POST' });
  } catch (error) {
    toast(error.message);
  }
  state.room = null;
  $('#chat-input').disabled = false;
  $('#watch-view').classList.add('hidden');
  $('#home-view').classList.remove('hidden');
  setView('rooms');
}
async function loadAdmin() {
  try {
    const [stats, accounts, audit] = await Promise.all([
      api('/api/admin/stats'), api('/api/admin/accounts'), api('/api/admin/audit')
    ]);
    $('#admin-stats').innerHTML = `<div class="stat-card"><strong>${stats.totalAccounts}</strong><span>Total de contas (${stats.activeAccounts} ativas)</span></div><div class="stat-card"><strong>${stats.sessionsLast24Hours}</strong><span>Sessões iniciadas · últimas 24 h</span></div><div class="stat-card"><strong>${stats.roomMemberships}</strong><span>Membros vistos em salas abertas · últimos 2 min</span></div>`;
    renderAccounts(accounts.accounts);
    $('#audit-list').innerHTML = audit.events.map((event) =>
      `<div class="audit-entry">${escapeHtml(event.event_type)} · ${escapeHtml(event.actor || 'Sistema')} · ${formatDate(event.created_at)}${Object.keys(event.details || {}).length ? ` · ${escapeHtml(JSON.stringify(event.details))}` : ''}</div>`
    ).join('') || '<p class="muted">Sem eventos registrados.</p>';
  } catch (error) {
    $('#accounts-list').innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}
function renderAccounts(accounts) {
  $('#accounts-list').innerHTML = accounts.map((account) =>
    `<div class="account-row"><div>${escapeHtml(account.username)} ${account.role === 'admin' ? '· administrador' : ''}<small>${account.is_active ? 'Ativa' : 'Suspensa'} · criada em ${formatDate(account.created_at)}</small></div>${account.role === 'admin' ? '' : `<div class="account-actions"><button class="button button-secondary" data-status-id="${escapeHtml(account.id)}" data-active="${account.is_active}">${account.is_active ? 'Suspender' : 'Reativar'}</button><button class="button button-secondary" data-reset="${escapeHtml(account.id)}">Redefinir senha</button><button class="button button-secondary" data-delete="${escapeHtml(account.id)}">Excluir</button></div>`}</div>`
  ).join('') || '<p class="empty-state">Nenhuma conta encontrada.</p>';
  $('#accounts-list').querySelectorAll('[data-status-id]').forEach((button) => button.addEventListener('click', async () => {
    const isActive = button.dataset.active !== 'true';
    if (!confirm(`${isActive ? 'Reativar' : 'Suspender'} esta conta?`)) return;
    try {
      await api(`/api/admin/accounts/${button.dataset.statusId}/status`, {
        method: 'PATCH', body: JSON.stringify({ isActive })
      });
      toast(`Conta ${isActive ? 'reativada' : 'suspensa'}.`);
      loadAdmin();
    } catch (error) { toast(error.message); }
  }));
  $('#accounts-list').querySelectorAll('[data-reset]').forEach((button) => button.addEventListener('click', async () => {
    const password = prompt('Nova senha (mínimo de 12 caracteres; máximo de 72 bytes UTF-8):');
    if (password === null) return;
    try {
      await api(`/api/admin/accounts/${button.dataset.reset}/password`, {
        method: 'POST', body: JSON.stringify({ password })
      });
      toast('Senha redefinida; sessões anteriores invalidadas.');
      loadAdmin();
    } catch (error) { toast(error.message); }
  }));
  $('#accounts-list').querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Excluir esta conta? As salas e mensagens serão preservadas sem o vínculo da conta.')) return;
    try {
      await api(`/api/admin/accounts/${button.dataset.delete}`, { method: 'DELETE' });
      toast('Conta excluída.');
      loadAdmin();
    } catch (error) { toast(error.message); }
  }));
}
let searchTimer;
$('#auth-form').addEventListener('submit', submitAuth);
$('#auth-switch').addEventListener('click', () => {
  state.register = !state.register;
  $('#auth-subtitle').textContent = state.register ? 'Crie sua conta Cinemix.' : 'Entre na sua conta para continuar.';
  $('#auth-submit').textContent = state.register ? 'Criar conta' : 'Entrar';
  $('#auth-switch').innerHTML = state.register
    ? 'Já tem uma conta? <strong>Entrar</strong>'
    : 'Ainda não tem conta? <strong>Criar conta</strong>';
  $('#password').autocomplete = state.register ? 'new-password' : 'current-password';
  $('#password').minLength = state.register ? 12 : 1;
  $('#auth-error').textContent = '';
});
$('#search-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  state.query = $('#search-input').value.trim();
  state.page = 1;
  searchTimer = setTimeout(() => loadCatalog(), 350);
});
$('#load-more').addEventListener('click', () => { state.page += 1; loadCatalog(true); });
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)));
document.querySelectorAll('[data-room-type]').forEach((button) => button.addEventListener('click', () => {
  state.roomType = button.dataset.roomType;
  document.querySelectorAll('[data-room-type]').forEach((item) => item.classList.toggle('active', item === button));
  loadRooms();
}));
$('#admin-search').addEventListener('input', async () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    try {
      const data = await api(`/api/admin/accounts?search=${encodeURIComponent($('#admin-search').value)}`);
      renderAccounts(data.accounts);
    } catch (error) { toast(error.message); }
  }, 250);
});
$('#chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const body = $('#chat-input').value.trim();
  if (!body || !state.socket?.connected || !state.room) return;
  state.socket.emit('room:message', { roomId: state.room.id, body }, (result) => {
    if (result?.error) $('#chat-error').textContent = result.error;
    else {
      $('#chat-input').value = '';
      $('#chat-error').textContent = '';
    }
  });
});
$('#leave-room').addEventListener('click', leaveRoom);
$('#back-to-home').addEventListener('click', leaveRoom);
$('#fullscreen-button').addEventListener('click', async () => {
  const target = $('#room-player-frame');
  try {
    if (!document.fullscreenElement) await target.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    toast(error.message || 'Não foi possível abrir a tela cheia. Verifique as permissões do navegador.');
  }
});
$('#detail-fullscreen-button').addEventListener('click', async () => {
  const target = $('#detail-player-frame');
  try {
    if (!document.fullscreenElement) await target.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    toast(error.message || 'Não foi possível abrir a tela cheia. Verifique as permissões do navegador.');
  }
});
$('#switch-player-button').addEventListener('click', () => {
  if (!state.playerItem) return;
  state.playerProvider = state.playerProvider === 'pipoca' ? 'myembed' : 'pipoca';
  state.myEmbedSeriesList = state.playerType === 'tv' && state.playerProvider === 'myembed';
  $('#switch-player-button').textContent = state.playerProvider === 'pipoca'
    ? 'Trocar para MyEmbed'
    : 'Voltar para Pipoca Cine';
  loadSelectedPlayer(
    $('#detail-player-frame'),
    state.playerType,
    state.playerItem.id,
    state.playerEpisode.season,
    state.playerEpisode.episode,
    $('#player-status')
  );
});
document.querySelectorAll('[data-close]').forEach((button) =>
  button.addEventListener('click', () => $(`#${button.dataset.close}`).close())
);
$('#cancel-delete-room').addEventListener('click', cancelDeleteRoomCountdown);
$('#delete-room-dialog').addEventListener('cancel', cancelDeleteRoomCountdown);
$('#player-dialog').addEventListener('close', () => {
  state.playerRequestId += 1;
  clearTimeout(state.playerLoadTimer);
  $('#detail-player-frame').removeAttribute('src');
  $('#player-status').textContent = '';
  $('#series-controls').classList.add('hidden');
  $('#switch-player-button').classList.add('hidden');
  state.playerItem = null;
  state.playerType = null;
  state.playerProvider = 'pipoca';
  state.myEmbedSeriesList = false;
});

async function init() {
  try {
    await loadCsrf();
    const clock = await api('/api/time');
    state.timezone = clock.timezone;
    const data = await api('/api/auth/me');
    if (data.user) {
      state.user = data.user;
      showAuthenticated();
    }
  } catch (error) {
    $('#auth-error').textContent = error.message;
  }
}
init();
