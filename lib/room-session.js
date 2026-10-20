export function roomSessionState(room, now = new Date()) {
  if (['ended', 'cancelled', 'failed'].includes(room.status)) return room.status;
  const currentTime = now.getTime();
  const startsAt = new Date(room.starts_at).getTime();
  const filmEndsAt = startsAt + Number(room.duration_seconds) * 1000;
  const closesAt = new Date(room.ends_at).getTime();
  if (currentTime < startsAt) return 'scheduled';
  if (currentTime < filmEndsAt) return 'playing';
  if (currentTime < closesAt) return 'finished';
  return 'ended';
}
