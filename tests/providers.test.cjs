const {test}=require('node:test');
const assert=require('node:assert/strict');
const {toCodexSnapshot,codexHome}=require('../out/codex');
const {toClaudeRows}=require('../out/claude');
const window=(usedPercent,windowDurationMins)=>({usedPercent,windowDurationMins,resetsAt:1790000000});
test('Codex shows only the main weekly limit, excluding Spark',()=>{
 const bucket={limitId:'codex',primary:window(6,10080)};
 const r=toCodexSnapshot({rateLimits:bucket,rateLimitsByLimitId:{codex:bucket,spark:{limitName:'Spark',primary:window(20,300),secondary:window(30,10080)}}});
 assert.deepEqual(r.rows.map(x=>x.label),['Weekly']);
 assert.equal(r.rows[0].resetsAt.getTime(),1790000000000);
 assert.deepEqual(r.rows.map(x=>x.percent),[6]);
});
test('missing windows, nonfinite percentages, and nonstandard durations are handled',()=>{
 assert.equal(toCodexSnapshot({rateLimits:{}}).rows.length,0);
 const r=toCodexSnapshot({rateLimits:{primary:window(NaN,300),secondary:window(2,15)}});
 assert.equal(r.rows.length,0);assert.match(r.note,/No weekly limit/);
 assert.match(toCodexSnapshot({rateLimits:{credits:{unlimited:true}}}).note,/Unlimited/);
 assert.match(toCodexSnapshot({rateLimits:{},ordinaryUsageAllowed:false}).note,/unavailable/);
});
test('weekly may be secondary and a Spark-only response is not substituted',()=>{
 const r=toCodexSnapshot({rateLimits:{primary:window(12,300),secondary:window(42,10080)}});
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].percent,42);assert.equal(r.rows[0].shortLabel,'wk');
 assert.equal(toCodexSnapshot({rateLimits:{limitId:'spark',primary:window(99,10080)}}).rows.length,0);
});
test('Codex home selection honors explicit profile and environment',()=>{
 assert.equal(codexHome('','', '/Users/test'),'/Users/test/.codex');
 assert.equal(codexHome('~/personal','/environment','/Users/test'),'/Users/test/personal');
 assert.equal(codexHome('','/environment'),'/environment');assert.throws(()=>codexHome('relative'),/absolute/);
});
test('Claude current and legacy shapes preserve model limits and skip invalid values',()=>{
 assert.deepEqual(toClaudeRows({limits:[{kind:'session',percent:12,resets_at:null},{kind:'weekly_scoped',percent:20,scope:{model:{display_name:'Fable'}}},{kind:'weekly_all',percent:NaN}]}).map(x=>x.shortLabel),['5h','Fable']);
 const r=toClaudeRows({five_hour:{utilization:23.6,resets_at:'invalid'},seven_day:{utilization:4,resets_at:null}});
 assert.equal(r[0].percent,24);assert.equal(r[0].resetsAt,null);assert.equal(r[1].shortLabel,'wk');
});
