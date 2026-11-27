// Steelfable account sign-in with emailed codes, through Supabase Auth's REST API.
const { MarginError } = require('./ai');

const AUTH = 'https://xtptqrzjiqstyxuoglbq.supabase.co/auth/v1';
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
    res = await fetch(`${AUTH}/${path}`, {
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
  const r = await post('verify', { type: 'email', email: address, token });
  return {
    email: r.user?.email ?? address,
    session: { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at },
  };
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

module.exports = { sendCode, verifyCode, signOut };
