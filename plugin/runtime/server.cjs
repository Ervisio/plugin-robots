#!/usr/bin/env node
/** Headless, unprivileged Chromium controlled through Ervisio SDK over a local Unix socket. */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const SOCKET = process.env.ROBOT_SOCKET || '/run/ervisio-browser-robots/control.sock';
const DATA = process.env.ROBOT_DATA || '/var/lib/ervisio-browser-robots';
const MAX_BODY = 128 * 1024;
const VIEW = {width: 1120, height: 700};
const sessions = new Map();
const runs = new Map();
let browser = null;
let engine = null;
const randomId = () => randomBytes(7).toString('hex');
const workflowsPath = path.join(DATA, 'workflows.json');
const safeName = name => String(name || '').trim().slice(0, 80);
const wait = t => new Promise(r => setTimeout(r, t));
const fail = (message, status=400) => Object.assign(new Error(message), {status});
function readWorkflows(){ try{return JSON.parse(fs.readFileSync(workflowsPath, 'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;} }
function writeWorkflows(value){ const tmp = workflowsPath + '.tmp';fs.writeFileSync(tmp, JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,workflowsPath); }
function serializeSession(s){ return {id:s.id,label:s.label,url:s.page?.url()||'about:blank',recording:!!s.recording,actions:s.recording?.steps.length||0,createdAt:s.createdAt}; }
function validateUrl(raw){let u;try{u=new URL(String(raw));}catch{throw fail('Enter a valid http:// or https:// address');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.href.length>2000)throw fail('Only HTTP(S) URLs without embedded credentials are allowed');return u.toString();}
async function getBrowser(){
 if(!engine){try{engine=require('playwright');}catch{throw fail('Playwright missing: run the runtime installer',503);}}
 if(!browser || !browser.isConnected()) browser = await engine.chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
 return browser;
}
function queue(s,task){const work=s.queue.then(()=>{if(s.closed)throw fail('Session closed',410);return task();});s.queue=work.catch(()=>{});return work;}
async function createSession(input){
 if(sessions.size>=4)throw fail('Limit: four concurrent browser sessions',429);
 const b=await getBrowser();
 const context=await b.newContext({viewport:VIEW,acceptDownloads:false,serviceWorkers:'block',ignoreHTTPSErrors:false});
 const page=await context.newPage();const id=randomId();
 const s={id,label:safeName(input.label)||'Browser '+(sessions.size+1),context,page,queue:Promise.resolve(),createdAt:Date.now(),recording:null,closed:false};
 page.on('popup',popup=>{s.page=popup;});
 sessions.set(id,s);
 try{if(input.url)await page.goto(validateUrl(input.url),{waitUntil:'domcontentloaded',timeout:25000});}
 catch(e){await context.close();sessions.delete(id);throw e;}
 return serializeSession(s);
}
function getSession(id){const s=sessions.get(id);if(!s||s.closed)throw fail('Session not found',404);return s;}
async function closeSession(id){const s=getSession(id);s.closed=true;sessions.delete(id);await s.context.close();return {closed:true};}
async function navigate(s,input,record=true){const url=validateUrl(input.url);await s.page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});if(record && s.recording)s.recording.steps.push({type:'navigate',url});return {url:s.page.url()};}
async function currentSelector(page,fromPoint){
 return page.evaluate(point=>{
   function selector(el){if(!el||el===document.body)return null;
     if(el.id)return '#'+CSS.escape(el.id);
     if(el.getAttribute('data-testid'))return '[data-testid="'+CSS.escape(el.getAttribute('data-testid'))+'"]';
     let result=[];for(let e=el;e&&e.nodeType===1&&e!==document.body;e=e.parentElement){
       let part=e.tagName.toLowerCase();
       if(e.getAttribute('name')){part+='[name="'+CSS.escape(e.getAttribute('name'))+'"]';result.unshift(part);break;}
       const brothers=[...e.parentElement.children].filter(x=>x.tagName===e.tagName);
       if(brothers.length>1)part+=`:nth-of-type(${brothers.indexOf(e)+1})`;
       result.unshift(part);
     }return result.join(' > ');
   }
   const el=point?document.elementFromPoint(point.x,point.y):document.activeElement;
   return {selector:selector(el),password:el?.tagName==='INPUT'&&el.type==='password'};
 },fromPoint||null);
}
async function action(s,a,record=true,secrets={}){
 const p=s.page;let step=null;
 const type=String(a.type||'');
 if(type==='navigate'){return navigate(s,a,record);}
 if(type==='click'){
   const x=Math.round(Number(a.x)),y=Math.round(Number(a.y));
   if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>VIEW.width||y>VIEW.height)throw fail('Invalid click coordinates');
   const sel=record?await currentSelector(p,{x,y}):{selector:a.selector};
   if(!record&&a.selector)await p.locator(a.selector).first().click({timeout:10000});else await p.mouse.click(x,y);
   step={type,x,y,selector:sel.selector};
 }else if(type==='type'){
   const text=String(a.value||'');if(text.length>8000)throw fail('Text too long');
   const sel=record?await currentSelector(p):{selector:a.selector,password:false};
   if(!record&&a.selector)await p.locator(a.selector).first().focus({timeout:10000});
   await p.keyboard.insertText(text);
   if(record && (a.secret||sel.password)){
     const secretKey=String(a.secretKey||'PASSWORD').trim();
     if(!/^[A-Z_][A-Z0-9_]{0,40}$/.test(secretKey))throw fail('Secret name must contain uppercase letters, numbers or _');
     step={type,selector:sel.selector,value:`{{${secretKey}}}`};
   }else step={type,selector:sel.selector,value:text};
 }else if(type==='press'){
   const key=String(a.key||'');
   if(!/^[a-zA-Z0-9+_-]{1,45}$/.test(key))throw fail('Invalid keyboard shortcut');
   await p.keyboard.press(key);step={type,key};
 }else if(type==='scroll'){
   const y=Math.max(-1600,Math.min(1600,Math.round(Number(a.y)||0)));
   await p.mouse.wheel(0,y);step={type,y};
 }else if(type==='back'){await p.goBack({waitUntil:'domcontentloaded',timeout:20000});step={type};}
 else if(type==='forward'){await p.goForward({waitUntil:'domcontentloaded',timeout:20000});step={type};}
 else if(type==='reload'){await p.reload({waitUntil:'domcontentloaded',timeout:20000});step={type};}
 else if(type==='wait'){const ms=Math.max(100,Math.min(10000,Number(a.ms)||800));await wait(ms);step={type,ms};}
 else throw fail('Unknown browser action');
 if(record && s.recording){if(s.recording.steps.length>=400)throw fail('Workflow limit: 400 actions');s.recording.steps.push(step);}
 return {url:p.url(),step};
}
async function screenshot(s){
 let title='';try{title=await s.page.title();}catch{}
 const jpeg=await s.page.screenshot({type:'jpeg',quality:64,timeout:10000,animations:'disabled'});
 return {...serializeSession(s),title,width:VIEW.width,height:VIEW.height,image:jpeg.toString('base64'),mime:'image/jpeg'};
}
function record(s,input){
 if(input.action==='start'){
   if(s.recording)throw fail('Already recording');
   s.recording={id:randomId(),name:safeName(input.name)||'Workflow '+new Date().toISOString(),startUrl:s.page.url(),steps:[],createdAt:Date.now()};
   return {recording:true};
 }
 if(input.action==='discard'){s.recording=null;return {recording:false};}
 if(input.action==='stop'){
   if(!s.recording)throw fail('No recording in progress');
   const item=s.recording;s.recording=null;
   const all=readWorkflows();if(all.length>=100)throw fail('Limit: 100 workflows');
   all.unshift(item);writeWorkflows(all);
   return {recording:false,workflow:item};
 }
 throw fail('Invalid recording action');
}
function getWorkflow(id){const w=readWorkflows().find(w=>w.id===id);if(!w)throw fail('Workflow not found',404);return w;}
function runWorkflow(s,w,secrets){
 const id=randomId();const r={id,workflowId:w.id,sessionId:s.id,status:'running',completed:0,total:w.steps.length,error:null,startedAt:Date.now()};runs.set(id,r);
 (async()=>{
  try{
   await queue(s,async()=>{
    const oldRecording=s.recording;s.recording=null;
    try{
      if(w.startUrl&&w.startUrl!=='about:blank')await navigate(s,{url:w.startUrl},false);
      for(const step of w.steps){
        let a={...step};
        if(a.type==='type'&&typeof a.value==='string'&&/^\{\{[A-Z_][A-Z0-9_]*\}\}$/.test(a.value)){
          const key=a.value.slice(2,-2);
          if(typeof secrets[key]!=='string')throw fail('Missing secret: '+key);
          a.value=secrets[key];
        }
        await action(s,a,false);r.completed++;
      }
    }finally{s.recording=oldRecording;}
   });
   r.status='completed';
  }catch(e){r.status='failed';r.error=String(e.message||e);}
  r.endedAt=Date.now();
 })();
 return {runId:id};
}
function respond(res,value,status=200){const data=Buffer.from(JSON.stringify(value));res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':data.length,'cache-control':'no-store'});res.end(data);}
async function readJson(req){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw fail('Request too large',413);chunks.push(chunk);}const data=Buffer.concat(chunks).toString()||'{}';try{const o=JSON.parse(data);if(typeof o!=='object'||!o||Array.isArray(o))throw Error();return o;}catch{throw fail('Invalid JSON');}}
async function handler(req,res){
 try{
  const url=new URL(req.url,'http://localhost');const parts=url.pathname.split('/').filter(Boolean);
  const m=req.method;
  if(url.pathname==='/v1/health'&&m==='GET')return respond(res,{ok:true,engine:!!engine,activeSessions:sessions.size});
  if(url.pathname==='/v1/sessions'){
   if(m==='GET')return respond(res,{sessions:[...sessions.values()].map(serializeSession)});
   if(m==='POST')return respond(res,{session:await createSession(await readJson(req))},201);
  }
  if(parts.length>=3&&parts[0]==='v1'&&parts[1]==='sessions'){
   const s=getSession(parts[2]);const part=parts[3];
   if(parts.length===3&&m==='DELETE')return respond(res,await closeSession(s.id));
   if(parts.length===4&&part==='frame'&&m==='GET')return respond(res,await queue(s,()=>screenshot(s)));
   if(parts.length===4&&part==='navigate'&&m==='POST'){const body=await readJson(req);return respond(res,await queue(s,()=>navigate(s,body)));}
   if(parts.length===4&&part==='action'&&m==='POST'){const body=await readJson(req);return respond(res,await queue(s,()=>action(s,body)));}
   if(parts.length===4&&part==='record'&&m==='POST')return respond(res,record(s,await readJson(req)));
  }
  if(url.pathname==='/v1/workflows'&&m==='GET')return respond(res,{workflows:readWorkflows().map(w=>({...w,steps:w.steps.length}))});
  if(parts.length===3&&parts[0]==='v1'&&parts[1]==='workflows'){
   if(m==='GET')return respond(res,{workflow:getWorkflow(parts[2])});
   if(m==='DELETE'){const old=readWorkflows();writeWorkflows(old.filter(w=>w.id!==parts[2]));return respond(res,{deleted:true});}
  }
  if(parts.length===4&&parts[0]==='v1'&&parts[1]==='workflows'&&parts[3]==='run'&&m==='POST'){
   const input=await readJson(req);const s=getSession(input.sessionId);const secrets=input.secrets||{};
   if(typeof secrets!=='object'||Array.isArray(secrets)||Object.keys(secrets).length>30)throw fail('Invalid secrets');
   return respond(res,runWorkflow(s,getWorkflow(parts[2]),secrets),202);
  }
  if(parts.length===3&&parts[0]==='v1'&&parts[1]==='runs'&&m==='GET'){
   const r=runs.get(parts[2]);if(!r)throw fail('Run not found',404);return respond(res,{run:r});
  }
  throw fail('Route not found',404);
 }catch(e){const status=Number(e.status)||500;return respond(res,{error:{message:e.message||'Unknown error'}},status);}
}
function start(){
 fs.mkdirSync(DATA,{recursive:true,mode:0o700});fs.mkdirSync(path.dirname(SOCKET),{recursive:true});
 try{fs.unlinkSync(SOCKET);}catch(e){if(e.code!=='ENOENT')throw e;}
 const server=http.createServer((req,res)=>{handler(req,res).catch(e=>respond(res,{error:{message:e.message}},500));});
 server.listen(SOCKET,()=>{fs.chmodSync(SOCKET,0o600);console.log('Browser Robots listening on '+SOCKET);});
 const cleanup=async()=>{server.close();for(const s of sessions.values())await s.context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});try{fs.unlinkSync(SOCKET);}catch{}process.exit(0);};
 process.on('SIGTERM',cleanup);process.on('SIGINT',cleanup);
 return server;
}
if(require.main===module)start();
module.exports={start,validateUrl,readWorkflows,writeWorkflows,action,record,runWorkflow,handler,parseUrl:validateUrl};
