import worker, { __test } from '../src/worker.js';

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

async function jsonExpectError(path, options = {}, testEnv = env) {
  const res = await worker.fetch(new Request(base + path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  }), testEnv);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function authHeader(token) {
  return { Authorization: 'Bearer ' + token };
}

async function signInAs(email, name) {
  const startRes = await worker.fetch(new Request(base + '/auth/google/start?return_to=http%3A%2F%2Ffrontend.test%2F'), env);
  const state = new URL(startRes.headers.get('Location')).searchParams.get('state');

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'google-access-token', token_type: 'Bearer' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (href === 'https://www.googleapis.com/oauth2/v3/userinfo') {
      return new Response(JSON.stringify({ sub: 'sub-' + email, email, email_verified: true, name }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, options);
  };
  const callbackRes = await worker.fetch(new Request(base + '/auth/google/callback?state=' + encodeURIComponent(state) + '&code=fake-code'), env);
  globalThis.fetch = realFetch;
  const hash = new URL(callbackRes.headers.get('Location')).hash.replace(/^#/, '');
  return new URLSearchParams(hash).get('auth_token');
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
  diet: 'No restrictions', night: 'Thursday', alcohol: 'Social drinker', language: 'English', smoking: 'Non-smoker',
};

// Field/gender validation, checked before ada has any registration on file.
let missingPhoneFailed = false;
try {
  await json('/registrations', { method: 'POST', headers: authHeader(token), body: { ...profile, phone: '' } });
} catch {
  missingPhoneFailed = true;
}
if (!missingPhoneFailed) throw new Error('phone number should be required');

const genderRejected = await jsonExpectError('/registrations', { method: 'POST', headers: authHeader(token), body: { ...profile, gender: 'Non-binary' } });
if (genderRejected.status !== 400) throw new Error('gender outside Male/Female should be rejected with 400');

const created = await json('/registrations', { method: 'POST', headers: authHeader(token), body: profile });
if (created.registration.email !== 'ada@example.com' || created.registration.profile.phone !== '+65 9123 4567' || created.registration.profile.area !== 'East') throw new Error('registration was not persisted with email/profile');

// Matching is now async/cron-driven — registering no longer instantly produces a match.
const meAfterRegistration = await json('/me', { headers: authHeader(token) });
if (meAfterRegistration.registration.status !== 'pending' || meAfterRegistration.registration.match !== null) {
  throw new Error('registration should stay pending with no match until the matcher-worker cron runs');
}

// Cannot submit a second registration while one is already active (pending here).
const duplicateWhilePending = await jsonExpectError('/registrations', { method: 'POST', headers: authHeader(token), body: profile });
if (duplicateWhilePending.status !== 400) throw new Error('registering again while a pending registration exists should be blocked');

// Confirming before a real match exists should fail, not fabricate one.
const confirmTooEarly = await jsonExpectError('/match/confirm', { method: 'POST', headers: authHeader(token), body: { registrationId: created.registration.id } });
if (confirmTooEarly.status !== 400) throw new Error('confirming before a real match exists should fail');

// Rejecting before a real match exists should also fail — there's nothing to reject yet.
const rejectTooEarly = await jsonExpectError('/match/reject', { method: 'POST', headers: authHeader(token), body: { registrationId: created.registration.id } });
if (rejectTooEarly.status !== 400) throw new Error('rejecting before a real match exists should fail');

// Simulate what matcher-worker would have written for this registration.
const groupId = 'group-test-1';
const eventAt = new Date(Date.now() - 6 * 3600000).toISOString(); // event already happened
const eventEndsAt = new Date(Date.now() - 4 * 3600000).toISOString(); // ended 4h ago — rating window (3h) already open
__test.seedMatchGroup(env, {
  groupId,
  restaurant: { id: 'r2', name: 'The Long Bar Table', area: 'East', cuisine: 'Mediterranean tapas', perk: 'Shared appetiser platter on the house' },
  eventAt,
  eventEndsAt,
  members: [
    { email: 'ada@example.com', registrationId: created.registration.id },
    { email: 'bo@example.com', registrationId: 'reg-bo' },
  ],
});

const meMatched = await json('/me', { headers: authHeader(token) });
if (meMatched.registration.status !== 'matched') throw new Error('seeded match should surface as matched');
if (!meMatched.registration.match || meMatched.registration.match.restaurant.area !== 'East') throw new Error('match/status did not resolve as expected from seeded group');
if (meMatched.registration.match.compatibility != null) throw new Error('real matches should not carry a fabricated compatibility score');
if (!meMatched.registration.match.eventAt || !meMatched.registration.match.ratingWindowOpensAt) throw new Error('match should expose eventAt/ratingWindowOpensAt');

// Still can't register again while matched but not yet confirmed/rejected.
const duplicateWhileMatched = await jsonExpectError('/registrations', { method: 'POST', headers: authHeader(token), body: profile });
if (duplicateWhileMatched.status !== 400) throw new Error('registering again while matched (not confirmed/rejected) should be blocked');

// Attendance cannot be set until the match is confirmed.
const attendanceBeforeConfirm = await jsonExpectError('/attendance', { method: 'POST', headers: authHeader(token), body: { groupId, status: 'on_time' } });
if (attendanceBeforeConfirm.status !== 400) throw new Error('attendance should be rejected before the match is confirmed');

const confirmed = await json('/match/confirm', { method: 'POST', headers: authHeader(token), body: { registrationId: created.registration.id } });
if (!confirmed.success || confirmed.registration.status !== 'confirmed') throw new Error('confirm failed');

// Attendance: since eventAt is already in the past for this seeded group, setting it should be rejected
// (now for the "event already started" reason rather than "not confirmed yet").
const attendanceTooLate = await jsonExpectError('/attendance', { method: 'POST', headers: authHeader(token), body: { groupId, status: 'on_time' } });
if (attendanceTooLate.status !== 400) throw new Error('attendance should be rejected once the event has started');

// Non-member cannot set attendance for a group they don't belong to.
const otherToken = await signInAs('carla@example.com', 'Carla Test');
const attendanceNonMember = await jsonExpectError('/attendance', { method: 'POST', headers: authHeader(otherToken), body: { groupId, status: 'on_time' } });
if (attendanceNonMember.status !== 404) throw new Error('non-member attendance update should 404');

// Ratings: the window is already open (eventEndsAt is > RATING_WINDOW_HOURS in the past).
const rateBo = await json('/ratings', { method: 'POST', headers: authHeader(token), body: { groupId, rateeRegistrationId: 'reg-bo', rating: 5, comment: 'Great company!' } });
if (!rateBo.success || rateBo.rating.rating !== 5) throw new Error('rating submission failed');

const ratingsMine = await json('/ratings/mine?groupId=' + groupId, { headers: authHeader(token) });
if (!ratingsMine.ratings.some(r => r.rateeRegistrationId === 'reg-bo' && r.rating === 5)) throw new Error('submitted rating should appear in /ratings/mine');

const selfRateRejected = await jsonExpectError('/ratings', { method: 'POST', headers: authHeader(token), body: { groupId, rateeRegistrationId: created.registration.id, rating: 5 } });
if (selfRateRejected.status !== 400) throw new Error('self-rating should be rejected');

// Ratings before the eligibility window (event not yet ended + 3h) should be rejected.
const futureGroupId = 'group-test-future';
__test.seedMatchGroup(env, {
  groupId: futureGroupId,
  restaurant: { id: 'r1', name: 'Neighbourhood Table', area: 'Central', cuisine: 'Modern Asian sharing plates', perk: 'Complimentary welcome drink for each guest' },
  eventAt: new Date(Date.now() + 3600000).toISOString(),
  eventEndsAt: new Date(Date.now() + 2 * 3600000).toISOString(),
  members: [
    { email: 'ada@example.com', registrationId: created.registration.id },
    { email: 'dee@example.com', registrationId: 'reg-dee' },
  ],
});
const ratingTooEarly = await jsonExpectError('/ratings', { method: 'POST', headers: authHeader(token), body: { groupId: futureGroupId, rateeRegistrationId: 'reg-dee', rating: 4 } });
if (ratingTooEarly.status !== 400) throw new Error('rating before the eligibility window should be rejected');

// --- Reject flow (separate user so it doesn't disturb ada's confirmed state above) ---

const ellenToken = await signInAs('ellen@example.com', 'Ellen Test');
const ellenProfile = { ...profile, name: 'Ellen Tester', phone: '+65 9000 9999', area: 'West' };
const ellenReg = await json('/registrations', { method: 'POST', headers: authHeader(ellenToken), body: ellenProfile });

const ellenRejectWhilePending = await jsonExpectError('/match/reject', { method: 'POST', headers: authHeader(ellenToken), body: { registrationId: ellenReg.registration.id } });
if (ellenRejectWhilePending.status !== 400) throw new Error('rejecting while only pending (no match yet) should fail');

const ellenGroupId = 'group-test-ellen';
__test.seedMatchGroup(env, {
  groupId: ellenGroupId,
  restaurant: { id: 'r4', name: 'Westside Noodle Room', area: 'West', cuisine: 'Modern noodles and small plates', perk: 'Dessert platter for the table' },
  eventAt: new Date(Date.now() + 3 * 86400000).toISOString(),
  eventEndsAt: new Date(Date.now() + 3 * 86400000 + 2 * 3600000).toISOString(),
  members: [
    { email: 'ellen@example.com', registrationId: ellenReg.registration.id },
    { email: 'frank@example.com', registrationId: 'reg-frank' },
  ],
});

const rejected = await json('/match/reject', { method: 'POST', headers: authHeader(ellenToken), body: { registrationId: ellenReg.registration.id } });
if (!rejected.success || rejected.registration.status !== 'rejected' || rejected.registration.matchedGroupId) {
  throw new Error('reject should flip status to rejected and clear matchedGroupId');
}

const ellenAttendanceAfterReject = await jsonExpectError('/attendance', { method: 'POST', headers: authHeader(ellenToken), body: { groupId: ellenGroupId, status: 'on_time' } });
if (ellenAttendanceAfterReject.status !== 404) throw new Error('attendance for a rejected/left group should 404');

const rejectAgain = await jsonExpectError('/match/reject', { method: 'POST', headers: authHeader(ellenToken), body: { registrationId: ellenReg.registration.id } });
if (rejectAgain.status !== 400) throw new Error('rejecting an already-rejected registration should fail');

const registerDuringCooldown = await jsonExpectError('/registrations', { method: 'POST', headers: authHeader(ellenToken), body: ellenProfile });
if (registerDuringCooldown.status !== 400 || !registerDuringCooldown.data.retryAt) {
  throw new Error('registering during the post-reject cooldown should be blocked and report a retryAt');
}

console.log('backend Google OAuth + relational registration + match/attendance/rating/reject flow passed');
