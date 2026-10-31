'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ervisio-robots-'));process.env.ROBOT_DATA=root;process.env.ROBOT_SOCKET=path.join(root,'control.sock');
const mod=require('../plugin/runtime/server.cjs');
function get(pathname){return new Promise((resolve,reject)=>{const req=http.request({socketPath:process.env.ROBOT_SOCKET,path:pathname},res=>{let chunks='';res.on('data',c=>chunks+=c);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(chunks)}));});req.on('error',reject);req.end();});}
test('validates remote browser URLs',()=>{assert.equal(mod.validateUrl('https://example.com/a'),'https://example.com/a');for(const input of ['file:///etc/passwd','javascript:alert(1)','https://user:pass@example.com/','chrome://settings'])assert.throws(()=>mod.validateUrl(input));});
test('HTTP over Unix socket health, empty sessions and workflows',async()=>{const srv=mod.start();await new Promise(r=>srv.once('listening',r));assert.equal((await get('/v1/health')).status,200);assert.deepEqual((await get('/v1/sessions')).data.sessions,[]);assert.deepEqual((await get('/v1/workflows')).data.workflows,[]);await new Promise(r=>srv.close(r));});
test('records actions and replaces sensitive text with a placeholder',async()=>{
 let url='https://example.com';let text='';let clicks=[];
 const page={url:()=>url,evaluate:async()=>({selector:'#token',password:true}),keyboard:{insertText:async t=>{text+=t;},press:async()=>{}},mouse:{click:async(x,y)=>clicks.push([x,y]),wheel:async()=>{}},goto:async u=>{url=u;}};
 const s={id:'fake',page,queue:Promise.resolve(),recording:null,closed:false};
 mod.record(s,{action:'start',name:'Login test'});
 await mod.action(s,{type:'click',x:40,y:50});
 await mod.action(s,{type:'type',value:'super-secret'});
 const saved=mod.record(s,{action:'stop'}).workflow;
 assert.equal(saved.steps[0].type,'click');assert.equal(saved.steps[1].value,'{{PASSWORD}}');assert.equal(text,'super-secret');assert.equal(clicks.length,1);
 const file=fs.readFileSync(path.join(root,'workflows.json'),'utf8');assert.ok(!file.includes('super-secret'));assert.equal(saved.name,'Login test');
});
test('replays a recorded secret from transient supplied values',async()=>{
 let url='about:blank';let typed='';
 const page={url:()=>url,goto:async u=>{url=u;},keyboard:{insertText:async t=>{typed=t;},press:async()=>{}},locator:()=>({first:()=>({focus:async()=>{},click:async()=>{}})})};
 const s={id:'test',page,queue:Promise.resolve(),recording:null,closed:false};
 const w={id:'test-workflow',startUrl:'https://example.com',steps:[{type:'type',selector:'#p',value:'{{PASSWORD}}'}]};
 const r=mod.runWorkflow(s,w,{PASSWORD:'temporary-secret'});assert.ok(r.runId);await new Promise(r=>setTimeout(r,30));assert.equal(typed,'temporary-secret');assert.equal(url,'https://example.com/');
});
test('full session API lifecycle with a fake Playwright browser',async()=>{
  // A minimal fake runtime is injected via NODE_PATH; no real Chromium is needed.
  const moduleRoot=path.join(root,'fake-modules');fs.mkdirSync(path.join(moduleRoot,'playwright'),{recursive:true});
  fs.writeFileSync(path.join(moduleRoot,'playwright','index.js'), `
module.exports={chromium:{launch:async()=>({isConnected:()=>true,newContext:async()=>({newPage:async()=>{let current='about:blank';return {
 on:()=>{},url:()=>current,title:async()=> 'Fake page',goto:async u=>{current=u;},
 screenshot:async()=>Buffer.from('fake-jpeg'),evaluate:async()=>({selector:'#btn',password:false}),
 mouse:{click:async()=>{},wheel:async()=>{}},keyboard:{insertText:async()=>{},press:async()=>{}},
 locator:()=>({first:()=>({click:async()=>{},focus:async()=>{}})}),
 goBack:async()=>{},goForward:async()=>{},reload:async()=>{}};},close:async()=>{}}),close:async()=>{}})}};
`);
  process.env.NODE_PATH=moduleRoot;require('node:module').Module._initPaths();
  const socket=path.join(root,'full.sock');
  // Existing runtime constants are captured on import, so re-use its socket path.
  const srv=mod.start();await new Promise(r=>srv.once('listening',r));
  function req(method,pathname,body){return new Promise((resolve,reject)=>{let payload=body?JSON.stringify(body):'';const q=http.request({socketPath:process.env.ROBOT_SOCKET,path:pathname,method,headers:payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(d)}));});q.on('error',reject);q.end(payload);});}
  let created=await req('POST','/v1/sessions',{url:'https://example.com',label:'Fake'});assert.equal(created.status,201);const id=created.data.session.id;
  let frame=await req('GET',`/v1/sessions/${id}/frame`);assert.equal(frame.status,200);assert.equal(frame.data.image,Buffer.from('fake-jpeg').toString('base64'));
  assert.equal((await req('POST',`/v1/sessions/${id}/record`,{action:'start',name:'Sample flow'})).status,200);
  assert.equal((await req('POST',`/v1/sessions/${id}/action`,{type:'click',x:100,y:200})).status,200);
  assert.equal((await req('POST',`/v1/sessions/${id}/record`,{action:'stop'})).status,200);
  const saved=await req('GET','/v1/workflows');assert.ok(saved.data.workflows.some(w=>w.name==='Sample flow'));
  assert.equal((await req('DELETE',`/v1/sessions/${id}`)).status,200);
  await new Promise(r=>srv.close(r));
});
