import Counter from '../models/Counter.js';

export async function nextNumber(key, prefix, session = null) {
  const options = {
    returnDocument: 'after',
    upsert: true,
    setDefaultsOnInsert: true
  };
  if (session) options.session = session;

  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { sequence: 1 } },
    options
  );

  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(counter.sequence).padStart(6, '0')}`;
}
