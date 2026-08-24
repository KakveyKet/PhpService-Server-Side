import mongoose from 'mongoose';

export async function runDatabaseWork(work) {
  if (process.env.MONGO_TRANSACTIONS !== 'true') {
    return work(null);
  }

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export function sessionOptions(session) {
  return session ? { session } : {};
}
