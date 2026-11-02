// Local readiness/manifest checker. Does not connect to or mutate a server.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export const stages = ['permission','access','inspection','mail','candidate','private','activation','public','handoff'];
export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export function inside(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || /^[a-z]+:/i.test(relative)) throw Error('Expected project-relative path');
  const file = path.resolve(root, relative), rel = path.relative(root,file);
  if (!rel || rel === '..' || rel.startsWith('..'+path.sep)) throw Error('Path escapes project');
  let cursor=root;
  for(const part of rel.split(path.sep)){ cursor=path.join(cursor,part); if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink()) throw Error('Symlink not allowed: '+relative); }
  return file;
}
export function inventory(root) {
  const result={};
  function walk(dir,prefix='') {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const relative=prefix+entry.name, file=path.join(dir,entry.name);
      if(entry.isSymbolicLink()) throw Error('Public symlink: '+relative);
      if(!['.well-known','.htaccess'].includes(entry.name) && /(^\.|^(?:node_modules|docs|materials|tools|service|backend|package(?:-lock)?\.json|project-state\.md)$|\.(?:pem|key|pfx|p12|docx|sql|bak)$)/i.test(entry.name)) throw Error('Private/service artifact in public: '+relative);
      if(entry.isDirectory()) walk(file,relative+'/');
      else if(entry.isFile()) result[relative]=digest(fs.readFileSync(file));
    }
  }
  walk(root);
  if(!Object.keys(result).length) throw Error('Empty public folder');
  return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}
export function evidence(root,relative) {
  const file=inside(root,relative), stat=fs.statSync(file);
  if(!stat.isFile()||!stat.size) throw Error('Evidence missing/empty');
  return {file:relative,sha256:digest(fs.readFileSync(file)),checkedAt:new Date().toISOString()};
}
export function validate(root,state,stage='handoff') {
  const errors=[], pending=[];
  if(!stages.includes(stage)&&stage!=='activate') throw Error('Unknown stage');
  const stop=stage==='activate'?stages.indexOf('private'):stages.indexOf(stage);
  if(state.schemaVersion!==1) errors.push('Invalid schemaVersion');
  if(!state.project || !state.server || !state.releaseId) errors.push('project/server/releaseId required');
  const current=inventory(inside(root,state.publicRoot||'release/public'));
  const fingerprint=digest(JSON.stringify(current));
  if(state.manifestSha256!==fingerprint) errors.push('Release changed or manifest not bound to state');
  for(const id of stages.slice(0,stop+1)) {
    const item=state.stages?.[id];
    if(!item) {errors.push('Missing stage: '+id);continue;}
    if(item.status==='not_applicable' && id==='mail' && item.reason && state.forms==='none') continue;
    if(item.status==='deferred' && id==='mail' && state.forms==='disabled-approved' && item.approval) { pending.push(id+': mail explicitly disabled');continue; }
    if(item.status!=='passed') {errors.push(id+': '+(item.status||'not_checked'));continue;}
    if(['candidate','private','activation','public','handoff'].includes(id) && item.releaseSha256!==fingerprint) errors.push(id+': stale release evidence');
    if(!Array.isArray(item.evidence)||!item.evidence.length) errors.push(id+': evidence required');
    for(const ref of item.evidence||[]) {
      try {
        if(!ref.checkedAt || !Number.isFinite(Date.parse(ref.checkedAt)) || Date.parse(ref.checkedAt)>Date.now()+60000) throw Error('Invalid checkedAt');
        const actual=evidence(root,ref.file);
        if(ref.sha256!==actual.sha256) throw Error('Evidence changed');
      } catch(e) {errors.push(id+': '+e.message);}
    }
  }
  if(stop>=0 && !state.authorization?.reference) errors.push('Explicit publication authorization reference required');
  if(stop>=3 && !['none','enabled','disabled-approved'].includes(state.forms)) errors.push('Choose forms mode');
  if(stop>=7 && state.forms==='enabled' && state.mailDelivery?.status!=='owner_confirmed') pending.push('Owner has not confirmed mail delivery');
  if(stop>=6 && !state.dns?.authoritativeEvidence) errors.push('Authoritative DNS evidence reference missing');
  if(stop>=6 && state.dns?.recursiveStatus!=='converged') pending.push('DNS caches: '+(state.dns?.recursiveStatus||'not_checked'));
  if(stop>=7 && !state.tls?.renewalEvidence) errors.push('TLS renewal evidence reference missing');
  for(const ref of [stop>=6&&state.dns?.authoritativeEvidence,stop>=7&&state.tls?.renewalEvidence,stop>=7&&state.mailDelivery?.evidence].filter(Boolean)) {
    try { if(evidence(root,ref.file).sha256!==ref.sha256) throw Error('Evidence changed'); } catch(e){errors.push(e.message);}
  }
  if(stop>=7 && state.forms==='enabled' && !state.mailDelivery?.evidence) errors.push('Mail delivery evidence required');
  // SEO-on server deployments must not omit the separate release and full-work checks.
  const readOptional=relative=>{const file=inside(root,relative);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;};
  const route=readOptional('docs/project-route.json'),selection=readOptional('docs/seo/selection.json');
  if(route?.implementation==='tilda') errors.push('Tilda route must use Tilda transfer/publication workflow');
  if(route?.seo===false && selection?.mode==='on') errors.push('SEO route and selection conflict');
  if(stop>=stages.indexOf('private') && (route?.seo===true||selection?.mode==='on')) {
    for(const [file,extra] of [['prepare-release.mjs',['--check','--public',state.publicRoot||'release/public']],['seo-delivery.mjs',['--stage',stop>=stages.indexOf('public')?'live':'build']]]) {
      try {
        const tool=inside(root,'tools/site-fast-seo/'+file);
        if(!fs.existsSync(tool))throw Error('Missing installed SEO tool: '+file);
        const args=file==='seo-delivery.mjs'?['check',root,...extra]:[root,...extra];
        const result=spawnSync(process.execPath,[tool,...args],{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
        if(result.error||result.status!==0)throw Error(file+': SEO checks incomplete; run tool for exact pending items');
        if(file==='seo-delivery.mjs'&&!JSON.parse(result.stdout).workComplete)pending.push('Full SEO has owner actions or explicit deferrals; see delivery.json');
      }catch(e){errors.push(e.message);}
    }
  }
  return {schemaVersion:1,stage,valid:!errors.length,complete:!errors.length&&!pending.length,manifestSha256:fingerprint,errors,pending,limits:['Evidence checks validate artifacts, not truth of recorded remote observations.','Filename checks do not detect every secret in file content.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 try {
  const [command,rootArg,arg]=process.argv.slice(2),root=fs.realpathSync(path.resolve(rootArg||'.'));
  if(command==='evidence') console.log(JSON.stringify(evidence(root,arg),null,2));
  else if(command==='manifest') {
    const stateFile=inside(root,'docs/deployment-state.json'), state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{};
    const files=inventory(inside(root,state.publicRoot||'release/public')), out=inside(root,'reports/deployment/public-manifest.json');
    fs.mkdirSync(path.dirname(out),{recursive:true});
    fs.writeFileSync(out,JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),sha256:digest(JSON.stringify(files)),files},null,2)+'\n');
    console.log(out);
  } else if(command==='check') {
    const args=process.argv.slice(2),i=args.indexOf('--stage'),stage=i>=0?args[i+1]:'handoff';
    const result=validate(root,JSON.parse(fs.readFileSync(inside(root,'docs/deployment-state.json'),'utf8')),stage);
    console.log(JSON.stringify(result,null,2));process.exitCode=result.valid?0:1;
  } else throw Error('Usage: deployment-check.mjs manifest|check|evidence <project> [evidence-file | --stage activate|handoff]');
 } catch(e) {console.error(e.message);process.exitCode=2;}
}
