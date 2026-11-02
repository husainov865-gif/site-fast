import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {checkDesignInputs} from '../scripts/check-design-inputs.mjs';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'readiness-'));let count=0;
const write=(p,data)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof data==='string'?data:JSON.stringify(data,null,2));};
function project(){
 const dir=path.join(temp,'site-'+(++count));execFileSync(process.execPath,[path.join(base,'scripts/create-project.mjs'),dir],{stdio:'pipe'});
 write(path.join(dir,'Структура сайта.md'),'Задача, аудитория и структура из тестового брифа');write(path.join(dir,'Фирменный стиль.md'),'Оформление согласовано в тестовом брифе');
 const route={projectType:'small',scenario:'new',seo:false,implementation:'server',design:'html',confirmedFields:['projectType','scenario'],decisionNotes:{projectType:'Пользователь: небольшой сайт',scenario:'Пользователь: новый'}};
 write(path.join(dir,'docs/project-route.json'),route);
 const items=['structure','content','brand'].map(kind=>({id:kind,kind,required:true,status:'available',source:{type:'message',value:'TEST: actual supplied '+kind,verified:true}}));
 for(const kind of ['logo','photo','reference','contacts'])items.push({id:kind,kind,required:false,status:'not-needed',reason:'TEST: not required by these blocks'});
 write(path.join(dir,'docs/design-materials.json'),{schemaVersion:1,reviewStage:'after-start',startAuthorization:'TEST: user said Start',reviewedAt:new Date().toISOString(),items});return dir;
}
function edit(dir,file,change){const p=path.join(dir,file),data=JSON.parse(fs.readFileSync(p,'utf8'));change(data);write(p,data);}
test('free project with supplied answers and reviewed material pool can start HTML design',()=>assert(checkDesignInputs(project()).valid));
test('route cannot start design when size/scenario questions were silently skipped',()=>{
 const dir=project();edit(dir,'docs/project-route.json',x=>{x.confirmedFields=[];x.decisionNotes={};});const r=checkDesignInputs(dir);assert(!r.valid);assert.equal(r.errors.filter(e=>e.code==='ROUTE_ANSWER_REQUIRED').length,2);
});
test('bundle mode requires SEO/platform/design answers even when the basic brief exists',()=>{
 const dir=project();write(path.join(dir,'PROJECT-MODULES.json'),{schemaVersion:1,bundleAware:true,modules:{}});
 let r=checkDesignInputs(dir);assert.equal(r.errors.filter(e=>e.code==='ROUTE_ANSWER_REQUIRED').length,3);
 edit(dir,'docs/project-route.json',x=>{for(const f of ['seo','implementation','design']){x.confirmedFields.push(f);x.decisionNotes[f]='TEST: explicit user choice '+f;}});
 assert(checkDesignInputs(dir).valid);
});
test('after Start missing required photo pauses and resolves with the real file without rebuilding brief',()=>{
 const dir=project(),before=fs.readFileSync(path.join(dir,'Структура сайта.md'));
 edit(dir,'docs/design-materials.json',x=>{const p=x.items.find(i=>i.kind==='photo');p.required=true;p.status='missing';p.scope='hero';});
 assert(checkDesignInputs(dir).errors.some(e=>e.code==='MATERIAL_MISSING'));
 write(path.join(dir,'materials/photo.jpg'),'TEST FILE PRESENCE ONLY, NOT AN IMAGE RENDER');
 edit(dir,'docs/design-materials.json',x=>{const p=x.items.find(i=>i.kind==='photo');p.status='available';p.source={type:'file',value:'materials/photo.jpg',verified:true};});
 assert(checkDesignInputs(dir).valid);assert.deepEqual(fs.readFileSync(path.join(dir,'Структура сайта.md')),before);
});
test('nonessential logo/photo can be explicitly not needed; vague skip is rejected',()=>{
 const dir=project();assert(checkDesignInputs(dir).valid);edit(dir,'docs/design-materials.json',x=>delete x.items.find(i=>i.kind==='logo').reason);assert(checkDesignInputs(dir).errors.some(e=>e.code==='MATERIAL_DECISION_REQUIRED'));
});
test('unverified facts, inaccessible required source and unapproved placeholder stop construction',()=>{
 const dir=project();edit(dir,'docs/design-materials.json',x=>{x.items[0].source.verified=false;});assert(checkDesignInputs(dir).errors.some(e=>e.code==='MATERIAL_SOURCE_UNVERIFIED'));
 edit(dir,'docs/design-materials.json',x=>{x.items[0].status='approved-placeholder';});assert(checkDesignInputs(dir).errors.some(e=>e.code==='PLACEHOLDER_APPROVAL_REQUIRED'));
});
test('approved generation is pending until its output actually exists',()=>{
 const dir=project();edit(dir,'docs/design-materials.json',x=>{const p=x.items.find(i=>i.kind==='photo');p.required=true;p.status='approved-agent-creation';p.approval='TEST user allowed illustration';});assert(checkDesignInputs(dir).errors.some(e=>e.code==='MATERIAL_CREATION_PENDING'));
});
test('unreviewed material classes and missing files are visible rather than assumed complete',()=>{
 const dir=project();edit(dir,'docs/design-materials.json',x=>{x.items=x.items.filter(i=>i.kind!=='contacts');x.items[0].source={type:'file',value:'materials/missing.txt',verified:true};});const r=checkDesignInputs(dir);assert(r.errors.some(e=>e.code==='MATERIAL_KIND_UNREVIEWED'));assert(r.errors.some(e=>e.code==='MATERIAL_FILE_MISSING'));
});

test('a reused material list without a review after the authorized Start does not pass',()=>{
 const dir=project();edit(dir,'docs/design-materials.json',x=>{x.reviewStage='not-reviewed';x.startAuthorization=null;});assert(checkDesignInputs(dir).errors.some(e=>e.code==='AFTER_START_REVIEW_REQUIRED'));
});
