import assert from 'node:assert/strict';
import test from 'node:test';
import { runDatabaseWork, sessionOptions } from '../src/utils/databaseWork.js';

test('runs database work without a session in standalone mode', async () => {
  process.env.MONGO_TRANSACTIONS = 'false';
  const result = await runDatabaseWork(async (session) => {
    assert.equal(session, null);
    assert.deepEqual(sessionOptions(session), {});
    return 'completed';
  });

  assert.equal(result, 'completed');
});
