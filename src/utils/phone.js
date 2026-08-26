export function normalizePhone(value) {
  return String(value || '')
    .trim()
    .replace(/[\s()-]/g, '');
}

export function isValidPhone(value) {
  return /^\+?\d{7,15}$/.test(normalizePhone(value));
}

