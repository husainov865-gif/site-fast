import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const catalog={
 seo:{name:'site-fast-SEO',capability:'seo',files:['ENTRY.md','references/platform-design-contract.md'],runtime:['seo-audit.mjs','generate-discovery.mjs','check-selection.mjs','lib.mjs','package.json']},
 figma:{name:'site-fast-Figma',capability:'figmaDesign',files:['ENTRY.md','plugin/manifest.json','plugin/code.js','plugin/ui.html','references/workflow.md','references/export-contract.md'],runtime:['validate-export.mjs','shared.cjs','schemas/manifest.schema.json','schemas/layout.schema.json','schemas/tokens.schema.json','schemas/responsive.schema.json','schemas/behavior.schema.json','schemas/validation.schema.json']},
 tilda:{name:'site-fast-Tilda',capability:'tildaImplementation',files:['ENTRY.md','references/conversation.md','references/transfer.md','references/native-mapping.md','references/resume-and-acceptance.md'],runtime:['prepare-transfer.mjs','check-readback.mjs','validate-export.mjs','shared.cjs','schemas/manifest.schema.json','schemas/layout.schema.json','schemas/tokens.schema.json','schemas/responsive.schema.json','schemas/behavior.schema.json','schemas/validation.schema.json']}
};
const inside=(root,p)=>{const rel=path.relative(root,p);return !!rel&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
function safeFile(root,p){try{return inside(root,p)&&fs.statSync(p).isFile()&&inside(root,fs.realpathSync(p));}catch{return false;}}
function safeDirectory(root,p){try{return inside(root,p)&&fs.statSync(p).isDirectory()&&inside(root,fs.realpathSync(p));}catch{return false;}}
function compatible(current,min,major){const a=String(current).trim().split('.').map(Number),b=String(min).split('.').map(Number);if(a.length!==3||b.length!==3||[...a,...b].some(x=>!Number.isInteger(x)||x<0)||a[0]!==major)return false;for(let i=0;i<3;i++){if(a[i]>b[i])return true;if(a[i]<b[i])return false;}return true;}
export function inspectModules(projectArg,{agent}={}){
 if(agent&&!['codex','claude'].includes(agent))throw new Error('Choose --agent codex|claude');
 const project=fs.realpathSync(path.resolve(projectArg||'.')),issues=[],modules={},availability={};
 const bases=['codex','claude'].map(name=>({agent:name,path:path.join(project,name==='codex'?'.agents':'.claude','skills','site-fast')})).filter(b=>safeFile(project,path.join(b.path,'SKILL.md')));
 const active=agent?bases.find(b=>b.agent===agent):bases.length===1?bases[0]:null;
 if(agent&&!active)issues.push({code:'ACTIVE_BASE_MISSING',agent});
 if(!agent&&bases.length>1)issues.push({code:'AGENT_SELECTION_REQUIRED',message:'Choose active Codex or Claude; do not silently use modules from the other agent.'});
 const registryFile=path.join(project,'PROJECT-MODULES.json');let registry={modules:{}},registryReliable=true;
 if(fs.existsSync(registryFile)){try{if(!safeFile(project,registryFile))throw new Error('Unsafe registry');registry=JSON.parse(fs.readFileSync(registryFile,'utf8'));if(!registry.modules||typeof registry.modules!=='object'||Array.isArray(registry.modules))throw new Error('Expected modules object');}catch{registryReliable=false;registry={modules:{}};issues.push({code:'REGISTRY_INVALID',message:'Restore the registry with a backup; do not report all modules absent.'});}}
 for(const[id,spec]of Object.entries(catalog)){
  const item=registry.modules[id],discovered=bases.map(b=>({base:b,dir:path.join(b.path,'modules',id)})).filter(x=>safeDirectory(project,x.dir));
  const info={id,name:spec.name,installed:false,ready:false,contentReady:false,state:'absent',reason:'MODULE_NOT_INSTALLED',action:'install_module',entry:null,tools:null,capabilities:{},externalPrerequisites:[]};availability[id]=info;
  if(!item&&!discovered.length){if(!registryReliable){info.state='unknown';info.reason='REGISTRY_INVALID';info.action='repair_registry';}continue;}
  modules[id]=info;
  if(!item){info.state='unregistered';info.reason='MODULE_NOT_REGISTERED';info.action='finish_installation';info.discoveredPaths=discovered.map(x=>x.dir);continue;}
  info.registered=true;
  if(typeof item!=='object'||typeof item.path!=='string'){info.state='broken';info.reason='INVALID_REGISTRATION';info.action='repair_installation';continue;}
  const dir=path.resolve(project,item.path);info.path=dir;
  const owner=bases.find(b=>path.relative(path.join(b.path,'modules',id),dir)==='');
  if(!owner||!safeDirectory(project,dir)){info.state='broken';info.reason=inside(project,dir)?'MODULE_FILES_MISSING':'UNSAFE_MODULE_PATH';info.action='repair_installation';continue;}
  info.installed=true;info.agent=owner.agent;
  if(!active){info.state='needs_agent_selection';info.reason='AGENT_SELECTION_REQUIRED';info.action='select_agent';continue;}
  if(active.agent!==owner.agent){info.state='other_agent';info.reason='MODULE_INSTALLED_FOR_OTHER_AGENT';info.action='install_for_active_agent';continue;}
  let manifest;
  try{const f=path.join(dir,'module.json');if(!safeFile(project,f))throw new Error('Missing manifest');manifest=JSON.parse(fs.readFileSync(f,'utf8'));if(manifest.id!==id||typeof manifest.entry!=='string'||!safeFile(dir,path.resolve(dir,manifest.entry)))throw new Error('Invalid entry');}catch{info.state='broken';info.reason='MODULE_MANIFEST_OR_ENTRY_INVALID';info.action='repair_installation';continue;}
  Object.assign(info,{version:manifest.version,releaseRevision:manifest.releaseRevision||null,status:manifest.status||'ready',entry:path.resolve(dir,manifest.entry),capabilities:manifest.capabilities||{}});
  if(!/^\d+\.\d+\.\d+$/.test(String(manifest.version))||(item.version&&item.version!==manifest.version)){info.state='broken';info.reason='MODULE_VERSION_MISMATCH';info.action='repair_installation';continue;}
  const baseVersionFile=path.join(active.path,'VERSION'),baseVersion=safeFile(project,baseVersionFile)?fs.readFileSync(baseVersionFile,'utf8').trim():'';
  if(!compatible(baseVersion,manifest.baseMinVersion,manifest.baseMajorVersion??0)){info.state='incompatible';info.reason='BASE_UPDATE_REQUIRED';info.action='update_base';continue;}
  if(manifest.status==='placeholder'||manifest.status==='disabled'||manifest.capabilities?.[spec.capability]!==true){info.state='unavailable';info.reason=manifest.status==='placeholder'?'MODULE_UPDATE_REQUIRED':'CAPABILITY_UNAVAILABLE';info.action='update_module';continue;}
  if(manifest.status&&manifest.status!=='ready'){info.state='unavailable';info.reason='MODULE_STATUS_UNAVAILABLE';info.action='update_module';continue;}
  if(manifest.requiredBaseTools!==undefined&&!Array.isArray(manifest.requiredBaseTools)){info.state='broken';info.reason='MODULE_MANIFEST_OR_ENTRY_INVALID';info.action='repair_installation';continue;}
  if((manifest.requiredBaseTools||[]).some(tool=>typeof tool!=='string'||path.basename(tool)!==tool||!safeFile(project,path.join(project,'tools',tool)))){info.state='incompatible';info.reason='BASE_TOOLS_UPDATE_REQUIRED';info.action='update_base';continue;}
  const toolsValue=item.tools||manifest.toolsPath,tools=typeof toolsValue==='string'?path.resolve(project,toolsValue):null;info.tools=tools;
  const declared=manifest.requiredFiles||{};
  if((declared.module&&!Array.isArray(declared.module))||(declared.runtime&&!Array.isArray(declared.runtime))){info.state='broken';info.reason='MODULE_MANIFEST_OR_ENTRY_INVALID';info.action='repair_installation';continue;}
  const moduleFiles=[...new Set([...spec.files,...(declared.module||[])])],runtimeFiles=[...new Set([...spec.runtime,...(declared.runtime||[])])];
  const missing=moduleFiles.filter(f=>typeof f!=='string'||!safeFile(dir,path.resolve(dir,String(f)))).map(f=>'module/'+f);
  if(!tools||!safeDirectory(project,tools))missing.push('runtime directory');else for(const f of runtimeFiles)if(typeof f!=='string'||!safeFile(tools,path.resolve(tools,String(f))))missing.push('runtime/'+f);
  if(missing.length){info.state='broken';info.reason='MODULE_COMPONENTS_MISSING';info.action='repair_installation';info.missingComponents=missing;continue;}
  info.contentReady=true;
  if(id==='seo'){
   let deps=[];try{const pkg=JSON.parse(fs.readFileSync(path.join(tools,'package.json'),'utf8')),req=createRequire(path.join(tools,'package.json'));deps=Object.keys(pkg.dependencies||{}).filter(name=>{try{req.resolve(name);return false;}catch{return true;}});}catch{deps=['runtime package configuration'];}
   if(deps.length){info.state='environment_incomplete';info.reason='DEPENDENCIES_MISSING';info.action='install_runtime_dependencies';info.missingDependencies=deps;continue;}
  }
  info.ready=true;info.state='ready';info.reason=null;info.action=null;
  if(id==='figma')info.externalPrerequisites=[{name:'Figma Desktop/plugin/fonts',state:'not_checked',action:'verify_in_design_runtime'}];
  if(id==='tilda')info.externalPrerequisites=[{name:'Tilda MCP connection and permissions',state:'not_checked',action:'verify_tools_then_owner_connection_instruction'},{name:'Explicit transfer request',state:'not_checked',action:'wait_for_user_transfer_request'}];
 }
 const bundleAware=registry.bundleAware===true||Object.keys(modules).length>0;
 return{schemaVersion:2,activeAgent:active?.agent||null,inventoryReliable:registryReliable,issues,bundleAware,showModuleChoices:bundleAware,awarenessSource:bundleAware?'local-module-installation-evidence':registryReliable?'none':'unknown',modules,availability,seoInstalled:modules.seo?.installed===true,version:modules.seo?.version,entry:modules.seo?.ready?modules.seo.entry:null};
}
export function requireModule(inventory,id){
 const m=inventory.availability[id];if(!m)throw new Error('Unknown module: '+id);if(m.ready)return null;
 const message=m.state==='absent'?`${m.name} не установлен в текущем проекте. Для этой функции установите модуль.`:
  m.reason==='DEPENDENCIES_MISSING'?`${m.name} установлен, но не установлены зависимости его инструментов. Сначала восстановлю окружение.`:
  ['BASE_UPDATE_REQUIRED','BASE_TOOLS_UPDATE_REQUIRED'].includes(m.reason)?`${m.name} найден, но требуется обновление базового скилла.`:
  m.state==='unregistered'?`Файлы ${m.name} найдены, но установка не завершена. Нужно запустить установщик модуля.`:
  m.state==='other_agent'?`${m.name} установлен для другого агента. Установите модуль в текущую рабочую установку.`:
  m.state==='needs_agent_selection'?`Нужно определить активную установку Codex или Claude, прежде чем использовать ${m.name}.`:
  m.state==='unknown'?`Не удалось проверить ${m.name}: повреждён реестр модулей. Сначала нужно восстановить проверку установки.`:
  `${m.name} установлен не полностью или недоступен в этой версии. Нужно восстановить или обновить модуль.`;
 return{module:id,package:m.name,code:m.reason||'MODULE_UNAVAILABLE',state:m.state,action:m.action,message};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const a=process.argv.slice(2),i=a.indexOf('--agent');console.log(JSON.stringify(inspectModules(a[0]&&!a[0].startsWith('--')?a[0]:'.',{agent:i>=0?a[i+1]:undefined}),null,2));}catch(e){console.error(e.message);process.exitCode=2;}}
