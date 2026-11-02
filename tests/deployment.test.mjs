import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inventory,digest,validate,evidence,stages} from '../scripts/deployment-check.mjs';
const bundle=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function write(root,name,text){const f=path.join(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,text);}
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'deploy-evidence-'));
 write(root,'release/public/index.html','<h1>Approved site</h1>');write(root,'reports/actual.json','{"fixture":true}');
 const fingerprint=digest(JSON.stringify(inventory(path.join(root,'release/public'))));
 const ref=evidence(root,'reports/actual.json');
 const state={schemaVersion:1,project:'fixture',server:'server.test',releaseId:'r1',manifestSha256:fingerprint,authorization:{reference:'Owner explicit publish instruction'},forms:'none',stages:Object.fromEntries(stages.map(x=>[x,{status:'passed',releaseSha256:fingerprint,evidence:[ref]}])),dns:{authoritativeEvidence:ref,recursiveStatus:'converged'},tls:{renewalEvidence:ref}};
 state.stages.mail={status:'not_applicable',reason:'No forms in this project'};
 return {root,state};
}
test('complete staged artifacts pass; missing private inspection prevents activation',()=>{
 const {root,state}=fixture();assert(validate(root,state).complete);
 state.stages.private.status='not_checked';assert(!validate(root,state,'activate').valid);
});
test('release changes invalidate candidate and later evidence',()=>{
 const {root,state}=fixture();write(root,'release/public/index.html','Changed');
 const r=validate(root,state);assert(!r.valid);assert(r.errors.some(x=>x.includes('stale release')));
});
test('changed or absent proof cannot be treated as checked',()=>{
 const {root,state}=fixture();write(root,'reports/actual.json','Other result');assert(!validate(root,state).valid);
 fs.unlinkSync(path.join(root,'reports/actual.json'));assert(!validate(root,state).valid);
});
test('DNS caches and mail delivery pending remain separate from technical completion',()=>{
 const {root,state}=fixture();state.forms='enabled';state.stages.mail={status:'passed',releaseSha256:state.manifestSha256,evidence:[evidence(root,'reports/actual.json')]};state.dns.recursiveStatus='mixed';state.mailDelivery={status:'smtp_accepted',evidence:evidence(root,'reports/actual.json')};
 const r=validate(root,state);assert(r.valid);assert(!r.complete);assert.equal(r.pending.length,2);
});
test('public inventory rejects service and secret paths, permits ACME well-known',()=>{
 const {root}=fixture(),pub=path.join(root,'release/public');
 write(root,'release/public/.well-known/acme-challenge/token','challenge');assert.doesNotThrow(()=>inventory(pub));
 write(root,'release/public/.env','secret');assert.throws(()=>inventory(pub),/Private/);
 fs.unlinkSync(path.join(pub,'.env'));write(root,'release/public/service/server.mjs','backend');assert.throws(()=>inventory(pub),/Private/);
});
test('disabled forms require an explicit owner decision, no implied success',()=>{
 const {root,state}=fixture();state.forms='disabled-approved';state.stages.mail={status:'deferred',reason:'SMTP pending'};
 assert(!validate(root,state,'activate').valid);state.stages.mail.approval='Owner permits disabled forms';const r=validate(root,state);assert(r.valid);assert(!r.complete);
});
test('form backend actually starts through current directory junction/symlink',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'form-symlink-')),current=path.join(root,'current');
 fs.symlinkSync(path.join(bundle,'assets/form-service'),current,process.platform==='win32'?'junction':'dir');
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>resolve(n));});});
 const child=spawn(process.execPath,[path.join(current,'server.mjs')],{env:{...process.env,MAIL_ENABLED:'false',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
 try {
  const deadline=Date.now()+7000;
  while(!log.includes('Form service listening')&&Date.now()<deadline&&child.exitCode===null)await new Promise(r=>setTimeout(r,50));
  assert(log.includes('Form service listening'),log||'No service start');
  const response=await fetch('http://127.0.0.1:'+port+'/health');assert.equal(response.status,200);assert.equal((await response.json()).mailEnabled,false);
 } finally {child.kill(); await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));}
});

test('SEO-enabled publication cannot pass private stage without installed SEO checks',()=>{
 const {root,state}=fixture();write(root,'docs/seo/selection.json','{"mode":"on"}');
 const result=validate(root,state,'activate');assert(!result.valid);assert(result.errors.some(x=>x.includes('Missing installed SEO tool')));
});
