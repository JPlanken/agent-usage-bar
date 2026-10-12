const {test}=require('node:test');
const assert=require('node:assert/strict');
const {UsageMonitor}=require('../out/monitor');
const {UsageError}=require('../out/usage');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const snap=n=>({rows:[{label:'Weekly',shortLabel:'wk',percent:n,resetsAt:null}]});
for(const staleError of [false,true]) test(`profile reset ignores stale ${staleError?'rate limit':'success'}`,async()=>{
 const m=new UsageMonitor(()=>{});let resolve,reject;
 const old=m.refresh(()=>new Promise((a,b)=>{resolve=a;reject=b}));await flush();
 m.reset();await m.refresh(async()=>snap(34));
 if(staleError)reject(new UsageError('limited',900000));else resolve(snap(99));
 await old;assert.equal(m.state.snapshot.rows[0].percent,34);
 await m.refresh(async()=>snap(35));assert.equal(m.state.snapshot.rows[0].percent,35);
});
test('overlapping refreshes deduplicate and reset aborts pending work',async()=>{
 const m=new UsageMonitor(()=>{});let finish,calls=0,signal;
 const f=s=>{signal=s;calls++;return new Promise(r=>finish=r)};
 const a=m.refresh(f),b=m.refresh(f);await flush();assert.equal(calls,1);assert.equal(a,b);
 m.reset();assert.equal(signal.aborted,true);finish(snap(1));await a;assert.equal(m.state.snapshot,undefined);
});
test('one provider failure retains its last timestamp and leaves other provider available',async()=>{
 const a=new UsageMonitor(()=>{}),b=new UsageMonitor(()=>{});
 await a.refresh(async()=>snap(10));const updated=a.state.updated;
 await Promise.all([a.refresh(async()=>{throw new UsageError('limited',900000)}),b.refresh(async()=>snap(30))]);
 assert.equal(a.state.updated,updated);assert.equal(a.state.snapshot.rows[0].percent,10);
 assert.equal(b.state.snapshot.rows[0].percent,30);
 let called=false;await a.refresh(async()=>{called=true;return snap(50)});assert.equal(called,false);
});
test('synchronous configuration errors do not permanently block refresh',async()=>{
 const m=new UsageMonitor(()=>{});await m.refresh(()=>{throw Error('invalid path')});
 await m.refresh(async()=>snap(20));assert.equal(m.state.error,undefined);assert.equal(m.state.snapshot.rows[0].percent,20);
});
