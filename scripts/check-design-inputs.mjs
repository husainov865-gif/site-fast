import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const kinds=['structure','content','brand','logo','photo','reference','contacts'];
export function checkDesignInputs(projectArg,{agent}={}){
 const root=fs.realpathSync(path.resolve(projectArg)),errors=[],warnings=[],add=(code,detail)=>errors.push({code,detail});
 for(const file of ['Структура сайта.md','Фирменный стиль.md'])if(!fs.existsSync(path.join(root,file))||!fs.statSync(path.join(root,file)).size)add('WORKING_DOCUMENT_REQUIRED',file);
 const routeFile=path.join(root,'docs/project-route.json');
 let route=null;
 if(!fs.existsSync(routeFile))add('ROUTE_REQUIRED','Сначала определить и сохранить маршрут, без подстановки вымышленных ответов.');
 else{
  const args=[path.join(path.dirname(fileURLToPath(import.meta.url)),'plan-route.mjs'),root,routeFile,'--for-design'];if(agent)args.push('--agent',agent);
  const result=spawnSync(process.execPath,args,{encoding:'utf8'});
  try{route=JSON.parse(result.stdout);for(const b of route.blockers||[])if(['design','seo','handoff','requirements'].includes(b.stage))add(b.code,b.message||b.field||b.module);}
  catch{add('ROUTE_INVALID',(result.stderr||'Invalid route').trim());}
 }
 const file=path.join(root,'docs/design-materials.json');let pool=null;
 try{pool=JSON.parse(fs.readFileSync(file,'utf8'));if(pool.schemaVersion!==1||!Array.isArray(pool.items))throw new Error('Expected schemaVersion1/items');}
 catch{add('MATERIALS_CHECK_REQUIRED','Агент должен сверить материалы с макетом и заполнить docs/design-materials.json после команды Начать.');}
 if(pool){
  if(pool.reviewStage!=='after-start'||typeof pool.startAuthorization!=='string'||!pool.startAuthorization.trim()||typeof pool.reviewedAt!=='string'||Number.isNaN(Date.parse(pool.reviewedAt)))add('AFTER_START_REVIEW_REQUIRED','Зафиксировать разрешённый старт и фактическую повторную проверку материалов после него.');
  const seen=new Set();
  for(const kind of kinds)if(!pool.items.some(x=>x.kind===kind))add('MATERIAL_KIND_UNREVIEWED',kind);
  for(const item of pool.items){
   if(!item||typeof item.id!=='string'||!item.id.trim()||seen.has(item.id)){add('MATERIAL_ID_INVALID',String(item?.id));continue;}seen.add(item.id);
   if(!kinds.includes(item.kind)||typeof item.required!=='boolean'){add('MATERIAL_CHECK_INVALID',item.id);continue;}
   const hard=item.required||['structure','content','brand'].includes(item.kind),issue=(code,msg)=>hard?add(code,item.id+': '+msg):warnings.push({code,detail:item.id+': '+msg});
   if(item.status==='not-needed'){if(!item.reason?.trim())add('MATERIAL_DECISION_REQUIRED',item.id);if(['structure','content','brand'].includes(item.kind))add('CORE_MATERIAL_CANNOT_BE_SKIPPED',item.id);continue;}
   if(item.status==='approved-placeholder'){if(!item.approval?.trim())add('PLACEHOLDER_APPROVAL_REQUIRED',item.id);else warnings.push({code:'PROTOTYPE_PLACEHOLDER',detail:item.id+'; заменить/согласовать до публикации'});continue;}
   if(item.status==='approved-agent-creation'){issue('MATERIAL_CREATION_PENDING','Разрешение создать материал получено; сначала создать файл, затем повторить проверку.');continue;}
   if(item.status!=='available'){issue('MATERIAL_MISSING','Уточнить/дособрать нужное для '+(item.scope||item.kind));continue;}
   const source=item.source;
   if(!source||!['file','url','message'].includes(source.type)||typeof source.value!=='string'||!source.value.trim()||source.verified!==true){issue('MATERIAL_SOURCE_UNVERIFIED','Источник не подтверждён.');continue;}
   if(source.type==='file'){
    const target=path.resolve(root,source.value),rel=path.relative(root,target);
    if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)||!fs.existsSync(target)||!fs.statSync(target).isFile()||!fs.statSync(target).size){issue('MATERIAL_FILE_MISSING','Сохранить нужный исходник в materials/ проекта.');continue;}
    const real=path.relative(root,fs.realpathSync(target));if(real==='..'||real.startsWith('..'+path.sep)||path.isAbsolute(real))issue('MATERIAL_SOURCE_OUTSIDE_PROJECT','Скопировать разрешённый исходник в проект.');
   }
   if(source.type==='url'&&(!/^https?:\/\//i.test(source.value)||!source.checkedAt?.trim()))issue('MATERIAL_URL_NOT_CHECKED','Ссылка должна быть фактически просмотрена и отмечена датой проверки.');
  }
 }
 return{valid:errors.length===0,errors,warnings,route:route?.route||null,reviewedItems:pool?.items?.length||0,nextAction:errors.length?'Дособрать только недостающее, затем повторить проверку и продолжить уже разрешённый старт.':'Можно приступать к макету.',limits:'Checks recorded requirements, file presence and decisions; does not prove visual content or remote access. Agent must actually inspect sources.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const a=process.argv.slice(2);if(a.includes('--help')){console.log('check-design-inputs.mjs <project> [--agent codex|claude]');process.exit(0);}const i=a.indexOf('--agent');const result=checkDesignInputs(a[0]||'.',{agent:i>=0?a[i+1]:undefined});console.log(JSON.stringify(result,null,2));process.exitCode=result.valid?0:1;}catch(e){console.error(e.message);process.exitCode=2;}
}
