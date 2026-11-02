import fs from 'node:fs';
import path from 'node:path';
import { inspectModules, requireModule } from './module-status.mjs';
try {
  const project=path.resolve(process.argv[2]||'.'), config=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
  const args=process.argv.slice(2),agentIndex=args.indexOf('--agent');
  const inventory=inspectModules(project,{agent:agentIndex>=0?args[agentIndex+1]:undefined}),{modules}=inventory;
  if(!['landing','small','large','store'].includes(config.projectType)||!['new','migration','improve'].includes(config.scenario)||!['server','tilda'].includes(config.implementation)||typeof config.seo!=='boolean') throw new Error('Required: projectType, scenario, implementation(server|tilda), seo(boolean)');
  const design=config.design||(modules.figma?'figma':'html');
  if(!['figma','html','export'].includes(design)) throw new Error('Invalid design route');
  const blockers=[],steps=[];
  if(args.includes('--for-design')){
    const labels={projectType:'размер и тип сайта',scenario:'новый сайт, переезд или доработка',seo:'нужно ли SEO',implementation:'Тильда или свой сервер',design:'Figma или HTML'};
    const required=inventory.bundleAware?['projectType','scenario','seo','implementation','design']:['projectType','scenario'];
    for(const field of required)if(!Array.isArray(config.confirmedFields)||!config.confirmedFields.includes(field)||typeof config.decisionNotes?.[field]!=='string'||!config.decisionNotes[field].trim()){
      blockers.push({code:'ROUTE_ANSWER_REQUIRED',stage:'requirements',field,action:'ask_only_unanswered_question',message:'Уточните: '+labels[field]+'. Зафиксируйте реальный ответ до создания дизайна.'});
    }
  }
  const need=(id,stage)=>{const issue=requireModule(inventory,id);if(issue)blockers.push({...issue,stage});};
  if(config.seo)need('seo','seo');
  if(design==='figma')need('figma','design');
  if(design==='export'&&!config.exportPath) blockers.push({code:'EXPORT_REQUIRED',stage:'handoff'});
  if(config.implementation==='tilda')need('tilda','implementation');
  if(config.implementation==='tilda'&&design==='html') blockers.push({code:'TILDA_REQUIRES_APPROVED_FIGMA_EXPORT',stage:'handoff',action:'choose_figma_design_or_provide_export',message:'Нужен согласованный ZIP Figma. Если макета ещё нет — выберите создание в Figma; если ZIP есть — передайте его, Figma-модуль для самого переноса не нужен.'});
  steps.push('materials-and-route','confirmed-route-checkpoint','after-start-materials-checkpoint');
  if(config.scenario!=='new')steps.push('existing-site-inventory');
  if(config.seo)steps.push('seo-discovery-and-design-input');
  if(design==='figma')steps.push('local-figma-plugin','owner-design-review','export-current-layers','validate-export');
  else if(design==='html')steps.push('html-prototype','owner-design-review');
  else steps.push('validate-approved-export');
  if(config.implementation==='tilda')steps.push('validate-approved-zip','owner-mcp-connection-instructions','verify-connected-mcp','await-explicit-tilda-transfer-prompt');
  steps.push(config.implementation==='server'?'implement-server-release':'tilda-native-transfer-and-readback');
  if(config.seo)steps.push(config.implementation==='server'?'seo-static-or-server-checks':'seo-platform-settings-and-preview-checks');
  steps.push('owner-implementation-review','separate-publication-permission',config.implementation==='server'?'publish-server':'publish-tilda');
  if(config.seo)steps.push('seo-live-checks-and-consoles');
  const result={schemaVersion:2,route:{...config,design,parallelHtmlDesign:false},bundleAware:inventory.bundleAware,showModuleChoices:inventory.showModuleChoices,status:blockers.length?'partial':'ready',blockers,canPrepareDesign:!blockers.some(x=>['design','seo','handoff','requirements'].includes(x.stage)),canExecuteRequestedRoute:blockers.length===0,canAutoStartTildaTransfer:false,executionPrerequisites:config.implementation==='tilda'?['approved-validated-export','owner-mcp-setup-completed','available-official-mcp-tools','explicit-transfer-request-with-project-and-zip']:[],steps,notes:config.implementation==='tilda'?['Ready means workflow availability, not MCP connectivity. Connect MCP using owner instructions BEFORE sending the separate transfer prompt. Never create a page from setup/design approval alone.']:[]};
  console.log(JSON.stringify(result,null,2));process.exitCode=blockers.length?1:0;
} catch(error){console.error(error.message);process.exitCode=2;}
