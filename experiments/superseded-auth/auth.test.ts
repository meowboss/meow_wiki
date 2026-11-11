import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, scrypt } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthService, AuthError, type AuthOptions, type AuthResult } from '../src/auth.ts';

const PASSWORD = 'a very strong password!';
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const fixture = (options: AuthOptions = {}) => {
  const db = new DatabaseSync(':memory:');
  return { db, auth: new AuthService(db, options) };
};
const status = (code: number) => (error: unknown) => {
  assert.ok(error instanceof Error);
  assert.ok(error instanceof AuthError);
  assert.equal(error.statusCode, code);
  return true;
};
const publicOnly = (result: AuthResult) => {
  assert.deepEqual(Object.keys(result).sort(), ['csrfToken', 'token', 'user']);
  assert.deepEqual(Object.keys(result.user).sort(), ['id', 'role', 'username']);
};

test('registration hashes passwords with random salt; only token/CSRF digests are stored', async () => {
  const { db, auth } = fixture();
  try {
    const alice = await auth.register('alice', PASSWORD);
    const bob = await auth.register('中文用户', PASSWORD);
    publicOnly(alice);
    assert.equal(alice.user.role, 'user');
    assert.match(alice.token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(alice.csrfToken, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(alice.token, alice.csrfToken);
    assert.notEqual(alice.user.id, bob.user.id);
    const users = db.prepare('SELECT * FROM auth_users ORDER BY username').all();
    assert.equal(users.length, 2);
    assert.notEqual(users[0].password_salt, users[1].password_salt);
    assert.notEqual(users[0].password_hash, users[1].password_hash);
    for (const row of users) {
      assert.notEqual(row.password_hash, PASSWORD);
      const recomputed = await new Promise<Buffer>((resolve, reject) => {
        scrypt(PASSWORD, String(row.password_salt), 64, { N: 16384, r: 8, p: 1 }, (err, key) => err ? reject(err) : resolve(key));
      });
      assert.equal(recomputed.toString('hex'), row.password_hash);
    }
    const stored = db.prepare('SELECT * FROM auth_sessions WHERE user_id = ?').get(alice.user.id)!;
    assert.equal(stored.token_hash, digest(alice.token));
    assert.equal(stored.csrf_hash, digest(alice.csrfToken));
    const storedText = JSON.stringify({ users, sessions: db.prepare('SELECT * FROM auth_sessions').all() });
    assert.ok(!storedText.includes(PASSWORD));
    assert.ok(!storedText.includes(alice.token));
    assert.ok(!storedText.includes(alice.csrfToken));
    assert.deepEqual(auth.authenticate(alice.token), { user: alice.user, csrfHash: digest(alice.csrfToken) });
  } finally { db.close(); }
});

test('password bounds, Unicode lengths and safe username validation', async () => {
  const { db, auth } = fixture();
  try {
    for (const password of ['a'.repeat(11), 'a'.repeat(129), '', null, 123]) {
      await assert.rejects(auth.register('alice', password as string), status(400));
    }
    for (const username of ['ab', 'a'.repeat(41), ' space', 'a/b', 'a@b', "a'b", 'a\nb', '猫😺猫', '', null, 123]) {
      await assert.rejects(auth.register(username as string, PASSWORD), status(400));
    }
    await auth.register('a-b_猫.1', 'a'.repeat(12));
    await auth.register('a'.repeat(40), 'a'.repeat(128));
    await auth.register('汉字猫', '🔐'.repeat(12));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_users').get()!.n, 3);
  } finally { db.close(); }
});

test('successful login issues independent sessions and never returns password hashes', async () => {
  const { db, auth } = fixture();
  try {
    const registered = await auth.register('alice', PASSWORD);
    const login = await auth.login('alice', PASSWORD);
    publicOnly(login);
    assert.deepEqual(login.user, registered.user);
    assert.notEqual(login.token, registered.token);
    assert.notEqual(login.csrfToken, registered.csrfToken);
    assert.ok(auth.authenticate(registered.token));
    assert.ok(auth.authenticate(login.token));
    assert.equal(auth.authenticate('x'.repeat(43)), null);
    for (const token of ['', 'bad', 'a'.repeat(1000), null, 42]) assert.equal(auth.authenticate(token as string), null);
  } finally { db.close(); }
});

test('CSRF proofs are session-specific, digest-checked and reject malformed values', async () => {
  const { db, auth } = fixture();
  try {
    const first = await auth.register('alice', PASSWORD);
    const second = await auth.login('alice', PASSWORD);
    const session = auth.authenticate(first.token);
    assert.equal(auth.verifyCsrf(session, first.csrfToken), true);
    assert.equal(auth.verifyCsrf(session, second.csrfToken), false);
    assert.equal(auth.verifyCsrf(session, first.token), false);
    assert.equal(auth.verifyCsrf(null, first.csrfToken), false);
    for (const value of ['', 'invalid', null, 123]) assert.equal(auth.verifyCsrf(session, value as string), false);
    assert.equal(auth.verifyCsrf({ user: first.user, csrfHash: 'invalid' }, first.csrfToken), false);
  } finally { db.close(); }
});

test('sessions expire exactly after seven days, logout is idempotent and session-scoped', async () => {
  let now = 1_000_000;
  const { db, auth } = fixture({ clock: () => now });
  try {
    const first = await auth.register('alice', PASSWORD);
    const second = await auth.login('alice', PASSWORD);
    const row = db.prepare('SELECT expires_at FROM auth_sessions WHERE token_hash = ?').get(digest(first.token))!;
    assert.equal(row.expires_at, now + SEVEN_DAYS);
    auth.logout(first.token);
    auth.logout(first.token);
    auth.logout('malformed');
    assert.equal(auth.authenticate(first.token), null);
    assert.ok(auth.authenticate(second.token));
    now += SEVEN_DAYS - 1;
    assert.ok(auth.authenticate(second.token));
    now += 1;
    assert.equal(auth.authenticate(second.token), null);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get()!.n, 0);
  } finally { db.close(); }
});

test('wrong password, unknown username, malformed credentials and lockout share one 401 error', async () => {
  const { db, auth } = fixture();
  try {
    await auth.register('alice', PASSWORD);
    const messages: string[] = [];
    for (const [username, password] of [
      ['alice', 'wrong password!'], ['nobody', PASSWORD], ['alice', 'short'],
      ['bad username', PASSWORD], [null, null], ['alice', PASSWORD.repeat(100)],
    ]) {
      await assert.rejects(auth.login(username as string, password as string), error => {
        status(401)(error);
        messages.push((error as Error).message);
        return true;
      });
    }
    for (let i = 0; i < 5; i++) await assert.rejects(auth.login('alice', 'wrong password!'), status(401));
    await assert.rejects(auth.login('alice', PASSWORD), error => {
      status(401)(error);
      assert.equal((error as Error).message, messages[0]);
      return true;
    });
    assert.equal(new Set(messages).size, 1);
  } finally { db.close(); }
});

test('five failures lock only that username for fifteen minutes and survive service recreation', async () => {
  let now = 10_000;
  const { db, auth } = fixture({ clock: () => now });
  try {
    await auth.register('alice', PASSWORD);
    await auth.register('bobby', PASSWORD);
    for (let i = 0; i < 5; i++) await assert.rejects(auth.login('alice', 'wrong password!'), status(401));
    const attempt = db.prepare('SELECT * FROM auth_attempts WHERE username = ?').get('alice')!;
    assert.equal(attempt.failures, 5);
    assert.equal(attempt.locked_until, now + FIFTEEN_MINUTES);
    const recreated = new AuthService(db, { clock: () => now });
    await assert.rejects(recreated.login('alice', PASSWORD), status(401));
    assert.equal((await recreated.login('bobby', PASSWORD)).user.username, 'bobby');
    now += FIFTEEN_MINUTES - 1;
    await assert.rejects(recreated.login('alice', PASSWORD), status(401));
    now += 1;
    assert.equal((await recreated.login('alice', PASSWORD)).user.username, 'alice');
    assert.equal(db.prepare('SELECT * FROM auth_attempts WHERE username = ?').get('alice'), undefined);
  } finally { db.close(); }
});

test('failure windows expire; successful login resets previous failures; unknown users are limited too', async () => {
  let now = 100;
  const { db, auth } = fixture({ clock: () => now });
  try {
    await auth.register('alice', PASSWORD);
    for (let i = 0; i < 4; i++) await assert.rejects(auth.login('alice', 'wrong password!'), status(401));
    now += FIFTEEN_MINUTES;
    await assert.rejects(auth.login('alice', 'wrong password!'), status(401));
    assert.equal(db.prepare('SELECT failures FROM auth_attempts WHERE username = ?').get('alice')!.failures, 1);
    await auth.login('alice', PASSWORD);
    assert.equal(db.prepare('SELECT * FROM auth_attempts WHERE username = ?').get('alice'), undefined);
    for (let i = 0; i < 5; i++) await assert.rejects(auth.login('unknown', PASSWORD), status(401));
    assert.equal(db.prepare('SELECT failures FROM auth_attempts WHERE username = ?').get('unknown')!.failures, 5);
    await auth.register('unknown', PASSWORD);
    await assert.rejects(auth.login('unknown', PASSWORD), status(401));
    now += FIFTEEN_MINUTES;
    await auth.login('unknown', PASSWORD);
  } finally { db.close(); }
});

test('parallel login failures cannot bypass the persistent lock', async () => {
  const { db, auth } = fixture();
  try {
    await auth.register('alice', PASSWORD);
    const failures = await Promise.allSettled(Array.from({ length: 7 }, () => auth.login('alice', 'wrong password!')));
    assert.ok(failures.every(result => result.status === 'rejected' && result.reason.statusCode === 401));
    assert.equal(db.prepare('SELECT failures FROM auth_attempts WHERE username = ?').get('alice')!.failures, 5);
    await assert.rejects(auth.login('alice', PASSWORD), status(401));
  } finally { db.close(); }
});

test('only host allowlist grants admin; caller-supplied role cannot elevate users', async () => {
  const allowlist = ['host-admin'];
  const { db, auth } = fixture({ adminUsernames: allowlist });
  try {
    allowlist.push('attacker'); // Host options are snapshotted, not externally mutable.
    const registerWithRole = auth.register.bind(auth) as (name: string, password: string, role: string) => Promise<AuthResult>;
    const ordinary = await registerWithRole('attacker', PASSWORD, 'admin');
    assert.equal(ordinary.user.role, 'user');
    const admin = await registerWithRole('host-admin', PASSWORD, 'user');
    assert.equal(admin.user.role, 'admin');
    assert.equal((await auth.register('Host-admin', PASSWORD)).user.role, 'user');
    assert.equal((await auth.login('attacker', PASSWORD)).user.role, 'user');
    assert.equal(auth.authenticate(admin.token)!.user.role, 'admin');
    ordinary.user.role = 'admin';
    assert.equal(auth.authenticate(ordinary.token)!.user.role, 'user');
  } finally { db.close(); }
});

test('duplicate registration returns 409, including races, and leaves existing credentials intact', async () => {
  const { db, auth } = fixture();
  try {
    const first = await auth.register('alice', PASSWORD);
    await assert.rejects(auth.register('alice', 'different password!'), status(409));
    assert.deepEqual((await auth.login('alice', PASSWORD)).user, first.user);
    const concurrent = await Promise.allSettled([auth.register('racer', PASSWORD), auth.register('racer', PASSWORD)]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter(result => result.status === 'rejected' && result.reason.statusCode === 409).length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_users').get()!.n, 2);
  } finally { db.close(); }
});

test('users, sessions and login limits persist across closing and reopening SQLite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'meow-auth-'));
  const path = join(directory, 'auth.sqlite');
  let db = new DatabaseSync(path);
  let now = 1_000;
  try {
    const first = new AuthService(db, { clock: () => now });
    const registered = await first.register('alice', PASSWORD);
    for (let i = 0; i < 5; i++) await assert.rejects(first.login('alice', 'wrong password!'), status(401));
    db.close();
    db = new DatabaseSync(path);
    const reopened = new AuthService(db, { clock: () => now });
    assert.deepEqual(reopened.authenticate(registered.token)!.user, registered.user);
    await assert.rejects(reopened.login('alice', PASSWORD), status(401));
    now += FIFTEEN_MINUTES;
    await reopened.login('alice', PASSWORD);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite failures become sanitized Error objects with statusCode; failed registration rolls back', async () => {
  const { db, auth } = fixture();
  try {
    db.exec(`CREATE TRIGGER fail_session BEFORE INSERT ON auth_sessions BEGIN SELECT RAISE(ABORT, 'private sqlite detail'); END`);
    await assert.rejects(auth.register('alice', PASSWORD), error => {
      status(500)(error);
      assert.doesNotMatch((error as Error).message, /private sqlite detail|password|INSERT/);
      return true;
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_users').get()!.n, 0);
    db.exec('DROP TRIGGER fail_session');
    const registered = await auth.register('alice', PASSWORD);
    db.close();
    assert.throws(() => auth.authenticate(registered.token), status(500));
    assert.throws(() => auth.logout(registered.token), status(500));
    await assert.rejects(auth.login('alice', PASSWORD), status(500));
    assert.throws(() => new AuthService(db), status(500));
  } finally { if (db.isOpen) db.close(); }
});
