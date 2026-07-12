const memory = {
  users: new Map(),
  sessions: new Map(),
  oauthStates: new Map(),
  registrations: new Map(),
};

export const restaurants = [
  { id: 'r1', name: 'Neighbourhood Table', area: 'Central', cuisine: 'Modern Asian sharing plates', perk: 'Complimentary welcome drink for each guest' },
  { id: 'r2', name: 'The Long Bar Table', area: 'East', cuisine: 'Mediterranean tapas', perk: 'Shared appetiser platter on the house' },
  { id: 'r3', name: 'Supper Club Social', area: 'CBD', cuisine: 'Casual bistro and cocktails', perk: 'Extended happy-hour pricing for the group' },
  { id: 'r4', name: 'Westside Noodle Room', area: 'West', cuisine: 'Modern noodles and small plates', perk: 'Dessert platter for the table' },
  { id: 'r5', name: 'North Garden Social', area: 'North', cuisine: 'Casual garden bistro', perk: 'Free zero-proof welcome spritz' },
  { id: 'r6', name: 'NEX Table Club', area: 'North-East', cuisine: 'Asian-European comfort plates', perk: 'Chef snack to share' },
];

export const sampleGuests = [
  { name: 'Alicia', gender: 'Female', industry: 'Product', age: 29, vibe: 'Deep talks', diet: 'No restrictions', energy: 'Balanced', topics: ['Startups','Travel','Food'], persona: 'Curious Builder' },
  { name: 'Marcus', gender: 'Male', industry: 'Finance', age: 31, vibe: 'Playful banter', diet: 'No pork', energy: 'Outgoing', topics: ['Markets','Fitness','Comedy'], persona: 'Social Strategist' },
  { name: 'Priya', gender: 'Female', industry: 'Healthcare', age: 28, vibe: 'Deep talks', diet: 'Vegetarian', energy: 'Calm', topics: ['Wellness','Books','Culture'], persona: 'Thoughtful Connector' },
  { name: 'Daniel', gender: 'Male', industry: 'Design', age: 34, vibe: 'Playful banter', diet: 'No restrictions', energy: 'Balanced', topics: ['Art','Music','Architecture'], persona: 'Creative Spark' },
  { name: 'Mei', gender: 'Female', industry: 'Tech', age: 27, vibe: 'New ideas', diet: 'No seafood', energy: 'Outgoing', topics: ['AI','Gaming','Travel'], persona: 'Future Tinkerer' },
  { name: 'Sam', gender: 'Non-binary', industry: 'Education', age: 32, vibe: 'Deep talks', diet: 'Halal-friendly', energy: 'Calm', topics: ['Language','Films','Social impact'], persona: 'Warm Facilitator' },
  { name: 'Theo', gender: 'Male', industry: 'Marketing', age: 30, vibe: 'Playful banter', diet: 'No restrictions', energy: 'Outgoing', topics: ['Brands','Nightlife','Sports'], persona: 'Conversation Starter' },
  { name: 'Nadia', gender: 'Female', industry: 'Law', age: 35, vibe: 'New ideas', diet: 'No beef', energy: 'Balanced', topics: ['Policy','Food','Theatre'], persona: 'Insight Hunter' },
  { name: 'Jun', gender: 'Male', industry: 'Engineering', age: 26, vibe: 'New ideas', diet: 'No restrictions', energy: 'Calm', topics: ['Robotics','Climbing','Coffee'], persona: 'Quiet Inventor' },
  { name: 'Farah', gender: 'Female', industry: 'Hospitality', age: 33, vibe: 'Playful banter', diet: 'Halal-friendly', energy: 'Outgoing', topics: ['Restaurants','Travel','Events'], persona: 'Host Energy' },
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
  };
}
async function getRegistration(env, email) {
  if (hasD1(env)) return parseRegistration(await env.DB.prepare('SELECT * FROM registrations WHERE email = ? ORDER BY created_at DESC LIMIT 1').bind(email).first());
  return memory.registrations.get(email) || null;
}
async function saveRegistration(env, reg) {
  reg.updatedAt = nowIso();
  if (hasD1(env)) {
    await env.DB.prepare(`INSERT INTO registrations (id, email, status, profile_json, match_json, created_at, updated_at, match_at, confirmed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, profile_json = excluded.profile_json, match_json = excluded.match_json, updated_at = excluded.updated_at, match_at = excluded.match_at, confirmed_at = excluded.confirmed_at`)
      .bind(reg.id, reg.email, reg.status, JSON.stringify(reg.profile), reg.match ? JSON.stringify(reg.match) : null, reg.createdAt, reg.updatedAt, reg.matchAt, reg.confirmedAt || null).run();
  } else memory.registrations.set(reg.email, reg);
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

function overlap(a = [], b = []) { return a.filter(x => b.includes(x)).length; }
function inferPersona(user) {
  if (user.energy === 'Outgoing' && user.vibe === 'Playful banter') return 'Room Igniter';
  if (user.vibe === 'Deep talks') return 'Meaning Maker';
  if (user.industry === 'Tech' || user.vibe === 'New ideas') return 'Idea Explorer';
  return 'Open Connector';
}
function scoreGuest(user, guest) {
  let score = 0;
  if (user.vibe === guest.vibe) score += 4;
  if (user.energy === guest.energy) score += 3;
  if (user.budget) score += 1;
  if (user.diet === guest.diet || guest.diet === 'No restrictions') score += 1;
  score += overlap(user.topics || [], guest.topics) * 2;
  score += Math.max(0, 3 - Math.abs(Number(user.age) - guest.age) / 4);
  return score;
}
export function buildMatch(profile) {
  const ranked = sampleGuests.map(g => ({ ...g, score: scoreGuest(profile, g) })).sort((a, b) => b.score - a.score);
  const group = [{ name: profile.name || 'You', gender: profile.gender, industry: profile.industry, age: Number(profile.age), vibe: profile.vibe, diet: profile.diet, energy: profile.energy, topics: profile.topics, persona: inferPersona(profile), isUser: true }, ...ranked.slice(0, 5)];
  const pool = restaurants.filter(r => r.area === profile.area);
  const restaurantPool = pool.length ? pool : restaurants;
  const restaurant = restaurantPool[(profile.industry.length + Number(profile.age || 0)) % restaurantPool.length];
  const compatibility = Math.min(97, Math.round(78 + ranked.slice(0, 5).reduce((sum, guest) => sum + guest.score, 0) / 5));
  return { group, restaurant, compatibility };
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
async function currentRegistration(email, env) {
  const reg = await getRegistration(env, email);
  if (!reg) return null;
  if (reg.status === 'pending' && Date.now() >= Number(reg.matchAt)) {
    reg.status = 'matched';
    reg.match = buildMatch(reg.profile);
    await saveRegistration(env, reg);
  }
  return reg;
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

  if (path === '/health') return json({ ok: true, storage: hasD1(env) ? 'd1' : 'memory' }, 200, request, env);
  if (path === '/restaurants' && request.method === 'GET') return json({ restaurants }, 200, request, env);

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

  if (path === '/me' && request.method === 'GET') return json({ user: { email: user.email, name: user.name }, registration: await currentRegistration(user.email, env) }, 200, request, env);
  if (path === '/registrations/current' && request.method === 'GET') return json({ registration: await currentRegistration(user.email, env) }, 200, request, env);

  if (path === '/registrations' && request.method === 'POST') {
    const profile = await request.json().catch(() => ({}));
    if (!profile.name || !profile.phone || !profile.area || !profile.budget) return json({ error: 'Name, phone number, area, and budget are required' }, 400, request, env);
    const created = Date.now();
    const registration = { id: crypto.randomUUID(), email: user.email, status: 'pending', profile, match: null, createdAt: nowIso(), updatedAt: nowIso(), matchAt: created + waitMs(profile, env), confirmedAt: null };
    await saveRegistration(env, registration);
    return json({ registration }, 200, request, env);
  }

  const statusMatch = path.match(/^\/registrations\/([^/]+)\/status$/);
  if (statusMatch && request.method === 'GET') {
    const registration = await currentRegistration(user.email, env);
    if (!registration || registration.id !== statusMatch[1]) return json({ error: 'Registration not found' }, 404, request, env);
    return json({ registration }, 200, request, env);
  }

  if (path === '/match/confirm' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const registration = await currentRegistration(user.email, env);
    if (!registration || registration.id !== body.registrationId) return json({ error: 'Registration not found' }, 404, request, env);
    if (registration.status !== 'matched' && registration.status !== 'confirmed') return json({ error: 'Match is not ready yet' }, 400, request, env);
    registration.status = 'confirmed';
    registration.match = registration.match || buildMatch(registration.profile);
    registration.confirmedAt = nowIso();
    await saveRegistration(env, registration);
    return json({ success: true, registration, match: registration.match }, 200, request, env);
  }

  return json({ error: 'Not found' }, 404, request, env);
}

export default { fetch: handle };
export { handle as fetch };
