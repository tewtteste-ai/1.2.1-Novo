export function normalizeUsername(value) {
  return value.trim().toLowerCase();
}

export function validUsername(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_]{3,24}$/.test(value);
}

export function validPassword(value) {
  return validBcryptPassword(value, 12);
}

export function validBcryptPassword(value, minimumCharacters) {
  return typeof value === 'string' &&
    Array.from(value).length >= minimumCharacters &&
    Buffer.byteLength(value, 'utf8') <= 72;
}

export function validPositiveId(value) {
  return /^\d{1,10}$/.test(String(value)) && Number(value) > 0;
}
