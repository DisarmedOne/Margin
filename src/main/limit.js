// The free paper limit. Every paper counts on this computer, so signing out gives nothing back.
// With an account it must also fit in the account's count in the database (supabase/papers.sql),
// which reinstalling Margin cannot reset. Only a fingerprint of the file is sent, never the file.
const crypto = require('node:crypto');
const { MarginError } = require('./ai');
const account = require('./account');

const fingerprint = (content) => crypto.createHash('sha256').update(content).digest('hex');

const full = (max) => new MarginError('LIMIT', 'You have used all {max} papers on this account. Papers you already added still work.', { max });

// If the count cannot be checked, no paper is read.
async function rpc(name, args, token) {
  let res;
  try {
    res = await fetch(`${account.PROJECT}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: account.KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(20e3),
    });
  } catch {
    throw new MarginError('OFFLINE', 'Cannot reach {name}. Check your internet connection.', { name: 'Steelfable' });
  }
  if (res.ok) return res.json();
  const body = await res.json().catch(() => null);
  if (res.status === 401 || body?.message === 'margin:signin') {
    throw new MarginError('SIGNIN', 'Your sign-in has expired. Sign out, then sign in again.');
  }
  throw new MarginError('SERVER', 'Could not check your paper limit. Try again later.');
}

function client(getToken) {
  const call = async (name, args) => rpc(name, args, await getToken());
  return {
    usage: () => call('paper_status', {}),
    // Before reading: is there a place for this file? `pending` counts other files still being read.
    async check(key, pending = 0) {
      const r = await call('paper_status', { p_fingerprint: key });
      if (!r.unlimited && !r.known && r.used + pending >= r.max) throw full(r.max);
      return r.known;
    },
    // After reading: take the place.
    async claim(key) {
      const r = await call('paper_claim', { p_fingerprint: key });
      if (r.error) throw full(r.max);
      return r;
    },
  };
}

const FREE_PAPERS = 3; // the same number as paper_max() in supabase/papers.sql

// This computer's count, in the list `used()` returns.
// shortcut: deleting Margin's data resets it; a shared AI key must require an account and count on the server.
function local(used, save, max = FREE_PAPERS) {
  const refuse = () => new MarginError('LIMIT', 'You have used all {max} papers. Papers you already added still work.', { max });
  return {
    usage: async () => ({ used: used().length, max }),
    async check(key, pending = 0) {
      const known = used().includes(key);
      if (!known && used().length + pending >= max) throw refuse();
      return known;
    },
    async claim(key) {
      if (!used().includes(key) && used().length >= max) throw refuse();
      return this.record(key);
    },
    // Counts a paper without asking whether there is room, for accounts without a limit.
    async record(key) {
      if (!used().includes(key)) {
        used().push(key);
        await save();
      }
      return { used: used().length, max };
    },
  };
}

// Signed in: a paper needs a free place on this computer and on the account.
function both(here, server) {
  return {
    async usage() {
      const [a, b] = [await here.usage(), await server.usage()];
      if (b.unlimited) return { used: a.used, max: a.max, unlimited: true };
      return { used: Math.max(a.used, b.used), max: Math.min(a.max, b.max) };
    },
    async check(key, pending = 0) {
      if ((await server.usage()).unlimited) return server.check(key, pending);
      const knownHere = await here.check(key, pending);
      const knownThere = await server.check(key, pending);
      return knownHere && knownThere;
    },
    async claim(key) {
      // The account decides whether it has no limit at all.
      const unlimited = (await server.usage()).unlimited;
      if (!unlimited) await here.check(key); // refused here, so no place is spent on the account
      await server.claim(key);
      return here.record(key);
    },
  };
}

module.exports = { FREE_PAPERS, client, local, both, fingerprint };
