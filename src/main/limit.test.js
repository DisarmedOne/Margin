const test = require('node:test');
const assert = require('node:assert');
const { client, local, fingerprint } = require('./limit');

test('without an account, five different files are counted on this computer', async () => {
  const used = [];
  const limit = local(() => used, async () => {});
  for (const k of ['a', 'b', 'c', 'd', 'e']) await limit.claim(k);
  await limit.claim('a');
  assert.deepEqual(await limit.usage(), { used: 5, max: 5 });
  assert.equal(await limit.check('a'), true);
  await assert.rejects(limit.check('f'), { code: 'LIMIT' });
  await assert.rejects(limit.claim('f'), { code: 'LIMIT' });
});

async function withServer(reply, run) {
  const real = globalThis.fetch;
  globalThis.fetch = reply;
  try {
    await run(client(async () => 'token'));
  } finally {
    globalThis.fetch = real;
  }
}

test('a full account refuses new files but not ones it already counted', async () => {
  let known = false;
  await withServer(async () => Response.json({ used: 5, max: 5, known }), async (limit) => {
    await assert.rejects(limit.check(fingerprint('a')), { code: 'LIMIT' });
    known = true;
    assert.equal(await limit.check(fingerprint('a')), true);
  });
});

test('files still being read count against the places left', async () => {
  await withServer(async () => Response.json({ used: 4, max: 5, known: false }), async (limit) => {
    await limit.check(fingerprint('a'));
    await assert.rejects(limit.check(fingerprint('b'), 1), { code: 'LIMIT' });
  });
});

test('nothing is allowed when the count cannot be checked', async () => {
  await withServer(async () => new Response('{}', { status: 404 }), (limit) => assert.rejects(limit.check('x'), { code: 'SERVER' }));
  await withServer(async () => { throw new Error('offline'); }, (limit) => assert.rejects(limit.claim('x'), { code: 'OFFLINE' }));
  await withServer(async () => new Response('{}', { status: 401 }), (limit) => assert.rejects(limit.usage(), { code: 'SIGNIN' }));
  await withServer(async () => Response.json({ error: 'full', used: 5, max: 5 }), (limit) => assert.rejects(limit.claim('x'), { code: 'LIMIT' }));
});
