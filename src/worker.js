const memory = new Map();

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
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
  });
}

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function base64UrlEncodeBytes(bytes) {
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeText(text) {
  return base64UrlEncodeBytes(new TextEncoder().encode(text));
}

function base64UrlDecodeText(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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
  if (!data.email) return null;
  return { email: data.email };
}

async function storeGet(binding, key) {
  if (binding?.get) return binding.get(key, 'json');
  return memory.get(key) || null;
}

async function storePut(binding, key, value, options = {}) {
  if (binding?.put) return binding.put(key, JSON.stringify(value), options);
  memory.set(key, value);
  return null;
}

function authCodeStore(env) { return env.AUTH_CODES; }
function sessionStore(env) { return env.SESSIONS; }
function registrationStore(env) { return env.REGISTRATIONS; }

function overlap(a = [], b = []) {
  return a.filter(x => b.includes(x)).length;
}

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
  const group = [{
    name: profile.name || 'You', gender: profile.gender, industry: profile.industry,
    age: Number(profile.age), vibe: profile.vibe, diet: profile.diet,
    energy: profile.energy, topics: profile.topics, persona: inferPersona(profile), isUser: true,
  }, ...ranked.slice(0, 5)];
  const areaRestaurants = restaurants.filter(r => r.area === profile.area);
  const pool = areaRestaurants.length ? areaRestaurants : restaurants;
  const restaurant = pool[(profile.industry.length + Number(profile.age || 0)) % pool.length];
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

async function requireUser(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  const user = await verifyToken(token, env);
  if (!user) return null;
  const session = await storeGet(sessionStore(env), `session:${token}`);
  if (!session) return null;
  return { ...user, token };
}

async function currentRegistration(email, env) {
  const reg = await storeGet(registrationStore(env), `registration:${email}`);
  if (!reg) return null;
  if (reg.status === 'pending' && Date.now() >= reg.matchAt) {
    reg.status = 'matched';
    reg.match = buildMatch(reg.profile);
    await storePut(registrationStore(env), `registration:${email}`, reg);
  }
  return reg;
}

async function handle(request, env = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';

  if (path === '/health') return json({ ok: true }, 200, request, env);
  if (path === '/restaurants' && request.method === 'GET') return json({ restaurants }, 200, request, env);

  if (path === '/auth/start' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Valid email is required' }, 400, request, env);
    const code = randomCode();
    await storePut(authCodeStore(env), `code:${email}`, { code, email, createdAt: Date.now() }, { expirationTtl: 600 });
    const payload = { ok: true, message: 'Sign-in code sent.' };
    if ((env.RETURN_DEV_CODES ?? 'true') === 'true') payload.devCode = code;
    return json(payload, 200, request, env);
  }

  if (path === '/auth/verify' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const code = String(body.code || '').trim();
    const saved = await storeGet(authCodeStore(env), `code:${email}`);
    if (!saved || saved.code !== code) return json({ error: 'Invalid or expired sign-in code' }, 401, request, env);
    const token = await createToken(email, env);
    const user = { email };
    await storePut(sessionStore(env), `session:${token}`, { email, createdAt: Date.now() }, { expirationTtl: 60 * 60 * 24 * 30 });
    const registration = await currentRegistration(email, env);
    return json({ token, user, registration }, 200, request, env);
  }

  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401, request, env);

  if (path === '/me' && request.method === 'GET') {
    return json({ user: { email: user.email }, registration: await currentRegistration(user.email, env) }, 200, request, env);
  }

  if (path === '/registrations/current' && request.method === 'GET') {
    return json({ registration: await currentRegistration(user.email, env) }, 200, request, env);
  }

  if (path === '/registrations' && request.method === 'POST') {
    const profile = await request.json().catch(() => ({}));
    if (!profile.name || !profile.area || !profile.budget) return json({ error: 'Name, area, and budget are required' }, 400, request, env);
    const createdAt = Date.now();
    const matchAt = createdAt + waitMs(profile, env);
    const registration = {
      id: crypto.randomUUID(), email: user.email, status: 'pending', profile,
      createdAt: new Date(createdAt).toISOString(), matchAt, updatedAt: new Date().toISOString(),
    };
    await storePut(registrationStore(env), `registration:${user.email}`, registration);
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
    registration.confirmedAt = new Date().toISOString();
    await storePut(registrationStore(env), `registration:${user.email}`, registration);
    return json({ success: true, registration, match: registration.match }, 200, request, env);
  }

  return json({ error: 'Not found' }, 404, request, env);
}

export default { fetch: handle };
export { handle as fetch };
