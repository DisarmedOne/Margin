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

// Plays the browser: visits the address Google would send the user back to.
const visit = (url) =>
  new Promise((resolve, reject) => require('node:http').get(url, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject));

test('Google sign-in swaps the returned code using the matching PKCE secret', async (t) => {
  const sent = fakeFetch(t, [200, { access_token: 'a', refresh_token: 'r', expires_at: 1, user: { email: 'g@b.co' } }]);
  let challenge;
  let returnedBeforeSession;
  const result = await account.signInWithGoogle(async (address) => {
    const query = new URL(address).searchParams;
    challenge = query.get('code_challenge');
    assert.strictEqual(query.get('provider'), 'google');
    const back = query.get('redirect_to');
    assert.strictEqual(await visit(back), 404, 'a visit without a code is ignored');
    await visit(`${back}?code=one-time`);
  }, { port: 0, onReturn: () => (returnedBeforeSession = sent.length === 0) });
  assert.strictEqual(returnedBeforeSession, true);
  assert.strictEqual(result.email, 'g@b.co');
  assert.strictEqual(sent[0].body.auth_code, 'one-time');
  const hashed = require('node:crypto').createHash('sha256').update(sent[0].body.code_verifier).digest('base64url');
  assert.strictEqual(hashed, challenge);
});

test('Google sign-in reports refusal, cancel and timeout without asking for a session', async (t) => {
  const sent = fakeFetch(t);
  const refuse = (address) => visit(`${new URL(address).searchParams.get('redirect_to')}?error=access_denied`);
  await assert.rejects(account.signInWithGoogle(refuse, { port: 0 }), { code: 'SIGNIN' });
  await assert.rejects(account.signInWithGoogle(() => setImmediate(account.cancelGoogle), { port: 0 }), { code: 'CANCELLED' });
  await assert.rejects(account.signInWithGoogle(() => {}, { port: 0, timeout: 20 }), { code: 'SIGNIN' });
  assert.strictEqual(sent.length, 0);
});

const renewed = [200, { access_token: 'new-a', refresh_token: 'new-r', expires_at: 2 }];

test('deleting renews the session, saves it, then calls the server as that user', async (t) => {
  const sent = fakeFetch(t, renewed, [200, { deleted: true }]);
  const saved = [];
  await account.deleteAccount({ refresh_token: 'old-r' }, (s) => saved.push(s));
  assert.strictEqual(saved[0].refresh_token, 'new-r');
  assert.match(sent[1].url, /\/functions\/v1\/delete-account$/);
  assert.strictEqual(sent[1].headers.authorization, 'Bearer new-a');
  assert.deepStrictEqual(sent[1].body, {});
});

test('deletion never reports success unless the server confirms it', async (t) => {
  fakeFetch(t, renewed, [404, {}], renewed, [500, {}], renewed, [200, {}], [400, {}]);
  const keep = () => {};
  for (let i = 0; i < 3; i++) {
    await assert.rejects(account.deleteAccount({ refresh_token: 'r' }, keep), /Could not delete your account/);
  }
  await assert.rejects(account.deleteAccount({ refresh_token: 'expired' }, keep), /sign in again/);
});

test('signing out never throws, even offline', async (t) => {
  t.mock.method(global, 'fetch', async () => {
    throw new Error('offline');
  });
  await account.signOut({ refresh_token: 'r' });
});
