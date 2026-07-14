const memory = {
  users: new Map(),
  sessions: new Map(),
  oauthStates: new Map(),
  registrations: new Map(),
  matchGroups: new Map(),
  matchGroupMembers: new Map(),
  ratings: new Map(),
};

export const defaultRestaurants = [
  { id: 'r1', name: 'Neighbourhood Table', area: 'Central', cuisine: 'Modern Asian sharing plates', perk: 'Complimentary welcome drink for each guest' },
  { id: 'r2', name: 'The Long Bar Table', area: 'East', cuisine: 'Mediterranean tapas', perk: 'Shared appetiser platter on the house' },
  { id: 'r3', name: 'Supper Club Social', area: 'CBD', cuisine: 'Casual bistro and cocktails', perk: 'Extended happy-hour pricing for the group' },
  { id: 'r4', name: 'Westside Noodle Room', area: 'West', cuisine: 'Modern noodles and small plates', perk: 'Dessert platter for the table' },
  { id: 'r5', name: 'North Garden Social', area: 'North', cuisine: 'Casual garden bistro', perk: 'Free zero-proof welcome spritz' },
  { id: 'r6', name: 'NEX Table Club', area: 'North-East', cuisine: 'Asian-European comfort plates', perk: 'Chef snack to share' },
];

function corsHeaders(request, env = {}) {
  const origin = request.headers.get('Origin') || '*';
  const allowed = env.FRONTEND_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': allowed === '*' ? origin : allowed,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status = 200, request = new Request('https://local'), env = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) } });
}

function normalizeEmail(email = '') { return String(email).trim().toLowerCase(); }
function nowIso() { return new Date().toISOString(); }
function authPrefix() { return 'Bear' + 'er '; }
function tokenFromHeader(request) { return (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''); }

function base64UrlEncodeBytes(bytes) {
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function base64UrlEncodeText(text) { return base64UrlEncodeBytes(new TextEncoder().encode(text)); }
function base64UrlDecodeText(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}
async function signPayload(payload, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}
async function createToken(email, env) {
  const payload = base64UrlEncodeText(JSON.stringify({ email, iat: Date.now() }));
  const signature = await signPayload(payload, env.JWT_SECRET || 'dev-secret-change-me');
  return `${payload}.${signature}`;
}
async function verifyToken(token, env) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = await signPayload(payload, env.JWT_SECRET || 'dev-secret-change-me');
  if (expected !== signature) return null;
  const data = JSON.parse(base64UrlDecodeText(payload));
  return data.email ? { email: data.email } : null;
}

function hasD1(env) { return Boolean(env.DB?.prepare); }

async function getUser(env, email) {
  if (hasD1(env)) return env.DB.prepare('SELECT email, name, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE email = ?').bind(email).first();
  return memory.users.get(email) || null;
}
async function upsertUser(env, user) {
  const existing = await getUser(env, user.email);
  const record = { email: user.email, name: user.name || existing?.name || '', updatedAt: nowIso(), createdAt: existing?.createdAt || nowIso() };
  if (hasD1(env)) {
    await env.DB.prepare(`INSERT INTO users (email, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`)
      .bind(record.email, record.name, record.createdAt, record.updatedAt).run();
  } else memory.users.set(record.email, record);
  return record;
}
async function saveSession(env, token, email) {
  const record = { token, email, createdAt: nowIso(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() };
  if (hasD1(env)) await env.DB.prepare('INSERT INTO sessions (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(record.token, record.email, record.createdAt, record.expiresAt).run();
  else memory.sessions.set(token, record);
  return record;
}
async function getSession(env, token) {
  if (hasD1(env)) return env.DB.prepare('SELECT token, email, created_at AS createdAt, expires_at AS expiresAt FROM sessions WHERE token = ? AND expires_at > ?').bind(token, nowIso()).first();
  const session = memory.sessions.get(token);
  return session && session.expiresAt > nowIso() ? session : null;
}
async function saveOauthState(env, nonce, returnTo) {
  const record = { nonce, returnTo, createdAt: nowIso(), expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
  if (hasD1(env)) await env.DB.prepare('INSERT INTO oauth_states (nonce, return_to, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(record.nonce, record.returnTo, record.createdAt, record.expiresAt).run();
  else memory.oauthStates.set(nonce, record);
  return record;
}
async function takeOauthState(env, nonce) {
  let state;
  if (hasD1(env)) {
    state = await env.DB.prepare('SELECT nonce, return_to AS returnTo, created_at AS createdAt, expires_at AS expiresAt FROM oauth_states WHERE nonce = ? AND expires_at > ?').bind(nonce, nowIso()).first();
    await env.DB.prepare('DELETE FROM oauth_states WHERE nonce = ?').bind(nonce).run();
  } else {
    state = memory.oauthStates.get(nonce);
    memory.oauthStates.delete(nonce);
  }
  return state && state.expiresAt > nowIso() ? state : null;
}
function parseRegistration(row) {
  if (!row) return null;
  return {
    id: row.id, email: row.email, status: row.status,
    profile: typeof row.profile_json === 'string' ? JSON.parse(row.profile_json) : row.profile,
    match: row.match_json ? JSON.parse(row.match_json) : row.match || null,
    createdAt: row.created_at || row.createdAt, updatedAt: row.updated_at || row.updatedAt,
    matchAt: row.match_at || row.matchAt, confirmedAt: row.confirmed_at || row.confirmedAt || null,
    rejectedAt: row.rejected_at || row.rejectedAt || null,
    matchedGroupId: row.matched_group_id ?? row.matchedGroupId ?? null,
    dinnerType: row.dinner_type || row.dinnerType || 'social',
  };
}
function memoryRegKey(email, dinnerType) { return `${email}:${dinnerType}`; }
// Each user can have one active registration per dinner type at a time —
// mutually exclusive within a type, independent across types — so lookups
// are always scoped by (email, dinnerType).
async function getRegistration(env, email, dinnerType) {
  if (hasD1(env)) return parseRegistration(await env.DB.prepare('SELECT * FROM registrations WHERE email = ? AND dinner_type = ? ORDER BY created_at DESC LIMIT 1').bind(email, dinnerType).first());
  return memory.registrations.get(memoryRegKey(email, dinnerType)) || null;
}
async function getRegistrationById(env, id) {
  if (!id) return null;
  if (hasD1(env)) return parseRegistration(await env.DB.prepare('SELECT * FROM registrations WHERE id = ?').bind(id).first());
  for (const reg of memory.registrations.values()) if (reg.id === id) return reg;
  return null;
}
async function getRegistrationInGroup(env, email, groupId) {
  if (!groupId) return null;
  if (hasD1(env)) return parseRegistration(await env.DB.prepare('SELECT * FROM registrations WHERE email = ? AND matched_group_id = ?').bind(email, groupId).first());
  for (const reg of memory.registrations.values()) if (reg.email === email && reg.matchedGroupId === groupId) return reg;
  return null;
}
async function saveRegistration(env, reg) {
  reg.updatedAt = nowIso();
  if (hasD1(env)) {
    await env.DB.prepare(`INSERT INTO registrations (id, email, status, profile_json, match_json, created_at, updated_at, match_at, confirmed_at, rejected_at, matched_group_id, dinner_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, profile_json = excluded.profile_json, match_json = excluded.match_json, updated_at = excluded.updated_at, match_at = excluded.match_at, confirmed_at = excluded.confirmed_at, rejected_at = excluded.rejected_at, matched_group_id = excluded.matched_group_id, dinner_type = excluded.dinner_type`)
      .bind(reg.id, reg.email, reg.status, JSON.stringify(reg.profile), reg.match ? JSON.stringify(reg.match) : null, reg.createdAt, reg.updatedAt, reg.matchAt, reg.confirmedAt || null, reg.rejectedAt || null, reg.matchedGroupId || null, reg.dinnerType || 'social').run();
  } else memory.registrations.set(memoryRegKey(reg.email, reg.dinnerType || 'social'), reg);
  return reg;
}

async function requireUser(request, env) {
  const token = tokenFromHeader(request);
  const verified = await verifyToken(token, env);
  if (!verified) return null;
  const session = await getSession(env, token);
  if (!session) return null;
  const profile = await getUser(env, verified.email);
  return { email: verified.email, token, name: profile?.name || '' };
}

function inferPersona(user) {
  if (user.energy === 'Outgoing' && user.vibe === 'Playful banter') return 'Room Igniter';
  if (user.vibe === 'Deep talks') return 'Meaning Maker';
  if (user.industry === 'Tech' || user.vibe === 'New ideas') return 'Idea Explorer';
  return 'Open Connector';
}

async function getRestaurants(env) {
  if (hasD1(env)) {
    const res = await env.DB.prepare('SELECT id, name, area, cuisine, perk FROM restaurants WHERE active = 1 ORDER BY id').all();
    return res.results || [];
  }
  return defaultRestaurants;
}

async function getMatchGroup(env, groupId) {
  if (!groupId) return null;
  if (hasD1(env)) return env.DB.prepare('SELECT * FROM match_groups WHERE id = ?').bind(groupId).first();
  return memory.matchGroups.get(groupId) || null;
}

async function getMatchGroupMembers(env, groupId) {
  if (hasD1(env)) {
    const res = await env.DB.prepare(`
      SELECT mgm.group_id AS groupId, mgm.email AS email, mgm.registration_id AS registrationId,
             mgm.attendance_status AS attendanceStatus, r.profile_json AS profileJson, r.status AS registrationStatus
      FROM match_group_members mgm
      JOIN registrations r ON r.id = mgm.registration_id
      WHERE mgm.group_id = ?
    `).bind(groupId).all();
    return res.results || [];
  }
  const members = memory.matchGroupMembers.get(groupId) || [];
  return members.map(m => {
    let reg = null;
    for (const candidate of memory.registrations.values()) if (candidate.id === m.registrationId) { reg = candidate; break; }
    return { ...m, profileJson: reg ? JSON.stringify(reg.profile) : '{}', registrationStatus: reg?.status };
  });
}

async function findMembership(env, groupId, email) {
  if (hasD1(env)) return env.DB.prepare('SELECT * FROM match_group_members WHERE group_id = ? AND email = ?').bind(groupId, email).first();
  const members = memory.matchGroupMembers.get(groupId) || [];
  return members.find(m => m.email === email) || null;
}

// Mirrors matcher-worker's shouldUnmatch/unmatchGroup: a table is no longer
// viable once enough members won't show. The matcher-worker cron performs
// the same check as a backstop every cycle, but we don't want a user to
// wait up to that cadence to see their table dissolve — check and act
// immediately whenever an attendance update could have crossed the threshold.
async function unmatchGroupNow(env, groupId, members) {
  const now = nowIso();
  if (hasD1(env)) {
    const statements = [
      env.DB.prepare(`UPDATE match_groups SET status = 'cancelled', updated_at = ? WHERE id = ?`).bind(now, groupId),
    ];
    for (const m of members) {
      statements.push(
        env.DB.prepare(`UPDATE registrations SET status = 'pending', matched_group_id = NULL, updated_at = ?
          WHERE id = ? AND status IN ('matched', 'confirmed')`).bind(now, m.registrationId),
      );
      statements.push(
        env.DB.prepare(`UPDATE users SET match_status = 'unmatched', matched_group_id = NULL, matched_at = NULL
          WHERE email = ?`).bind(m.email),
      );
    }
    await env.DB.batch(statements);
  } else {
    const group = memory.matchGroups.get(groupId);
    if (group) group.status = 'cancelled';
    for (const m of members) {
      let reg = null;
      for (const candidate of memory.registrations.values()) if (candidate.id === m.registrationId) { reg = candidate; break; }
      if (reg && (reg.status === 'matched' || reg.status === 'confirmed')) {
        reg.status = 'pending';
        reg.matchedGroupId = null;
      }
    }
  }
}
async function maybeUnmatchGroup(env, groupId) {
  const threshold = Number(env.MAX_NOT_SHOWING || 2);
  const members = await getMatchGroupMembers(env, groupId);
  const notShowing = members.filter(m => m.attendanceStatus === 'not_showing').length;
  if (notShowing >= threshold) {
    await unmatchGroupNow(env, groupId, members);
    return true;
  }
  return false;
}

async function loadMatchForRegistration(env, reg) {
  if (!reg.matchedGroupId) return null;
  const group = await getMatchGroup(env, reg.matchedGroupId);
  if (!group) return null;
  const members = await getMatchGroupMembers(env, group.id);
  const restaurant = JSON.parse(group.restaurant_json || group.restaurantJson || 'null');
  const eventAt = group.event_at || group.eventAt || null;
  const eventEndsAt = group.event_ends_at || group.eventEndsAt || null;
  const ratingWindowHours = Number(env.RATING_WINDOW_HOURS || 3);
  const ratingWindowOpensAt = eventEndsAt ? new Date(new Date(eventEndsAt).getTime() + ratingWindowHours * 3600000).toISOString() : null;
  return {
    groupId: group.id,
    restaurant,
    eventAt,
    eventEndsAt,
    ratingWindowOpensAt,
    dinnerType: reg.profile?.dinnerType || 'social',
    group: members.map(m => {
      const profile = typeof m.profileJson === 'string' ? JSON.parse(m.profileJson) : (m.profile || {});
      return {
        registrationId: m.registrationId,
        name: profile.name, industry: profile.industry, gender: profile.gender,
        vibe: profile.vibe, energy: profile.energy, topics: profile.topics,
        networkingGoal: profile.networkingGoal || null,
        persona: inferPersona(profile), isUser: m.email === reg.email,
        attendanceStatus: m.attendanceStatus || 'unknown',
        confirmed: m.registrationStatus === 'confirmed',
      };
    }),
  };
}

function waitMs(profile, env) {
  if (env.MATCH_WAIT_MS) return Number(env.MATCH_WAIT_MS);
  const min = Number(env.MATCH_WAIT_DAYS_MIN || 2) * 86_400_000;
  const max = Number(env.MATCH_WAIT_DAYS_MAX || 4) * 86_400_000;
  const seed = `${profile.area}:${profile.budget}:${profile.night}:${profile.name}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return min + (hash % Math.max(1, max - min));
}
async function attachMatch(env, reg) {
  if (!reg) return reg;
  if (reg.matchedGroupId && (reg.status === 'matched' || reg.status === 'confirmed')) {
    reg.match = await loadMatchForRegistration(env, reg);
  } else {
    reg.match = null;
  }
  return reg;
}
async function currentRegistration(email, dinnerType, env) {
  const reg = await getRegistration(env, email, dinnerType);
  if (!reg) return null;
  return attachMatch(env, reg);
}

async function verifyTurnstile(token, remoteIp, env) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token || '', remoteip: remoteIp || '' });
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  return Boolean(data.success);
}

function backendBase(request, env) { return env.PUBLIC_BACKEND_URL || new URL(request.url).origin; }
function oauthRedirectUri(request, env) { return env.GOOGLE_REDIRECT_URI || `${backendBase(request, env)}/auth/google/callback`; }
function safeReturnTo(value, env) {
  const fallback = env.FRONTEND_URL || 'https://dinner-six.shijanhoo.workers.dev';
  try {
    const url = new URL(value || fallback);
    const allowed = (env.ALLOWED_RETURN_ORIGINS || env.FRONTEND_URL || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!allowed.length || allowed.includes(url.origin)) return `${url.origin}${url.pathname}${url.search}`;
  } catch {}
  return fallback;
}
async function exchangeGoogleCode(code, request, env) {
  const body = new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID || '', client_secret: env.GOOGLE_CLIENT_SECRET || '', redirect_uri: oauthRedirectUri(request, env), grant_type: 'authorization_code' });
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) throw new Error(token.error_description || token.error || 'Google token exchange failed');
  const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: authPrefix() + token.access_token } });
  const info = await infoRes.json().catch(() => ({}));
  if (!infoRes.ok) throw new Error(info.error_description || info.error || 'Could not read Google profile');
  if (!info.email || info.email_verified === false) throw new Error('Google account email must be verified');
  return { email: normalizeEmail(info.email), name: info.name || '' };
}
function redirectWithHash(returnTo, params) {
  const url = new URL(returnTo);
  url.hash = new URLSearchParams(params).toString();
  return Response.redirect(url.toString(), 302);
}

async function handle(request, env = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';

  if (path === '/health') return json({ ok: true, storage: hasD1(env) ? 'd1' : 'memory', captchaEnabled: Boolean(env.TURNSTILE_SECRET_KEY) }, 200, request, env);
  if (path === '/restaurants' && request.method === 'GET') return json({ restaurants: await getRestaurants(env) }, 200, request, env);

  if (path === '/admin/reset' && request.method === 'POST') {
    if (!env.ADMIN_API_KEY || request.headers.get('X-Admin-Key') !== env.ADMIN_API_KEY) {
      return json({ error: 'Not found' }, 404, request, env);
    }
    if (hasD1(env)) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM ratings'),
        env.DB.prepare('DELETE FROM match_group_members'),
        env.DB.prepare('DELETE FROM match_groups'),
        env.DB.prepare('DELETE FROM registrations'),
        env.DB.prepare('DELETE FROM sessions'),
        env.DB.prepare('DELETE FROM oauth_states'),
        env.DB.prepare('DELETE FROM users'),
      ]);
    } else {
      memory.ratings.clear();
      memory.matchGroupMembers.clear();
      memory.matchGroups.clear();
      memory.registrations.clear();
      memory.sessions.clear();
      memory.oauthStates.clear();
      memory.users.clear();
    }
    return json({ success: true, storage: hasD1(env) ? 'd1' : 'memory' }, 200, request, env);
  }

  if (path === '/auth/google/start' && request.method === 'GET') {
    if (!env.GOOGLE_CLIENT_ID) return json({ error: 'GOOGLE_CLIENT_ID is not configured' }, 500, request, env);
    const returnTo = safeReturnTo(url.searchParams.get('return_to'), env);
    const nonce = crypto.randomUUID();
    await saveOauthState(env, nonce, returnTo);
    const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    google.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: oauthRedirectUri(request, env), response_type: 'code', scope: 'openid email profile', state: nonce, prompt: 'select_account' }).toString();
    return Response.redirect(google.toString(), 302);
  }

  if (path === '/auth/google/callback' && request.method === 'GET') {
    const state = await takeOauthState(env, url.searchParams.get('state') || '');
    const returnTo = state?.returnTo || safeReturnTo('', env);
    try {
      if (!state) throw new Error('OAuth session expired. Please try again.');
      const code = url.searchParams.get('code');
      if (!code) throw new Error(url.searchParams.get('error') || 'Missing Google OAuth code');
      const googleUser = await exchangeGoogleCode(code, request, env);
      const user = await upsertUser(env, googleUser);
      const token = await createToken(user.email, env);
      await saveSession(env, token, user.email);
      return redirectWithHash(returnTo, { auth_token: token });
    } catch (error) {
      return redirectWithHash(returnTo, { auth_error: error.message || 'Google sign-in failed' });
    }
  }

  if ((path === '/auth/start' || path === '/auth/verify') && request.method === 'POST') {
    return json({ error: 'Email-code sign-in has been removed. Use Google OAuth.' }, 410, request, env);
  }

  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401, request, env);

  if (path === '/me' && request.method === 'GET') {
    const [social, professional] = await Promise.all([
      currentRegistration(user.email, 'social', env),
      currentRegistration(user.email, 'professional', env),
    ]);
    return json({ user: { email: user.email, name: user.name }, registrations: { social, professional } }, 200, request, env);
  }
  if (path === '/registrations/current' && request.method === 'GET') {
    const dinnerType = url.searchParams.get('dinnerType') === 'professional' ? 'professional' : 'social';
    return json({ registration: await currentRegistration(user.email, dinnerType, env) }, 200, request, env);
  }

  if (path === '/registrations' && request.method === 'POST') {
    const profile = await request.json().catch(() => ({}));
    const remoteIp = request.headers.get('CF-Connecting-IP');
    const turnstileOk = await verifyTurnstile(profile.turnstileToken, remoteIp, env);
    if (!turnstileOk) return json({ error: 'Captcha verification failed. Please try again.' }, 400, request, env);
    delete profile.turnstileToken;
    if (!profile.name || !profile.phone || !profile.area || !profile.budget) return json({ error: 'Name, phone number, area, and budget are required' }, 400, request, env);
    if (profile.gender && !['Male', 'Female'].includes(profile.gender)) return json({ error: 'Gender must be Male or Female' }, 400, request, env);
    if (profile.dinnerType && !['social', 'professional'].includes(profile.dinnerType)) return json({ error: 'Dinner type must be social or professional' }, 400, request, env);
    if (!profile.dinnerType) profile.dinnerType = 'social';

    // Mutually exclusive within a dinner type, independent across types — a
    // user can have one active social AND one active professional
    // registration at the same time.
    const existing = await getRegistration(env, user.email, profile.dinnerType);
    if (existing) {
      if (['pending', 'matched', 'confirmed'].includes(existing.status)) {
        return json({ error: 'You already have an active registration for this dinner type. Confirm or reject your current table before registering again.' }, 400, request, env);
      }
      if (existing.status === 'rejected' && existing.rejectedAt) {
        const cooldownMs = Number(env.REJECT_COOLDOWN_HOURS || 6) * 3600000;
        const retryAt = new Date(existing.rejectedAt).getTime() + cooldownMs;
        if (Date.now() < retryAt) {
          return json({ error: 'You can register again 6 hours after rejecting a table.', retryAt: new Date(retryAt).toISOString() }, 400, request, env);
        }
      }
    }

    const created = Date.now();
    const registration = {
      id: crypto.randomUUID(), email: user.email, status: 'pending', profile, match: null,
      createdAt: nowIso(), updatedAt: nowIso(), matchAt: created + waitMs(profile, env),
      confirmedAt: null, rejectedAt: null, matchedGroupId: null, dinnerType: profile.dinnerType,
    };
    await saveRegistration(env, registration);
    return json({ registration }, 200, request, env);
  }

  const statusMatch = path.match(/^\/registrations\/([^/]+)\/status$/);
  if (statusMatch && request.method === 'GET') {
    const registration = await getRegistrationById(env, statusMatch[1]);
    if (!registration || registration.email !== user.email) return json({ error: 'Registration not found' }, 404, request, env);
    await attachMatch(env, registration);
    return json({ registration }, 200, request, env);
  }

  if (path === '/match/confirm' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const registration = await getRegistrationById(env, body.registrationId);
    if (!registration || registration.email !== user.email) return json({ error: 'Registration not found' }, 404, request, env);
    await attachMatch(env, registration);
    if (registration.status !== 'matched' && registration.status !== 'confirmed') return json({ error: 'Match is not ready yet' }, 400, request, env);
    if (!registration.match) return json({ error: 'Match is not ready yet' }, 400, request, env);
    registration.status = 'confirmed';
    registration.confirmedAt = nowIso();
    await saveRegistration(env, registration);
    return json({ success: true, registration, match: registration.match }, 200, request, env);
  }

  if (path === '/match/reject' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const registration = await getRegistrationById(env, body.registrationId);
    if (!registration || registration.email !== user.email) return json({ error: 'Registration not found' }, 404, request, env);
    if (registration.status !== 'matched') return json({ error: 'Only a pending match offer can be rejected' }, 400, request, env);
    const groupId = registration.matchedGroupId;
    if (hasD1(env)) {
      await env.DB.prepare('DELETE FROM match_group_members WHERE group_id = ? AND email = ?').bind(groupId, user.email).run();
    } else {
      const members = memory.matchGroupMembers.get(groupId) || [];
      memory.matchGroupMembers.set(groupId, members.filter(m => m.email !== user.email));
    }
    registration.status = 'rejected';
    registration.rejectedAt = nowIso();
    registration.matchedGroupId = null;
    registration.match = null;
    await saveRegistration(env, registration);
    return json({ success: true, registration }, 200, request, env);
  }

  if (path === '/attendance' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const allowedStatus = ['on_time', 'late', 'not_showing'];
    if (!allowedStatus.includes(body.status)) return json({ error: 'status must be one of on_time, late, not_showing' }, 400, request, env);
    const registration = await getRegistrationInGroup(env, user.email, body.groupId);
    if (!registration) return json({ error: 'Not a member of this group' }, 404, request, env);
    if (registration.status !== 'confirmed') return json({ error: 'Confirm your spot before setting attendance' }, 400, request, env);
    const group = await getMatchGroup(env, body.groupId);
    if (!group) return json({ error: 'Match group not found' }, 404, request, env);
    const eventAt = group.event_at || group.eventAt;
    if (eventAt && Date.now() >= new Date(eventAt).getTime()) return json({ error: 'Attendance can only be set before the event' }, 400, request, env);
    const updatedAt = nowIso();
    if (hasD1(env)) {
      await env.DB.prepare('UPDATE match_group_members SET attendance_status = ?, attendance_updated_at = ? WHERE group_id = ? AND email = ?')
        .bind(body.status, updatedAt, body.groupId, user.email).run();
    } else {
      const members = memory.matchGroupMembers.get(body.groupId) || [];
      const member = members.find(m => m.email === user.email);
      if (member) { member.attendanceStatus = body.status; member.attendanceUpdatedAt = updatedAt; }
    }
    let groupUnmatched = false;
    if (body.status === 'not_showing') {
      groupUnmatched = await maybeUnmatchGroup(env, body.groupId);
    }
    return json({ success: true, attendanceStatus: body.status, groupUnmatched }, 200, request, env);
  }

  if (path === '/ratings' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json({ error: 'rating must be an integer from 1 to 5' }, 400, request, env);
    const group = await getMatchGroup(env, body.groupId);
    if (!group) return json({ error: 'Match group not found' }, 404, request, env);
    const raterMembership = await findMembership(env, body.groupId, user.email);
    if (!raterMembership) return json({ error: 'Not a member of this group' }, 404, request, env);
    const members = await getMatchGroupMembers(env, body.groupId);
    const ratee = members.find(m => m.registrationId === body.rateeRegistrationId);
    if (!ratee) return json({ error: 'Rated member not found in this group' }, 404, request, env);
    if (ratee.email === user.email) return json({ error: 'Cannot rate yourself' }, 400, request, env);
    const eventEndsAt = group.event_ends_at || group.eventEndsAt;
    const ratingWindowHours = Number(env.RATING_WINDOW_HOURS || 3);
    const opensAt = eventEndsAt ? new Date(eventEndsAt).getTime() + ratingWindowHours * 3600000 : Infinity;
    if (Date.now() < opensAt) return json({ error: `Ratings open ${ratingWindowHours} hours after the event ends` }, 400, request, env);
    const createdAt = nowIso();
    const comment = typeof body.comment === 'string' ? body.comment.slice(0, 500) : null;
    if (hasD1(env)) {
      await env.DB.prepare(`INSERT INTO ratings (id, group_id, rater_email, ratee_email, rating, comment, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(group_id, rater_email, ratee_email) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, created_at = excluded.created_at`)
        .bind(crypto.randomUUID(), body.groupId, user.email, ratee.email, rating, comment, createdAt).run();
    } else {
      memory.ratings.set(`${body.groupId}:${user.email}:${ratee.email}`, { groupId: body.groupId, raterEmail: user.email, rateeEmail: ratee.email, rating, comment, createdAt });
    }
    return json({ success: true, rating: { rateeRegistrationId: body.rateeRegistrationId, rating, comment } }, 200, request, env);
  }

  if (path === '/ratings/mine' && request.method === 'GET') {
    const groupId = url.searchParams.get('groupId') || '';
    const members = await getMatchGroupMembers(env, groupId);
    let rows;
    if (hasD1(env)) {
      const res = await env.DB.prepare('SELECT ratee_email AS rateeEmail, rating, comment FROM ratings WHERE group_id = ? AND rater_email = ?').bind(groupId, user.email).all();
      rows = res.results || [];
    } else {
      rows = [...memory.ratings.values()].filter(r => r.groupId === groupId && r.raterEmail === user.email);
    }
    const ratings = rows.map(r => {
      const member = members.find(m => m.email === r.rateeEmail);
      return { rateeRegistrationId: member?.registrationId || null, rating: r.rating, comment: r.comment };
    });
    return json({ ratings }, 200, request, env);
  }

  return json({ error: 'Not found' }, 404, request, env);
}

export const __test = {
  seedMatchGroup(env, { groupId, restaurant, eventAt, eventEndsAt, members }) {
    const now = nowIso();
    memory.matchGroups.set(groupId, {
      id: groupId, status: 'matched', memberCount: members.length, algorithmVersion: 'test',
      restaurantJson: JSON.stringify(restaurant), eventAt, eventEndsAt, createdAt: now, updatedAt: now,
    });
    memory.matchGroupMembers.set(groupId, members.map(m => ({
      groupId, email: m.email, registrationId: m.registrationId, attendanceStatus: 'unknown', createdAt: now,
    })));
    for (const m of members) {
      let reg = null;
      for (const candidate of memory.registrations.values()) {
        if (candidate.id === m.registrationId || candidate.email === m.email) { reg = candidate; break; }
      }
      if (reg) { reg.status = 'matched'; reg.matchedGroupId = groupId; }
    }
  },
};

export default { fetch: handle };
export { handle as fetch };
