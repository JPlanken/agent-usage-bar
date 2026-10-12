const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('combined UI preserves old settings, lists every signed-in profile, and configures providers without unnecessary requests',async()=>{
 const values={'claudeUsageBar':{configDirectory:'~/.claude-personal',showStatusBarItem:false},agentUsageBar:{}};
 const commands={},items=[],calls={claude:0,codex:0},profiles=[];let changed,action='toggle',selected=['codex'],html,discoveries=0;
 const live=()=>items.filter(i=>!i.disposed);
 const config=namespace=>({
  get:(key,fallback)=>values[namespace][key]??fallback,
  inspect:key=>({globalValue:values[namespace][key]}),
  update:async(key,value)=>{values[namespace][key]=value;changed({affectsConfiguration:query=>`${namespace}.${key}`===query||`${namespace}.${key}`.startsWith(query+'.')})},
 });
 const vscode={
  workspace:{getConfiguration:config,onDidChangeConfiguration:cb=>changed=cb},
  window:{
   createStatusBarItem:()=>{const item={show(){this.visible=true},hide(){this.visible=false},dispose(){this.disposed=true}};items.push(item);return item},
   registerWebviewViewProvider:(_id,p)=>{const webview={options:{},set html(value){html=value},get html(){return html}};p.resolveWebviewView({webview,onDidChangeVisibility(){}})},
   onDidChangeWindowState(){},
   showQuickPick:async(choices,opts)=>opts.canPickMany?choices.filter(c=>selected.includes(c.id)):choices.find(c=>c.action===action),
  },
  commands:{registerCommand:(id,cb)=>commands[id]=cb,executeCommand:async(...args)=>assert.deepEqual(args,['workbench.action.openSettings','@ext:planken.agent-usage'])},
  StatusBarAlignment:{Right:1},ConfigurationTarget:{Global:1},ThemeColor:class{},MarkdownString:class{appendMarkdown(){}appendText(){}},
 };
 const snapshot=(label,account)=>({rows:[{label,shortLabel:'wk',percent:23,resetsAt:new Date(Date.now()+90*60000)}],account});
 // Discovery returns the work default plus the configured extra for Claude, and one Codex home.
 const discoverAccounts=async(providers,extras)=>{discoveries++;return [
  ...(providers.includes('claude')?[{provider:'claude',directory:'/test/.claude',name:''},{provider:'claude',directory:extras.claude,name:'personal'}]:[]),
  ...(providers.includes('codex')?[{provider:'codex',directory:'/test/.codex',name:''}]:[]),
 ]};
 const exports={};
 vm.runInNewContext(fs.readFileSync(require.resolve('../out/extension'),'utf8'),{
  exports,require:name=>name==='vscode'?vscode
   :name==='./claude'?{detectClaudeVersion:async()=>{},fetchClaudeUsage:async directory=>{calls.claude++;profiles.push(directory);return snapshot('All models',directory==='/test/.claude'?'work@example.com':undefined)}}
   :name==='./codex'?{codexHome:()=>'/test/.codex',fetchCodexUsage:async()=>{calls.codex++;return snapshot('Weekly','codex@example.com')}}
   :name==='./profiles'?{discoverAccounts}:name.startsWith('node:')?require(name)
   :require(path.resolve(__dirname,'../out',name)),
  setInterval:()=>1,clearInterval(){},console,
 });
 await exports.activate({subscriptions:[]});
 assert.deepEqual(calls,{claude:2,codex:1});assert.deepEqual(profiles.sort(),['/test/.claude','~/.claude-personal']);
 assert.equal(live().length,3);assert.equal(live().every(i=>i.visible===false),true);
 assert.equal((html.match(/<h2 class="claude-title">Claude<\/h2>/g)||[]).length,2);assert.match(html,/<h2 class="codex-title">Codex<\/h2>/);
 assert.match(html,/work@example.com/);assert.match(html,/~\/.claude-personal/);assert.match(html,/codex@example.com/);
 assert(!html.includes('Profile:'));assert(!html.includes('Resets in'));assert.equal((html.match(/class="time"/g)||[]).length,3);
 assert.equal(live()[1].text.startsWith('$(claude-usage-logo) personal wk 23%'),true);assert.equal(live()[2].text,'$(codex-usage-logo) Codex wk 23%');
 if(process.env.USAGE_PREVIEW_HTML)fs.writeFileSync(process.env.USAGE_PREVIEW_HTML,html);
 assert(commands['claudeUsageBar.refresh']);
 const before=html;await commands['agentUsageBar.openSettings']();
 assert.equal(live().every(i=>i.visible===true),true);assert.deepEqual(calls,{claude:2,codex:1});assert.equal(discoveries,1);assert.equal(html,before);
 values.agentUsageBar['claude.configDirectory']='~/another';assert.equal(exports.setting('claude.configDirectory',''),'~/another');
 action='providers';await commands['agentUsageBar.openSettings']();await flush();
 assert.equal(live().length,1);assert.equal(live()[0].visible,true);assert(!html.includes('class="claude-title"'));
 assert.equal(calls.claude,2);assert.equal(calls.codex,2);assert.equal(discoveries,2);
 selected=[];await commands['agentUsageBar.openSettings']();await flush();assert.equal(live().length,0);assert.match(html,/Choose providers/);
 action='settings';await commands['agentUsageBar.openSettings']();
 exports.deactivate();
});
