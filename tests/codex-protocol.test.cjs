const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const {fetchCodexUsage}=require('../out/codex');
function server(reply){
 const sent=[];let killed=false,opts;
 const launch=(command,args,options)=>{
  assert.equal(command,'/test/codex');assert.deepEqual(args,['app-server','--stdio']);opts=options;
  const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.exitCode=null;p.signalCode=null;
  p.kill=()=>{killed=true;p.signalCode='SIGTERM';return true};
  p.stdin=new Writable({write(chunk,_,done){const m=JSON.parse(chunk.toString());sent.push(m);queueMicrotask(()=>reply(m,answer=>{
   const text=JSON.stringify(answer)+'\n';p.stdout.write(text.slice(0,7));p.stdout.write(text.slice(7));
  },p));done()}});
  return p;
 };
 return {launch,sent,get killed(){return killed},get options(){return opts}};
}
const options=signal=>({executable:'/test/codex',home:'/test/profile',signal:signal||new AbortController().signal});
test('protocol handshake reads account limits, uses selected home, and closes its child',async()=>{
 const s=server((m,reply)=>{
  if(m.method==='initialize')reply({id:1,result:{}});
  if(m.method==='account/read')reply({id:2,result:{account:{type:'chatgpt'}}});
  if(m.method==='account/rateLimits/read')reply({id:3,result:{rateLimits:{primary:{usedPercent:7,windowDurationMins:10080}}}});
 });
 const r=await fetchCodexUsage(options(),s.launch);
 assert.equal(r.rows[0].percent,7);assert.equal(s.killed,true);
 assert.equal(s.options.env.CODEX_HOME,'/test/profile');assert.equal(s.options.cwd,'/test/profile');
 assert.deepEqual(s.sent.map(x=>x.method),['initialize','initialized','account/read','account/rateLimits/read']);
});
for(const type of [null,'apiKey'])test(`login state ${type} does not request quotas`,async()=>{
 const s=server((m,reply)=>{
  if(m.id===1)reply({id:1,result:{}});
  if(m.id===2)reply({id:2,result:{account:type?{type}:null}});
 });
 await assert.rejects(fetchCodexUsage(options(),s.launch),type?/API-key billing/:/Sign in/);
 assert.equal(s.sent.some(m=>m.method==='account/rateLimits/read'),false);assert.equal(s.killed,true);
});
test('unsupported method yields an upgrade message without leaking server diagnostics',async()=>{
 const s=server((m,reply)=>{if(m.id===1)reply({id:1,error:{code:-32601,message:'sensitive server detail'}})});
 await assert.rejects(fetchCodexUsage(options(),s.launch),e=>/Update Codex/.test(e.message)&&!e.message.includes('sensitive'));
 assert.equal(s.killed,true);
});
test('cancelling a refresh terminates the child process',async()=>{
 const controller=new AbortController(),s=server(()=>{});
 const pending=fetchCodexUsage(options(controller.signal),s.launch);controller.abort();
 await assert.rejects(pending,/cancelled/);assert.equal(s.killed,true);
});
test('missing CLI produces actionable error',async()=>{
 const s=server((_m,_r,p)=>p.emit('error',Object.assign(Error('missing'),{code:'ENOENT'})));
 await assert.rejects(fetchCodexUsage(options(),s.launch),/CLI path/);
});
