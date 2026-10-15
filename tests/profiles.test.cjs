const {test}=require('node:test');
const assert=require('node:assert/strict');
const {discoverAccounts,profileName}=require('../out/profiles');
const {profileTarget,accountFile}=require('../out/credentials');
const home='/Users/test';
const source=(overrides={})=>({
 home,env:{},
 directories:async parent=>{assert.equal(parent,home);return ['.claude','.claude-personal','.claude.json','.codex','Documents','.claude-stale']},
 exists:async file=>file===home+'/.codex/auth.json',
 login:async target=>target.directory!==home+'/.claude-stale',
 ...overrides,
});
test('signed-in ~/.claude* and ~/.codex* directories are discovered in a stable order',async()=>{
 const accounts=await discoverAccounts(['claude','codex'],{claude:'',codex:''},source());
 assert.deepEqual(accounts,[
  {provider:'claude',directory:home+'/.claude',name:''},
  {provider:'claude',directory:home+'/.claude-personal',name:'personal'},
  {provider:'codex',directory:home+'/.codex',name:''},
 ]);
});
test('the default profile keeps the unsuffixed Keychain entry and custom profiles are suffixed',async()=>{
 const targets=[];
 await discoverAccounts(['claude'],{claude:'',codex:''},source({login:async t=>{targets.push(t.keychainService);return true}}));
 assert.equal(targets[0],'Claude Code-credentials');assert.match(targets[1],/^Claude Code-credentials-[0-9a-f]{8}$/);
 assert.equal(profileTarget(home+'/.claude',home).keychainService,'Claude Code-credentials');
 assert.equal(accountFile(home+'/.claude',home),home+'/.claude.json');
 assert.equal(accountFile(home+'/.claude-personal',home),home+'/.claude-personal/.claude.json');
});
test('environment and configured extras are added once and invalid extras are ignored',async()=>{
 const s=source({env:{CLAUDE_CONFIG_DIR:'~/.claude-personal',CODEX_HOME:'/opt/codex'},exists:async f=>f==='/opt/codex/auth.json'||f===home+'/work/auth.json'});
 const accounts=await discoverAccounts(['claude','codex'],{claude:'/Users/test/.claude-personal',codex:'~/work'},s);
 assert.deepEqual(accounts.map(a=>a.directory),[home+'/.claude',home+'/.claude-personal','/opt/codex',home+'/work']);
 assert.equal((await discoverAccounts(['codex'],{claude:'',codex:'relative'},source())).length,1);
});
test('disabled providers are skipped and names derive from the directory suffix',async()=>{
 assert.deepEqual((await discoverAccounts(['codex'],{claude:'',codex:''},source())).map(a=>a.provider),['codex']);
 assert.equal(profileName('claude','/x/.claude-work'),'work');assert.equal(profileName('codex','/x/.codex'),'');assert.equal(profileName('claude','/x/other'),'other');
});
test('profile names come from a directory key, then the account email, then the email domain',async()=>{
 const {displayName}=require('../out/profiles');
 const work={provider:'claude',directory:home+'/.claude',name:''},pers={provider:'claude',directory:home+'/.claude-personal',name:'personal'};
 const names={'@corp.example':'Client','me@mail.example':'My Company','~/.claude-personal/':'Personal dir'};
 assert.equal(displayName(work,'Someone@Corp.example',names,home),'Client');
 assert.equal(displayName(pers,'me@mail.example',names,home),'Personal dir');
 assert.equal(displayName(pers,'me@mail.example',{'me@mail.example':'My Company','@mail.example':'Other'},home),'My Company');
 assert.equal(displayName(pers,undefined,{},home),'personal');
 assert.equal(displayName(work,'x@y.example',{'@y.example':'  ',bad:3},home),'');
});
