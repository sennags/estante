// Lirismo: Edge Function "excluir-conta". Apaga a conta de quem chama, com
// as capas no Storage. As linhas de `records` vão junto com a conta
// (on delete cascade, em supabase/schema.sql).
//
// No Supabase: Edge Functions → Deploy a new function → Via Editor, com o
// nome excluir-conta, colando este arquivo. Se mudar este arquivo, colar de
// novo. A chave secreta vem do próprio Supabase, sem configurar nada.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** The secret key: the legacy service_role, or the new sb_secret_ keys when those are on. */
function secretKey(): string | undefined {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    return keys.default ?? Object.values(keys)[0];
  } catch {
    return undefined;
  }
}

/** Removes every cover under {userId}/ (an account has at most 50). */
async function removeCovers(admin: ReturnType<typeof createClient>, userId: string) {
  for (let round = 0; round < 20; round++) {
    const { data, error } = await admin.storage.from('covers').list(userId, { limit: 100 });
    if (error) throw error;
    if (!data.length) return;
    const { error: removeError } = await admin.storage.from('covers').remove(data.map((f) => `${userId}/${f.name}`));
    if (removeError) throw removeError;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });

  const url = Deno.env.get('SUPABASE_URL');
  const key = secretKey();
  if (!url || !key) return reply(500, { error: 'not_configured' });
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Only the account in the token is deleted; the request carries nothing else.
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return reply(401, { error: 'no_token' });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return reply(401, { error: 'invalid_token' });
  const userId = data.user.id;

  try {
    // Covers first: if deleting the account fails, a new try still finds them.
    await removeCovers(admin, userId);
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;
  } catch (err) {
    console.error('excluir-conta', userId, err);
    return reply(500, { error: 'delete_failed' });
  }
  // A cover sent while the account was being deleted. The account is gone
  // already, so a failure here is only logged.
  await removeCovers(admin, userId).catch((err) => console.error('excluir-conta: capas depois', userId, err));
  return reply(200, { ok: true });
});
