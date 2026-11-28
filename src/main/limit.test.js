const test = require('node:test');
const assert = require('node:assert');
const { client, local, both, fingerprint } = require('./limit');

test('signing in or out never gives free papers back', async () => {
  const here = [];
  const computer = local(() => here, async () => {});
  const account = (list) => both(computer, local(() => list, async () => {}));
  const ann = [];
  await account(ann).claim('a');
  await account(ann).claim('b');
  assert.deepEqual(await computer.usage(), { used: 2, max: 3 }, 'signed out, the count stays');
  await computer.claim('c');
  assert.equal((await account(ann).usage()).used, 3);
  await assert.rejects(account(ann).claim('d'), { code: 'LIMIT' });
  assert.deepEqual(ann, ['a', 'b'], 'a refused paper costs the account nothing');
  await assert.rejects(account([]).check('d'), { code: 'LIMIT' }, 'a new account on the same computer gets nothing new');
  const fullElsewhere = ['x', 'y', 'z'];
  here.length = 0;
  await assert.rejects(account(fullElsewhere).claim('d'), { code: 'LIMIT' }, 'a full account stays full on a new computer');
  assert.deepEqual(here, []);
});

test('without an account, three different files are counted on this computer', async () => {
  const used = [];
  const limit = local(() => used, async () => {});
  for (const k of ['a', 'b', 'c']) await limit.claim(k);
  await limit.claim('a');
  assert.deepEqual(await limit.usage(), { used: 3, max: 3 });
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
