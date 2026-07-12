import worker from '../src/worker.js';

const env = { MATCH_WAIT_MS: '0', JWT_SECRET: 'test-secret', GOOGLE_CLIENT_ID: 'google-client-id', GOOGLE_CLIENT_SECRET: 'google-client-secret', FRONTEND_URL: 'http://frontend.test' };
const base = 'http://worker.test';

async function json(path, options = {}, testEnv = env) {
  const res = await worker.fetch(new Request(base + path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  }), testEnv);
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

function authHeader(token) {
  return { Authorization: 'Bearer ' + token };
}

const emailStart = await worker.fetch(new Request(base + '/auth/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'ada@example.com' }),
}), env);
if (emailStart.status !== 410) throw new Error('email-code auth endpoint should be removed');

const startRes = await worker.fetch(new Request(base + '/auth/google/start?return_to=http%3A%2F%2Ffrontend.test%2F'), env);
if (startRes.status !== 302) throw new Error('Google OAuth start did not redirect');
const googleLocation = startRes.headers.get('Location');
const state = new URL(googleLocation).searchParams.get('state');
if (!state) throw new Error('Google OAuth state missing');

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href === 'https://oauth2.googleapis.com/token') {
    const body = new URLSearchParams(options.body);
    if (body.get('client_id') !== env.GOOGLE_CLIENT_ID || body.get('client_secret') !== env.GOOGLE_CLIENT_SECRET) throw new Error('Google client credentials not used');
    return new Response(JSON.stringify({ access_token: 'google-access-token', token_type: 'Bearer' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (href === 'https://www.googleapis.com/oauth2/v3/userinfo') {
    if (options.headers.Authorization !== 'Bearer google-access-token') throw new Error('Google access token not used');
    return new Response(JSON.stringify({ sub: 'google-sub-123', email: 'Ada@Example.com', email_verified: true, name: 'Ada Google', picture: 'https://example.com/avatar.png' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(url, options);
};

const callbackRes = await worker.fetch(new Request(base + '/auth/google/callback?state=' + encodeURIComponent(state) + '&code=fake-code'), env);
globalThis.fetch = realFetch;
if (callbackRes.status !== 302) throw new Error('Google OAuth callback did not redirect');
const callbackLocation = callbackRes.headers.get('Location');
const hash = new URL(callbackLocation).hash.replace(/^#/, '');
const token = new URLSearchParams(hash).get('auth_token');
if (!token) throw new Error('OAuth callback did not return auth token');

const meBeforeRegistration = await json('/me', { headers: authHeader(token) });
if (meBeforeRegistration.user.email !== 'ada@example.com' || meBeforeRegistration.user.name !== 'Ada Google') throw new Error('Google user was not persisted');

const profile = {
  name: 'Ada Tester', phone: '+65 9123 4567', gender: 'Female', age: '28', industry: 'Tech',
  vibe: 'Deep talks', energy: 'Balanced', topics: ['Food', 'AI'], area: 'East', budget: '$35-$50',
  diet: 'No restrictions', night: 'Thursday',
};
const created = await json('/registrations', { method: 'POST', headers: authHeader(token), body: profile });
if (created.registration.email !== 'ada@example.com' || created.registration.profile.phone !== '+65 9123 4567' || created.registration.profile.area !== 'East') throw new Error('registration was not persisted with email/profile');

let missingPhoneFailed = false;
try {
  await json('/registrations', { method: 'POST', headers: authHeader(token), body: { ...profile, phone: '' } });
} catch {
  missingPhoneFailed = true;
}
if (!missingPhoneFailed) throw new Error('phone number should be required');

const me = await json('/me', { headers: authHeader(token) });
if (me.registration.status !== 'matched' || me.registration.match.restaurant.area !== 'East') throw new Error('match/status did not resolve as expected');

const confirmed = await json('/match/confirm', { method: 'POST', headers: authHeader(token), body: { registrationId: me.registration.id } });
if (!confirmed.success || confirmed.registration.status !== 'confirmed') throw new Error('confirm failed');

console.log('backend Google OAuth + relational registration flow passed');
