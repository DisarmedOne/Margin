// Steelfable account sign-in with emailed codes or Google, through Supabase Auth's REST API.
const http = require('node:http');
const crypto = require('node:crypto');
const { MarginError } = require('./ai');

const PROJECT = 'https://xtptqrzjiqstyxuoglbq.supabase.co';
const AUTH = `${PROJECT}/auth/v1`;
// The publishable key is meant to ship inside apps; row level security is what protects data.
const KEY = 'sb_publishable_31IoDX-Xw8Y1EJvAHLccPg_xNmH83Aj';

function toError(path, status, body) {
  const code = body?.error_code ?? '';
  if (status === 429) return new MarginError('RATE', 'Too many tries. Wait a minute, then try again.');
  if (status >= 500) return new MarginError('SERVER', '{name} is having trouble right now. Try again in a minute.', { name: 'Steelfable' });
  if (code === 'otp_expired' || (path === 'verify' && status === 403)) {
    return new MarginError('CODE', 'That code is wrong or has expired. Check it, or send a new one.');
  }
  if (code === 'email_address_invalid') return new MarginError('EMAIL', 'Enter a valid email address.');
  return new MarginError('SIGNIN', 'Sign-in failed: {detail}', { detail: body?.msg ?? body?.message ?? `HTTP ${status}` });
}

async function post(path, body, token) {
  let res;
  try {
    res = await fetch(path.startsWith('https://') ? path : `${AUTH}/${path}`, {
      method: 'POST',
      headers: { apikey: KEY, 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30e3),
    });
  } catch {
    throw new MarginError('OFFLINE', 'Cannot reach {name}. Check your internet connection.', { name: 'Steelfable' });
  }
  if (res.ok) return res.status === 204 ? null : res.json();
  throw toError(path, res.status, await res.json().catch(() => null));
}

function cleanEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new MarginError('EMAIL', 'Enter a valid email address.');
  return value;
}

async function sendCode(email) {
  const address = cleanEmail(email);
  await post('otp', { email: address, create_user: true });
  return address;
}

async function verifyCode(email, code) {
  const address = cleanEmail(email);
  const token = String(code ?? '').replace(/\s/g, '');
  // The code length is a project setting, so accept any length Supabase allows.
  if (!/^\d{6,10}$/.test(token)) throw new MarginError('CODE', 'That code is wrong or has expired. Check it, or send a new one.');
  return signedIn(await post('verify', { type: 'email', email: address, token }), address);
}

const signedIn = (r, email) => ({
  email: r.user?.email ?? email,
  session: { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at },
});

// ---------- Google ----------
// Google runs in the user's own browser, which then returns to a one-off server on this computer (PKCE flow).
// This exact address has to be on the project's list of allowed redirect URLs.
const PORT = 53682;
const DONE_PAGE = (title, line) => `<!doctype html><meta charset="utf-8"><title>Steelfable</title>
<body style="margin:0;background:#EEF0F1;color:#171C21;font:16px/1.6 'Segoe UI',sans-serif">
<main style="max-width:440px;margin:18vh auto;padding:32px;background:#F9FAFA;border:1px solid #C9CFD4;border-left:3px solid #3D5A73">
<h1 style="margin:0 0 8px;font:bold 28px/1.2 Georgia,serif">${title}</h1><p style="margin:0">${line}</p></main>`;

let stopWaiting = null;
const cancelGoogle = () => stopWaiting?.(new MarginError('CANCELLED', 'Google sign-in was cancelled.'));

// Waits for the browser to come back with a one-time code.
function waitForCode(challenge, openBrowser, port, timeout) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (error, code) => {
      clearTimeout(timer);
      stopWaiting = null;
      server.close();
      if (error) reject(error);
      else resolve(code);
    };
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      const refused = url.searchParams.get('error_description') ?? url.searchParams.get('error');
      if (url.pathname !== '/callback' || (!code && !refused)) return res.writeHead(404, { connection: 'close' }).end();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
      res.end(code ? DONE_PAGE('Back to Margin.', 'You can close this tab.') : DONE_PAGE('Not signed in.', 'Close this tab and try again in Margin.'));
      if (code) finish(null, code);
      else finish(new MarginError('SIGNIN', 'Sign-in failed: {detail}', { detail: refused }));
    });
    server.on('error', () => finish(new MarginError('SIGNIN', 'Could not start Google sign-in. Close other copies of Margin and try again.')));
    server.listen(port, '127.0.0.1', () => {
      stopWaiting = finish;
      timer = setTimeout(() => finish(new MarginError('SIGNIN', 'Google sign-in took too long. Try again.')), timeout);
      const query = new URLSearchParams({
        provider: 'google',
        redirect_to: `http://127.0.0.1:${server.address().port}/callback`,
        code_challenge: challenge,
        code_challenge_method: 's256',
      });
      Promise.resolve(openBrowser(`${AUTH}/authorize?${query}`)).catch((e) => finish(e));
    });
  });
}

async function signInWithGoogle(openBrowser, { port = PORT, timeout = 5 * 60e3, onReturn } = {}) {
  cancelGoogle();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const code = await waitForCode(challenge, openBrowser, port, timeout);
  onReturn?.(); // the browser is done; fetching the session still takes a few seconds
  return signedIn(await post('token?grant_type=pkce', { auth_code: code, code_verifier: verifier }), '');
}

// Deletes the account itself, through the server function in supabase/functions/delete-account.
// Unlike signing out, every failure is reported: the user must never think an account is gone when it isn't.
async function deleteAccount(session, onRenew) {
  const passOn = (e, fallback) => (['OFFLINE', 'RATE'].includes(e.code) ? e : new MarginError('SIGNIN', fallback));
  let fresh;
  try {
    fresh = await post('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
  } catch (e) {
    if (e.code === 'SERVER') throw e;
    throw passOn(e, 'Sign out, sign in again, then delete your account.');
  }
  // Renewing replaces the saved token, so it has to be stored even if deleting fails.
  await onRenew(signedIn(fresh, '').session);
  let result;
  try {
    result = await post(`${PROJECT}/functions/v1/delete-account`, {}, fresh.access_token);
  } catch (e) {
    throw passOn(e, 'Could not delete your account. Try again in a minute.');
  }
  if (result?.deleted !== true) throw new MarginError('SIGNIN', 'Could not delete your account. Try again in a minute.');
}

// Ends this session on the server. The access token lasts about an hour, so renew it first.
// Never throws: signing out on this computer must work offline too.
async function signOut(session) {
  try {
    const fresh = await post('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    await post('logout?scope=local', {}, fresh.access_token);
  } catch {
    /* the local copy is deleted by the caller either way */
  }
}

module.exports = { sendCode, verifyCode, signInWithGoogle, cancelGoogle, signOut, deleteAccount };
