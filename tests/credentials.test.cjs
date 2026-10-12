const { test } = require('node:test');
const assert = require('node:assert/strict');
const { credentialTarget, readToken } = require('../out/credentials');
const home = '/Users/test';
const personal = credentialTarget('~/.claude-personal', '', home);
const raw = JSON.stringify({ claudeAiOauth: { accessToken: 'test-token' } });

test('default profile retains the standard Keychain service', () => {
  assert.deepEqual(credentialTarget('', '', home), { directory: home + '/.claude', keychainService: 'Claude Code-credentials' });
});
test('configured personal directory overrides the environment and expands home', () => {
  assert.deepEqual(credentialTarget('~/.claude-personal', '/work', home), credentialTarget(home + '/.claude-personal', '', home));
  assert.notEqual(personal.keychainService, 'Claude Code-credentials');
  assert.equal(credentialTarget('~/.claude-personal', '', '/Users/jonathanvanderplanken').keychainService, 'Claude Code-credentials-096f53ab');
});
test('empty setting honors the environment, including explicitly selected default paths', () => {
  assert.deepEqual(credentialTarget('', '/work', home), credentialTarget('/work', '', home));
  assert.notEqual(credentialTarget(home + '/.claude', '', home).keychainService, 'Claude Code-credentials');
  assert.throws(() => credentialTarget('relative/path', '', home), /absolute path/);
});
test('reads only the selected Keychain entry', async () => {
  const token = await readToken(personal, { platform: 'darwin', keychain: async service => {
    assert.equal(service, personal.keychainService); return raw;
  }, file: async () => { throw Error('must not read file'); } });
  assert.equal(token, 'test-token');
});
test('failed Keychain read falls back only to selected profile file', async () => {
  assert.equal(await readToken(personal, { platform: 'darwin', keychain: async () => { throw Error('missing'); }, file: async file => {
    assert.equal(file, personal.directory + '/.credentials.json'); return raw;
  } }), 'test-token');
});
test('non-macOS uses the selected file without Keychain', async () => {
  assert.equal(await readToken(personal, { platform: 'linux', keychain: async () => assert.fail('Keychain called'), file: async () => raw }), 'test-token');
});
test('invalid credentials never expose raw content or fall back to another account', async () => {
  let calls = 0;
  await assert.rejects(readToken(personal, { platform: 'darwin', keychain: async service => {
    calls++; assert.equal(service, personal.keychainService); return 'sensitive-invalid-json';
  }, file: async file => { calls++; assert.equal(file, personal.directory + '/.credentials.json'); return 'sensitive-invalid-json'; } }), e => /No readable Claude login/.test(e.message) && !e.message.includes('sensitive'));
  assert.equal(calls, 2);
});
