import worker from '../src/worker.js';

const env = { RETURN_DEV_CODES: 'true', MATCH_WAIT_MS: '0', JWT_SECRET: 'test-secret' };
const base = 'http://worker.test';

async function json(path, options = {}) {
  const res = await worker.fetch(new Request(base + path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  }), env);
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const start = await json('/auth/start', { method: 'POST', body: { email: 'Ada@Example.com' } });
if (!start.devCode) throw new Error('auth/start did not return a dev code');

const verified = await json('/auth/verify', { method: 'POST', body: { email: 'ada@example.com', code: start.devCode } });
if (!verified.token || verified.user.email !== 'ada@example.com') throw new Error('auth/verify failed');

const auth = { Authorization: 'Bearer ' + verified.token };
const profile = {
  name: 'Ada Tester', phone: '+65 9123 4567', gender: 'Female', age: '28', industry: 'Tech',
  vibe: 'Deep talks', energy: 'Balanced', topics: ['Food', 'AI'], area: 'East', budget: '$35-$50',
  diet: 'No restrictions', night: 'Thursday',
};
const created = await json('/registrations', { method: 'POST', headers: auth, body: profile });
if (created.registration.email !== 'ada@example.com' || created.registration.profile.area !== 'East') throw new Error('registration was not tagged to email/profile');

const me = await json('/me', { headers: auth });
if (me.registration.status !== 'matched' || me.registration.match.restaurant.area !== 'East') throw new Error('match/status did not resolve as expected');

const confirmed = await json('/match/confirm', { method: 'POST', headers: auth, body: { registrationId: me.registration.id } });
if (!confirmed.success || confirmed.registration.status !== 'confirmed') throw new Error('confirm failed');

console.log('backend auth/register/status/confirm flow passed');
