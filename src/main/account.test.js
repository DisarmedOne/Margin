const test = require('node:test');
const assert = require('node:assert');
const account = require('./account');

// Replaces fetch with a canned reply per call and records what was sent.
function fakeFetch(t, ...replies) {
  const sent = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const [status, body] = replies.shift() ?? [200, {}];
    return { ok: status < 400, status, json: async () => body };
  });
  return sent;
}

test('a code is requested for the tidied email address', async (t) => {
  const sent = fakeFetch(t, [200, {}]);
  assert.strictEqual(await account.sendCode('  Reader@Example.COM '), 'reader@example.com');
  assert.match(sent[0].url, /\/auth\/v1\/otp$/);
  assert.deepStrictEqual(sent[0].body, { email: 'reader@example.com', create_user: true });
  assert.match(sent[0].headers.apikey, /^sb_publishable_/);
});

test('bad input is refused before anything is sent', async (t) => {
  const sent = fakeFetch(t);
  await assert.rejects(account.sendCode('not-an-address'), { code: 'EMAIL' });
  await assert.rejects(account.verifyCode('a@b.co', '12ab'), { code: 'CODE' });
  assert.strictEqual(sent.length, 0);
});

test('a right code returns a session; spaces in the code are ignored', async (t) => {
  const sent = fakeFetch(t, [200, { access_token: 'a', refresh_token: 'r', expires_at: 1, user: { email: 'a@b.co' } }]);
  const result = await account.verifyCode('a@b.co', '123 456');
  assert.deepStrictEqual(result, { email: 'a@b.co', session: { access_token: 'a', refresh_token: 'r', expires_at: 1 } });
  assert.deepStrictEqual(sent[0].body, { type: 'email', email: 'a@b.co', token: '123456' });
});

test('server refusals become readable errors', async (t) => {
  fakeFetch(t, [403, { error_code: 'otp_expired' }], [429, {}], [500, {}]);
  await assert.rejects(account.verifyCode('a@b.co', '123456'), { code: 'CODE' });
  await assert.rejects(account.sendCode('a@b.co'), { code: 'RATE' });
  await assert.rejects(account.sendCode('a@b.co'), { code: 'SERVER' });
});

test('signing out never throws, even offline', async (t) => {
  t.mock.method(global, 'fetch', async () => {
    throw new Error('offline');
  });
  await account.signOut({ refresh_token: 'r' });
});
