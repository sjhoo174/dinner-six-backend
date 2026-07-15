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
if (meAfterRegistration.registrations.social.status !== 'pending' || meAfterRegistration.registrations.social.match !== null) {
  throw new Error('registration should stay pending with no match until the matcher-worker cron runs');
}
if (meAfterRegistration.registrations.professional !== null) throw new Error('the professional track should be untouched by a social registration');

// Cannot submit a second registration while one is already active (pending here).
const duplicateWhilePending = await jsonExpectError('/registrations', { method: 'POST', headers: authHeader(token), body: profile });
if (duplicateWhilePending.status !== 400) throw new Error('registering again while a pending registration exists should be blocked');

// But registering for the OTHER dinner type concurrently should succeed — mutually
// exclusive within a type, independent across types.
const adaProfessionalProfile = { ...profile, dinnerType: 'professional', networkingGoal: 'Find co-founders' };
const adaProfessional = await json('/registrations', { method: 'POST', headers: authHeader(token), body: adaProfessionalProfile });
if (adaProfessional.registration.email !== 'ada@example.com' || adaProfessional.registration.profile.dinnerType !== 'professional') {
  throw new Error('registering for a different dinner type while one type is active should succeed');
}

const meBothTracks = await json('/me', { headers: authHeader(token) });
if (meBothTracks.registrations.social.status !== 'pending' || meBothTracks.registrations.professional.status !== 'pending') {
  throw new Error('both dinner-type tracks should be independently visible via /me at the same time');
}
if (meBothTracks.registrations.social.id === meBothTracks.registrations.professional.id) {
  throw new Error('the two tracks should be genuinely separate registration rows');
}

const duplicateProfessional = await jsonExpectError('/registrations', { method: 'POST', headers: authHeader(token), body: adaProfessionalProfile });
if (duplicateProfessional.status !== 400) throw new Error('registering again for the same already-active dinner type should still be blocked');

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
if (meMatched.registrations.social.status !== 'matched') throw new Error('seeded match should surface as matched');
if (!meMatched.registrations.social.match || meMatched.registrations.social.match.restaurant.area !== 'East') throw new Error('match/status did not resolve as expected from seeded group');
if (meMatched.registrations.social.match.compatibility != null) throw new Error('real matches should not carry a fabricated compatibility score');
if (!meMatched.registrations.social.match.eventAt) throw new Error('match should expose eventAt');
if (meMatched.registrations.professional.status !== 'pending') throw new Error('the professional track should be unaffected by the social match');
const adaEntryBeforeConfirm = meMatched.registrations.social.match.group.find(p => p.isUser);
if (adaEntryBeforeConfirm.confirmed !== false) throw new Error('member should not show as confirmed before confirming');

// Still can't register again while matched but not yet confirmed/rejected.
const duplicateWhileMatched = await jsonExpectError('/registrations', { method: 'POST', headers: authHeader(token), body: profile });
if (duplicateWhileMatched.status !== 400) throw new Error('registering again while matched (not confirmed/rejected) should be blocked');

// Attendance cannot be set until the match is confirmed.
const attendanceBeforeConfirm = await jsonExpectError('/attendance', { method: 'POST', headers: authHeader(token), body: { groupId, status: 'on_time' } });
if (attendanceBeforeConfirm.status !== 400) throw new Error('attendance should be rejected before the match is confirmed');

const confirmed = await json('/match/confirm', { method: 'POST', headers: authHeader(token), body: { registrationId: created.registration.id } });
if (!confirmed.success || confirmed.registration.status !== 'confirmed') throw new Error('confirm failed');

// Other members' confirmation status stays visible to the caller even after the caller has confirmed.
const meAfterConfirm = await json('/me', { headers: authHeader(token) });
const adaEntryAfterConfirm = meAfterConfirm.registrations.social.match.group.find(p => p.isUser);
const boEntry = meAfterConfirm.registrations.social.match.group.find(p => !p.isUser);
if (adaEntryAfterConfirm.confirmed !== true) throw new Error('the caller should show as confirmed after confirming');
if (boEntry.confirmed !== false) throw new Error('a tablemate who never confirmed should still show as not confirmed');

// Attendance: since eventAt is already in the past for this seeded group, setting it should be rejected
// (now for the "event already started" reason rather than "not confirmed yet").
const attendanceTooLate = await jsonExpectError('/attendance', { method: 'POST', headers: authHeader(token), body: { groupId, status: 'on_time' } });
if (attendanceTooLate.status !== 400) throw new Error('attendance should be rejected once the event has started');

// Non-member cannot set attendance for a group they don't belong to.
const otherToken = await signInAs('carla@example.com', 'Carla Test');
const attendanceNonMember = await jsonExpectError('/attendance', { method: 'POST', headers: authHeader(otherToken), body: { groupId, status: 'on_time' } });
if (attendanceNonMember.status !== 404) throw new Error('non-member attendance update should 404');

// Rating here should be rejected — this seeded group is only 'matched', not 'completed' yet
// (ratings, like the old votes, are gated on groupCompleted + being the rater's latest group).
const rateBeforeCompleted = await jsonExpectError('/ratings', { method: 'POST', headers: authHeader(token), body: { groupId, rateeRegistrationId: 'reg-bo', rating: 5 } });
if (rateBeforeCompleted.status !== 400) throw new Error('rating should be rejected before the group is completed');

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

// --- Reject (before confirming) counts toward the SAME >=2 threshold as
// attendance not_showing (after confirming) — mixing both channels should
// still immediately unmatch the group once the combined count hits 2. ---

const karaToken = await signInAs('kara@example.com', 'Kara Test');
const leoToken = await signInAs('leo@example.com', 'Leo Test');
const miaToken = await signInAs('mia@example.com', 'Mia Test');

const karaProfile = { ...profile, name: 'Kara Tester', phone: '+65 9000 4444', area: 'CBD' };
const leoProfile = { ...profile, name: 'Leo Tester', phone: '+65 9000 5555', area: 'CBD' };
const miaProfile = { ...profile, name: 'Mia Tester', phone: '+65 9000 6666', area: 'CBD' };

const karaReg = await json('/registrations', { method: 'POST', headers: authHeader(karaToken), body: karaProfile });
const leoReg = await json('/registrations', { method: 'POST', headers: authHeader(leoToken), body: leoProfile });
const miaReg = await json('/registrations', { method: 'POST', headers: authHeader(miaToken), body: miaProfile });

const mixedGroupId = 'group-test-mixed-threshold';
__test.seedMatchGroup(env, {
  groupId: mixedGroupId,
  restaurant: { id: 'r3', name: 'Supper Club Social', area: 'CBD', cuisine: 'Casual bistro and cocktails', perk: 'Extended happy-hour pricing for the group' },
  eventAt: new Date(Date.now() + 5 * 86400000).toISOString(),
  eventEndsAt: new Date(Date.now() + 5 * 86400000 + 2 * 3600000).toISOString(),
  members: [
    { email: 'kara@example.com', registrationId: karaReg.registration.id },
    { email: 'leo@example.com', registrationId: leoReg.registration.id },
    { email: 'mia@example.com', registrationId: miaReg.registration.id },
    { email: 'noor@example.com', registrationId: 'reg-noor' },
  ],
});

// Kara confirms, then sets attendance to not_showing (1st "can't make it" signal).
await json('/match/confirm', { method: 'POST', headers: authHeader(karaToken), body: { registrationId: karaReg.registration.id } });
const karaAttendance = await json('/attendance', { method: 'POST', headers: authHeader(karaToken), body: { groupId: mixedGroupId, status: 'not_showing' } });
if (karaAttendance.groupUnmatched !== false) throw new Error('a single not_showing signal should not unmatch the group yet');

// Leo never confirms and instead rejects (2nd "can't make it" signal, different channel — should cross the combined threshold).
const leoReject = await json('/match/reject', { method: 'POST', headers: authHeader(leoToken), body: { registrationId: leoReg.registration.id } });
if (leoReject.groupUnmatched !== true) throw new Error('a reject that crosses the combined threshold (with an existing not_showing) should immediately unmatch the group');
if (leoReject.registration.status !== 'rejected') throw new Error('the rejecting member should still end up in rejected status');

const karaMeAfterUnmatch = await json('/me', { headers: authHeader(karaToken) });
if (karaMeAfterUnmatch.registrations.social.status !== 'pending' || karaMeAfterUnmatch.registrations.social.matchedGroupId) {
  throw new Error('the member who set not_showing should be released back to pending once the combined threshold unmatches the group');
}

const miaMeAfterUnmatch = await json('/me', { headers: authHeader(miaToken) });
if (miaMeAfterUnmatch.registrations.social.status !== 'pending' || miaMeAfterUnmatch.registrations.social.matchedGroupId) {
  throw new Error('an uninvolved matched member should also be released once the combined threshold unmatches the group');
}

const leoRegisterDuringCooldown = await jsonExpectError('/registrations', { method: 'POST', headers: authHeader(leoToken), body: leoProfile });
if (leoRegisterDuringCooldown.status !== 400 || !leoRegisterDuringCooldown.data.retryAt) {
  throw new Error('the rejecter should stay in their own 6h cooldown, not get silently reverted to pending by the group-wide unmatch');
}

// --- Immediate unmatch when the not_showing threshold is crossed via /attendance ---
// (should not need to wait for the matcher-worker's cron cycle)

const ginaToken = await signInAs('gina@example.com', 'Gina Test');
const hugoToken = await signInAs('hugo@example.com', 'Hugo Test');
const irisToken = await signInAs('iris@example.com', 'Iris Test');

const ginaProfile = { ...profile, name: 'Gina Tester', phone: '+65 9000 1111', area: 'North' };
const hugoProfile = { ...profile, name: 'Hugo Tester', phone: '+65 9000 2222', area: 'North' };
const irisProfile = { ...profile, name: 'Iris Tester', phone: '+65 9000 3333', area: 'North' };

const ginaReg = await json('/registrations', { method: 'POST', headers: authHeader(ginaToken), body: ginaProfile });
const hugoReg = await json('/registrations', { method: 'POST', headers: authHeader(hugoToken), body: hugoProfile });
const irisReg = await json('/registrations', { method: 'POST', headers: authHeader(irisToken), body: irisProfile });

const immediateGroupId = 'group-test-immediate-unmatch';
__test.seedMatchGroup(env, {
  groupId: immediateGroupId,
  restaurant: { id: 'r5', name: 'North Garden Social', area: 'North', cuisine: 'Casual garden bistro', perk: 'Free zero-proof welcome spritz' },
  eventAt: new Date(Date.now() + 4 * 86400000).toISOString(),
  eventEndsAt: new Date(Date.now() + 4 * 86400000 + 2 * 3600000).toISOString(),
  members: [
    { email: 'gina@example.com', registrationId: ginaReg.registration.id },
    { email: 'hugo@example.com', registrationId: hugoReg.registration.id },
    { email: 'iris@example.com', registrationId: irisReg.registration.id },
    { email: 'jack@example.com', registrationId: 'reg-jack' },
  ],
});

await json('/match/confirm', { method: 'POST', headers: authHeader(ginaToken), body: { registrationId: ginaReg.registration.id } });
await json('/match/confirm', { method: 'POST', headers: authHeader(hugoToken), body: { registrationId: hugoReg.registration.id } });
await json('/match/confirm', { method: 'POST', headers: authHeader(irisToken), body: { registrationId: irisReg.registration.id } });

const ginaNotShowing = await json('/attendance', { method: 'POST', headers: authHeader(ginaToken), body: { groupId: immediateGroupId, status: 'not_showing' } });
if (ginaNotShowing.groupUnmatched !== false) throw new Error('a single not_showing should not unmatch the group yet');

const hugoNotShowing = await json('/attendance', { method: 'POST', headers: authHeader(hugoToken), body: { groupId: immediateGroupId, status: 'not_showing' } });
if (hugoNotShowing.groupUnmatched !== true) throw new Error('the 2nd not_showing should immediately unmatch the group, not wait for the cron');

const ginaMeAfterUnmatch = await json('/me', { headers: authHeader(ginaToken) });
if (ginaMeAfterUnmatch.registrations.social.status !== 'pending' || ginaMeAfterUnmatch.registrations.social.matchedGroupId) {
  throw new Error('the member who set not_showing should be released back to pending immediately');
}

const irisMeAfterUnmatch = await json('/me', { headers: authHeader(irisToken) });
if (irisMeAfterUnmatch.registrations.social.status !== 'pending' || irisMeAfterUnmatch.registrations.social.matchedGroupId) {
  throw new Error('a confirmed member who never set not_showing should also be released once the group unmatches');
}

const irisAttendanceAfterUnmatch = await jsonExpectError('/attendance', { method: 'POST', headers: authHeader(irisToken), body: { groupId: immediateGroupId, status: 'on_time' } });
if (irisAttendanceAfterUnmatch.status !== 404) throw new Error('attendance should 404 once the group has been unmatched — the registration no longer points at that group');

// --- Ratings system: diners rate each other 1-5 stars in the latest successfully matched group ---

const patriciaToken = await signInAs('patricia@example.com', 'Patricia Test');
const quinnToken = await signInAs('quinn@example.com', 'Quinn Test');
const rosaToken = await signInAs('rosa@example.com', 'Rosa Test');
const samToken = await signInAs('sam@example.com', 'Sam Test');

const votingProfile = { ...profile, area: 'Central' };
const patriciaReg = await json('/registrations', { method: 'POST', headers: authHeader(patriciaToken), body: { ...votingProfile, name: 'Patricia Tester', phone: '+65 9000 7777' } });
const quinnReg = await json('/registrations', { method: 'POST', headers: authHeader(quinnToken), body: { ...votingProfile, name: 'Quinn Tester', phone: '+65 9000 8888' } });
const rosaReg = await json('/registrations', { method: 'POST', headers: authHeader(rosaToken), body: { ...votingProfile, name: 'Rosa Tester', phone: '+65 9000 9990' } });
const samReg = await json('/registrations', { method: 'POST', headers: authHeader(samToken), body: { ...votingProfile, name: 'Sam Tester', phone: '+65 9000 1230' } });

if (!patriciaReg.dinerCode || !patriciaReg.dinerCode.startsWith('DS-')) throw new Error('registering for the first time should assign a diner code');
const patriciaRegAgainCode = await json('/registrations', { method: 'POST', headers: authHeader(patriciaToken), body: { ...votingProfile, name: 'Patricia Tester', phone: '+65 9000 7777', dinnerType: 'professional' } });
if (patriciaRegAgainCode.dinerCode !== patriciaReg.dinerCode) throw new Error('a diner code should be assigned once and stay stable across further registrations');

const votingGroupId = 'group-test-voting';
__test.seedMatchGroup(env, {
  groupId: votingGroupId,
  restaurant: { id: 'r1', name: 'Neighbourhood Table', area: 'Central', cuisine: 'Modern Asian sharing plates', perk: 'Complimentary welcome drink for each guest' },
  eventAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  eventEndsAt: new Date(Date.now() - 5 * 86400000 + 2 * 3600000).toISOString(),
  status: 'completed',
  members: [
    { email: 'patricia@example.com', registrationId: patriciaReg.registration.id },
    { email: 'quinn@example.com', registrationId: quinnReg.registration.id },
    { email: 'rosa@example.com', registrationId: rosaReg.registration.id },
    { email: 'sam@example.com', registrationId: samReg.registration.id },
  ],
});

const patriciaMe = await json('/me', { headers: authHeader(patriciaToken) });
if (patriciaMe.registrations.social.status !== 'completed') throw new Error('a group that survives past its event start time should flip the registration to completed');
if (!patriciaMe.registrations.social.match || !patriciaMe.registrations.social.match.groupCompleted) throw new Error('match should expose groupCompleted for a successfully matched group');
if (!patriciaMe.registrations.social.match.isLatestSuccessfulGroup) throw new Error('this should be patricia\'s latest successful group');
const quinnInPatriciaMatch = patriciaMe.registrations.social.match.group.find(p => p.registrationId === quinnReg.registration.id);
if (!quinnInPatriciaMatch.dinerCode) throw new Error('tablemates should expose their diner code in the match payload');

const badRating = await jsonExpectError('/ratings', { method: 'POST', headers: authHeader(patriciaToken), body: { groupId: votingGroupId, rateeRegistrationId: quinnReg.registration.id, rating: 0 } });
if (badRating.status !== 400) throw new Error('a rating outside 1-5 should be rejected');

const starRating = await json('/ratings', { method: 'POST', headers: authHeader(patriciaToken), body: { groupId: votingGroupId, rateeRegistrationId: quinnReg.registration.id, rating: 5 } });
if (!starRating.success) throw new Error('star rating should succeed');

const dupRating = await jsonExpectError('/ratings', { method: 'POST', headers: authHeader(patriciaToken), body: { groupId: votingGroupId, rateeRegistrationId: quinnReg.registration.id, rating: 3 } });
if (dupRating.status !== 400) throw new Error('rating the same tablemate twice in the same group should be rejected');

const selfRating = await jsonExpectError('/ratings', { method: 'POST', headers: authHeader(patriciaToken), body: { groupId: votingGroupId, rateeRegistrationId: patriciaReg.registration.id, rating: 5 } });
if (selfRating.status !== 400) throw new Error('self-rating should be rejected');

await json('/ratings', { method: 'POST', headers: authHeader(patriciaToken), body: { groupId: votingGroupId, rateeRegistrationId: rosaReg.registration.id, rating: 2 } });

// Rating is only allowed in the rater's LATEST successful group.
const olderVotingGroupId = 'group-test-voting-older';
__test.seedMatchGroup(env, {
  groupId: olderVotingGroupId,
  restaurant: { id: 'r2', name: 'The Long Bar Table', area: 'East', cuisine: 'Mediterranean tapas', perk: 'Shared appetiser platter on the house' },
  eventAt: new Date(Date.now() - 20 * 86400000).toISOString(),
  eventEndsAt: new Date(Date.now() - 20 * 86400000 + 2 * 3600000).toISOString(),
  status: 'completed',
  members: [
    { email: 'patricia@example.com', registrationId: 'reg-patricia-old' },
    { email: 'tia@example.com', registrationId: 'reg-tia' },
  ],
});
const rateInOlderGroup = await jsonExpectError('/ratings', { method: 'POST', headers: authHeader(patriciaToken), body: { groupId: olderVotingGroupId, rateeRegistrationId: 'reg-tia', rating: 4 } });
if (rateInOlderGroup.status !== 400) throw new Error('rating in a group that is not the rater\'s latest successful group should be rejected');

const patriciaRatingsMine = await json('/ratings/mine?groupId=' + votingGroupId, { headers: authHeader(patriciaToken) });
if (!patriciaRatingsMine.ratings.some(r => r.rateeRegistrationId === quinnReg.registration.id && r.rating === 5)) throw new Error('/ratings/mine should reflect the 5-star rating');
if (!patriciaRatingsMine.ratings.some(r => r.rateeRegistrationId === rosaReg.registration.id && r.rating === 2)) throw new Error('/ratings/mine should reflect the 2-star rating');

const dupPhone = await jsonExpectError('/registrations', { method: 'POST', headers: authHeader(quinnToken), body: { ...votingProfile, name: 'Quinn Duplicate', phone: '+65 9000 7777', dinnerType: 'professional' } });
if (dupPhone.status !== 400) throw new Error('registering with a phone number already used by a different account should be rejected');

// --- Reporting system: 1 report chance per successfully matched group; 3
// reports from 3 unique reporters within the reported diner's last 3
// successful matches permanently bans them. ---

const reportedToken = await signInAs('uma@example.com', 'Uma Test');
const reporter1Token = await signInAs('victor@example.com', 'Victor Test');
const reporter2Token = await signInAs('wendy@example.com', 'Wendy Test');
const reporter3Token = await signInAs('xavier@example.com', 'Xavier Test');

const reportProfile = { ...profile, area: 'CBD' };
await json('/registrations', { method: 'POST', headers: authHeader(reportedToken), body: { ...reportProfile, name: 'Uma Tester', phone: '+65 9000 2001' } });
const victorReg = await json('/registrations', { method: 'POST', headers: authHeader(reporter1Token), body: { ...reportProfile, name: 'Victor Tester', phone: '+65 9000 2002' } });
const wendyReg = await json('/registrations', { method: 'POST', headers: authHeader(reporter2Token), body: { ...reportProfile, name: 'Wendy Tester', phone: '+65 9000 2003' } });
const xavierReg = await json('/registrations', { method: 'POST', headers: authHeader(reporter3Token), body: { ...reportProfile, name: 'Xavier Tester', phone: '+65 9000 2004' } });

const reportRounds = [[reporter1Token, victorReg], [reporter2Token, wendyReg], [reporter3Token, xavierReg]];
for (let i = 0; i < reportRounds.length; i += 1) {
  const [reporterToken, reporterReg] = reportRounds[i];
  const gId = `group-test-report-${i}`;
  __test.seedMatchGroup(env, {
    groupId: gId,
    restaurant: { id: 'r3', name: 'Supper Club Social', area: 'CBD', cuisine: 'Casual bistro and cocktails', perk: 'Extended happy-hour pricing for the group' },
    eventAt: new Date(Date.now() - (10 - i) * 86400000).toISOString(),
    eventEndsAt: new Date(Date.now() - (10 - i) * 86400000 + 2 * 3600000).toISOString(),
    status: 'completed',
    members: [
      { email: 'uma@example.com', registrationId: `reg-uma-${i}` },
      { email: reporterReg.registration.email, registrationId: reporterReg.registration.id },
    ],
  });
  __test.setUserStats(env, 'uma@example.com', { successfulMatchesCount: i + 1 });
  const reportRes = await json('/reports', { method: 'POST', headers: authHeader(reporterToken), body: { groupId: gId, reportedRegistrationId: `reg-uma-${i}` } });
  if (i < 2) {
    if (reportRes.banned) throw new Error(`uma should not be banned after only ${i + 1} report(s)`);
  } else if (!reportRes.banned) {
    throw new Error('uma should be banned after 3 reports from 3 unique reporters within her last 3 successful matches');
  }
}

const dupReport = await jsonExpectError('/reports', { method: 'POST', headers: authHeader(reporter1Token), body: { groupId: 'group-test-report-0', reportedRegistrationId: 'reg-uma-0' } });
if (dupReport.status !== 400) throw new Error('a reporter should only get one report chance per group');

const selfReport = await jsonExpectError('/reports', { method: 'POST', headers: authHeader(reportedToken), body: { groupId: 'group-test-report-0', reportedRegistrationId: 'reg-uma-0' } });
if (selfReport.status !== 400) throw new Error('self-report should be rejected');

const notYetCompleteGroupId = 'group-test-report-not-complete';
__test.seedMatchGroup(env, {
  groupId: notYetCompleteGroupId,
  restaurant: { id: 'r6', name: 'NEX Table Club', area: 'North-East', cuisine: 'Asian-European comfort plates', perk: 'Chef snack to share' },
  eventAt: new Date(Date.now() + 86400000).toISOString(),
  eventEndsAt: new Date(Date.now() + 86400000 + 2 * 3600000).toISOString(),
  members: [
    { email: 'uma@example.com', registrationId: 'reg-uma-pending' },
    { email: 'victor@example.com', registrationId: 'reg-victor-pending' },
  ],
});
const reportBeforeComplete = await jsonExpectError('/reports', { method: 'POST', headers: authHeader(reporter1Token), body: { groupId: notYetCompleteGroupId, reportedRegistrationId: 'reg-uma-pending' } });
if (reportBeforeComplete.status !== 400) throw new Error('reports should only be allowed for a successfully matched (completed) group');

const victorReportsMine = await json('/reports/mine?groupId=group-test-report-0', { headers: authHeader(reporter1Token) });
if (!victorReportsMine.report || victorReportsMine.report.reportedRegistrationId !== 'reg-uma-0') throw new Error('/reports/mine should reflect the filed report');

const umaRegisterAfterBan = await jsonExpectError('/registrations', { method: 'POST', headers: authHeader(reportedToken), body: { ...reportProfile, name: 'Uma Tester', phone: '+65 9000 2001', dinnerType: 'professional' } });
if (umaRegisterAfterBan.status !== 403) throw new Error('a banned user should be blocked from registering, even for a different dinner type');

// --- Admin: fast-forward matched group(s) straight to the completed post-dinner
// stage, so voting/reporting unlock without waiting for a real event_at to pass. ---

const adminEnv = { ...env, ADMIN_API_KEY: 'test-admin-key' };

const finnToken = await signInAs('finn@example.com', 'Finn Test');
const gretaToken = await signInAs('greta@example.com', 'Greta Test');
const completeProfile = { ...profile, area: 'North' };
const finnReg = await json('/registrations', { method: 'POST', headers: authHeader(finnToken), body: { ...completeProfile, name: 'Finn Tester', phone: '+65 9000 3001' } });
const gretaReg = await json('/registrations', { method: 'POST', headers: authHeader(gretaToken), body: { ...completeProfile, name: 'Greta Tester', phone: '+65 9000 3002' } });

const completeGroupId = 'group-test-complete';
__test.seedMatchGroup(env, {
  groupId: completeGroupId,
  restaurant: { id: 'r5', name: 'North Garden Social', area: 'North', cuisine: 'Casual garden bistro', perk: 'Free zero-proof welcome spritz' },
  eventAt: new Date(Date.now() + 3 * 86400000).toISOString(), // a real future dinner, not yet happened
  eventEndsAt: new Date(Date.now() + 3 * 86400000 + 2 * 3600000).toISOString(),
  members: [
    { email: 'finn@example.com', registrationId: finnReg.registration.id },
    { email: 'greta@example.com', registrationId: gretaReg.registration.id },
  ],
});
await json('/match/confirm', { method: 'POST', headers: authHeader(finnToken), body: { registrationId: finnReg.registration.id } });
await json('/match/confirm', { method: 'POST', headers: authHeader(gretaToken), body: { registrationId: gretaReg.registration.id } });

// Rating/reporting should not be available yet — the group genuinely hasn't happened.
const rateTooEarly = await jsonExpectError('/ratings', { method: 'POST', headers: authHeader(finnToken), body: { groupId: completeGroupId, rateeRegistrationId: gretaReg.registration.id, rating: 5 } });
if (rateTooEarly.status !== 400) throw new Error('rating should not be open before the group is completed');

const completeWithoutKeyConfigured = await jsonExpectError('/admin/complete-group', { method: 'POST', headers: { 'X-Admin-Key': 'whatever' }, body: { groupId: completeGroupId } });
if (completeWithoutKeyConfigured.status !== 404) throw new Error('admin complete-group should 404 when ADMIN_API_KEY is not configured');

const completeWrongKey = await jsonExpectError('/admin/complete-group', { method: 'POST', headers: { 'X-Admin-Key': 'nope' }, body: { groupId: completeGroupId } }, adminEnv);
if (completeWrongKey.status !== 404) throw new Error('admin complete-group should 404 with the wrong key');

const completeUnknownGroup = await jsonExpectError('/admin/complete-group', { method: 'POST', headers: { 'X-Admin-Key': 'test-admin-key' }, body: { groupId: 'group-does-not-exist' } }, adminEnv);
if (completeUnknownGroup.status !== 404) throw new Error('admin complete-group should 404 for an unknown/non-matched groupId');

const completeResult = await json('/admin/complete-group', { method: 'POST', headers: { 'X-Admin-Key': 'test-admin-key' }, body: { groupId: completeGroupId } }, adminEnv);
if (!completeResult.success || completeResult.groupsCompleted !== 1 || completeResult.membersCompleted !== 2) {
  throw new Error('admin complete-group should report exactly one group and two members completed');
}

const finnAfterComplete = await json('/me', { headers: authHeader(finnToken) });
if (finnAfterComplete.registrations.social.status !== 'completed') throw new Error('registration should flip to completed');
if (!finnAfterComplete.registrations.social.match.groupCompleted) throw new Error('match.groupCompleted should be true after admin complete-group');

// Rating and reporting should now work exactly as they would for a real completed dinner.
const ratingAfterComplete = await json('/ratings', { method: 'POST', headers: authHeader(finnToken), body: { groupId: completeGroupId, rateeRegistrationId: gretaReg.registration.id, rating: 5 } });
if (!ratingAfterComplete.success) throw new Error('rating should succeed once the group has been admin-completed');

const reportAfterComplete = await json('/reports', { method: 'POST', headers: authHeader(gretaToken), body: { groupId: completeGroupId, reportedRegistrationId: finnReg.registration.id } });
if (!reportAfterComplete.success) throw new Error('reporting should succeed once the group has been admin-completed');

// Filtering by member email, and the no-filter "complete every currently matched group" mode.
const hallToken = await signInAs('hall@example.com', 'Hall Test');
const ivyToken = await signInAs('ivy@example.com', 'Ivy Test');
const byEmailProfile = { ...profile, area: 'West' };
const hallReg = await json('/registrations', { method: 'POST', headers: authHeader(hallToken), body: { ...byEmailProfile, name: 'Hall Tester', phone: '+65 9000 3003' } });
const ivyReg = await json('/registrations', { method: 'POST', headers: authHeader(ivyToken), body: { ...byEmailProfile, name: 'Ivy Tester', phone: '+65 9000 3004' } });
const byEmailGroupId = 'group-test-complete-by-email';
__test.seedMatchGroup(env, {
  groupId: byEmailGroupId,
  restaurant: { id: 'r4', name: 'Westside Noodle Room', area: 'West', cuisine: 'Modern noodles and small plates', perk: 'Dessert platter for the table' },
  eventAt: new Date(Date.now() + 3 * 86400000).toISOString(),
  eventEndsAt: new Date(Date.now() + 3 * 86400000 + 2 * 3600000).toISOString(),
  members: [
    { email: 'hall@example.com', registrationId: hallReg.registration.id },
    { email: 'ivy@example.com', registrationId: ivyReg.registration.id },
  ],
});
const completeByEmail = await json('/admin/complete-group', { method: 'POST', headers: { 'X-Admin-Key': 'test-admin-key' }, body: { email: 'hall@example.com' } }, adminEnv);
if (completeByEmail.groupsCompleted !== 1 || !completeByEmail.groupIds.includes(byEmailGroupId)) {
  throw new Error('admin complete-group should find the matched group by member email');
}

// --- Admin reset endpoint (must run last — it wipes all state including sessions) ---

const resetWithoutKeyConfigured = await jsonExpectError('/admin/reset', { method: 'POST', headers: { 'X-Admin-Key': 'whatever' } });
if (resetWithoutKeyConfigured.status !== 404) throw new Error('admin reset should 404 when ADMIN_API_KEY is not configured');

const resetWrongKey = await jsonExpectError('/admin/reset', { method: 'POST', headers: { 'X-Admin-Key': 'nope' } }, adminEnv);
if (resetWrongKey.status !== 404) throw new Error('admin reset should 404 with the wrong key (same as not-found, not a distinguishable 403)');

const resetMissingHeader = await jsonExpectError('/admin/reset', { method: 'POST' }, adminEnv);
if (resetMissingHeader.status !== 404) throw new Error('admin reset should 404 with no X-Admin-Key header at all');

const resetOk = await json('/admin/reset', { method: 'POST', headers: { 'X-Admin-Key': 'test-admin-key' } }, adminEnv);
if (!resetOk.success) throw new Error('admin reset should succeed with the correct key');

const meAfterReset = await jsonExpectError('/me', { headers: authHeader(token) }, adminEnv);
if (meAfterReset.status !== 401) throw new Error('sessions should be cleared after admin reset, so the old token is no longer valid');

console.log('backend Google OAuth + relational registration + match/attendance/rating/reject/admin-reset flow passed');
