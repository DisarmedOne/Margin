// Deletes the account of whoever is calling, and nobody else's.
// Runs on Supabase, where the secret key exists. It must never be copied into the app.
// Deploy under the name "delete-account" and leave "Verify JWT" on.
import { createClient } from 'npm:@supabase/supabase-js@2';

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

function secretKey(): string {
  const named = Deno.env.get('SUPABASE_SECRET_KEYS');
  return (named && JSON.parse(named).default) || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return reply(401, { error: 'Not signed in' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false } });
  // The id comes only from the verified token. Nothing in the request body is trusted.
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return reply(401, { error: 'Not signed in' });

  const { error: failed } = await admin.auth.admin.deleteUser(data.user.id);
  if (failed) {
    console.error(failed.message);
    return reply(500, { error: 'Could not delete the account' });
  }
  return reply(200, { deleted: true });
});
