import {canRun,runPayload,selectPlotPoint} from './workflow.mjs';
import {loadLearning,recordQuestionAttempt,recordHypothesis,appendLearningEvent,summarizeLearning,getMisconceptions,decideMisconception,getReviewTasks,reviewAction,exportLearning} from './learning-store.js';
const $=id=>document.getElementById(id);
const SESSION_KEY='zhixu-pro-session-v1';
function activeSessionId(){try{let id=sessionStorage.getItem(SESSION_KEY);if(!id){id=crypto.randomUUID();sessionStorage.setItem(SESSION_KEY,id)}return id}catch{return crypto.randomUUID()}}
const state={preDone:false,preCount:0,preTotal:0,transferCount:0,transferTotal:0,transferCompleted:false,store:null,sessionId:activeSessionId(),runId:null,run:null,prediction:'',mentorDone:false,selected:null,plotIndex:0,seriesIndex:0,pointIndex:0,plan:null,renderCount:0};
function isPretestSealed(){return !state.transferCompleted&&!!state.store?.events?.some(e=>e.sessionId===state.sessionId&&e.kind==='question_attempt'&&e.payload.stage==='pre')}
const NS='http://www.w3.org/2000/svg';
function notify(text,error=false){$('global-status').textContent=text;clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('global-status').textContent='',error?8500:4500);}
function elt(tag,classes='',text=''){const el=document.createElement(tag);if(classes)el.className=classes;if(text)el.textContent=text;return el}
function display(el,show){el.hidden=!show}
function scrollToElement(el){el.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}
async function api(path,payload){
 const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),25000);
 try{
  const opt=payload===undefined?{credentials:'same-origin',signal:ctrl.signal}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),credentials:'same-origin',signal:ctrl.signal};
  const res=await fetch(path,opt);const value=await res.json();
  if(!res.ok)throw Error(value.error||'请求失败 '+res.status);
  return value;
 }catch(e){throw Error(e.name==='AbortError'?'请求超时，状态未确认；请查看本轮记录后再试。':e.message)}
 finally{clearTimeout(t)}
}
function evidenceEvent(doWrite){
 if(!state.store)throw Error('本机学习记录不可写；请先备份并检查旧数据');
 return doWrite();
}
function setTaskReady(){ $('run').disabled=!canRun({pretestSubmitted:state.preDone,prediction:$('prediction').value}) || Boolean(state.run); }
function values(){
 return {r:Number($('r').value),x0:Number($('x0').value),logDelta:Number($('logDelta').value),steps:Number($('steps').value)};
}
for(const k of ['r','x0','logDelta','steps']){
 $(k).addEventListener('input',()=>{
  const v=$(k).value;$(k+'-out').textContent=k==='r'?Number(v).toFixed(2):k==='x0'?Number(v).toFixed(3):k==='logDelta'?('−'+Math.abs(Number(v))):v;
 });
}
$('prediction').addEventListener('input',setTaskReady);
$('formula-help').addEventListener('click',()=>{const n=$('formula-note');n.hidden=!n.hidden;$('formula-help').setAttribute('aria-expanded',String(!n.hidden));});
$('layout-switch').addEventListener('click',()=>{
 const enabled=document.body.dataset.layout!=='specimen';document.body.dataset.layout=enabled?'specimen':'article';
 $('layout-switch').setAttribute('aria-pressed',String(enabled));$('layout-switch').textContent=enabled?'回到正文布局':'切换布局';
});
async function renderItem(itemId,host,finished){
 const question=await api('/api/learning/item?itemId='+encodeURIComponent(itemId));
 const form=elt('fieldset','question');const legend=elt('legend','',question.prompt);form.append(legend);
 const unique='q-'+question.itemId.replaceAll('.','-')+'-'+Math.random().toString(36).slice(2,7);
 for(let i=0;i<question.options.length;i++){
  const label=elt('label','option');const input=elt('input');input.type='radio';input.name=unique;input.value=String(i);input.required=true;
  label.append(input,document.createTextNode(question.options[i]));form.append(label);
 }
 const button=elt('button','','独立提交答案');button.type='button';button.disabled=true;
 const feedback=elt('div');feedback.setAttribute('role','status');
 form.querySelectorAll('input').forEach(x=>x.addEventListener('change',()=>button.disabled=false));
 button.addEventListener('click',async()=>{
  const selected=form.querySelector('input:checked');if(!selected)return;
  button.disabled=true;button.textContent='正在提交判分…';
  try{
   const graded=await api('/api/learning/grade',{itemId:question.itemId,attemptToken:question.attemptToken,answer:Number(selected.value)});
   form.querySelectorAll('input').forEach(x=>x.disabled=true);
   feedback.className='feedback';feedback.dataset.correct=question.stage==='pre'?'sealed':String(graded.correct);
   feedback.textContent=question.stage==='pre'?'本次独立前测已封存。完成后续迁移题后可回看评分依据。':(graded.correct?'本题正确。':'本题需要复习。')+graded.feedback+' 正确选项：'+graded.correctAnswerText;
   form.append(feedback);
   button.textContent='已提交';
   try{evidenceEvent(()=>recordQuestionAttempt(state.store,graded,{sessionId:state.sessionId,sourceRunId:state.runId}));}
   catch(err){notify('题目已判分，但本地记录失败：'+err.message,true)}
   renderEvidence();
   if(finished)finished(graded);
  }catch(err){button.disabled=false;button.textContent='独立提交答案';notify('判分失败：'+err.message,true)}
 });
 form.append(button);
 host.append(form);
 return question;
}
async function renderPretest(){
 const host=$('pretest-questions');host.replaceChildren();
 try{
  if(!state.store){host.textContent='学习存储不可用，暂不允许创建本轮学习证据。';return;}
  const {questions}=await api('/api/learning/questions?stage=pre&experiment=sensitivity');
  state.preTotal=questions.length;state.preCount=0;
  for(const q of questions)await renderItem(q.itemId,host,()=>{
    state.preCount++;if(state.preCount===state.preTotal){
      state.preDone=true;display($('forecast'),true);
      $('pretest-message').textContent='独立前测已提交。现在可以写下预测；预测和正式实验之间不可偷看结果。';
      setTaskReady();
      scrollToElement($('forecast'));
    }
   });
 }catch(err){host.textContent='题目读取失败：'+err.message;notify(err.message,true)}
}
$('run').addEventListener('click',async()=>{
 if(!canRun({pretestSubmitted:state.preDone,prediction:$('prediction').value}))return notify('必须先完成前测并填写事前预测',true);
 let payload;try{payload=runPayload(values(),$('prediction').value)}catch(e){return notify(e.message,true)}
 $('run').disabled=true;$('run').textContent='科学计算进行中…';
 try{
  const data=await api('/api/run',payload);
  state.run=data;state.runId=data.runId;state.prediction=payload.prediction;
  for(const k of ['r','x0','logDelta','steps','prediction'])$(k).disabled=true;
  try{evidenceEvent(()=>recordHypothesis(state.store,data.runId,{experiment:data.experiment,prediction:state.prediction,engineVersion:data.engineVersion,condition:data.condition,metrics:data.metrics,results:data.results,lineage:data.lineage},{sessionId:state.sessionId}))}
  catch(e){notify('实验完成，但本地科学证据未能保存：'+e.message,true)}
  renderLab(data);display($('lab'),true);scrollToElement($('lab'));
  if(!$('lab-reopen')){
   const b=elt('button','','重新查看已完成的实验');b.type='button';b.id='lab-reopen';b.className='primary';
   b.addEventListener('click',()=>{display($('lab'),true);scrollToElement($('lab'))});
   $('run').after(b);
  }
  display($('transfer'),true);renderTransfers();renderEvidence();
 }catch(e){$('run').disabled=false;notify('实验未完成：'+e.message,true)}
 finally{$('run').textContent=state.run?'本次预测已封存':'封存预测，展开实验'}
});
$('lab-close').addEventListener('click',()=>{display($('lab'),false);scrollToElement($('forecast'))});
async function renderTransfers(){
 const host=$('transfer-questions');host.replaceChildren();
 try{
  const {questions}=await api('/api/learning/questions?stage=transfer&experiment=sensitivity');
  state.transferTotal=questions.length;state.transferCount=0;
  for(const q of questions)await renderItem(q.itemId,host,()=>{state.transferCount++;if(state.transferCount>=state.transferTotal)state.transferCompleted=true;renderEvidence()});
 }catch(e){host.textContent='迁移题读取失败：'+e.message}
}
function svgEl(tag,attributes={}){
 const n=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attributes))n.setAttribute(key,String(value));return n;
}
function drawChart(run){
 const box=$('chart-box');box.replaceChildren();
 const plots=run.plots||[];if(!plots.length){box.textContent='本次内核未返回曲线。';return;}
 const bar=elt('div','plot-tabs');bar.setAttribute('role','group');bar.setAttribute('aria-label','图形选择');
 plots.forEach((plot,i)=>{const b=elt('button','plot-tab',plot.title);b.type='button';b.setAttribute('aria-pressed',String(state.plotIndex===i));
  b.addEventListener('click',()=>{state.plotIndex=i;state.seriesIndex=0;state.pointIndex=0;drawChart(run)});bar.append(b)});
 box.append(bar);
 const plot=plots[state.plotIndex];$('plot-title').textContent=plot.title;
 const series=plot.series||[],valid=series.map((s,k)=>({
  label:s.label,k,points:(s.points||[]).map((p,i)=>({x:p[0],y:p[1],index:i})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&(plot.yScale!=='log'||p.y>0))
 }));
 const all=valid.flatMap(s=>s.points);if(!all.length){box.append(elt('p','','没有可绘制的数据点'));return}
 const xMin=Math.min(...all.map(p=>p.x)),xMax=Math.max(1,...all.map(p=>p.x));
 const yScale=v=>plot.yScale==='log'?Math.log10(v):v;
 let yMin=Math.min(...all.map(p=>yScale(p.y))),yMax=Math.max(...all.map(p=>yScale(p.y)));
 if(yMax===yMin){yMin-=.01;yMax+=.01}
 const mobile=window.innerWidth<=760;const W=mobile?480:880,H=mobile?360:450,L=mobile?54:65,R=mobile?14:25,T=20,B=mobile?52:45;
 const sx=x=>L+(x-xMin)/(xMax-xMin||1)*(W-L-R),sy=y=>T+(yMax-yScale(y))/(yMax-yMin)*(H-T-B);
 const svg=svgEl('svg',{viewBox:'0 0 '+W+' '+H,role:'img','aria-label':plot.title+' 由科学引擎返回的真实坐标数据'});
 for(let i=0;i<=5;i++){
  const gx=L+(W-L-R)*i/5,gy=T+(H-T-B)*i/5;
  svg.append(svgEl('line',{x1:L,y1:gy,x2:W-R,y2:gy,stroke:'#354c59','stroke-width':1}));
  const xl=svgEl('text',{x:gx,y:H-12,'text-anchor':'middle',fill:'#b8cad1','font-size':mobile?17:14});xl.textContent=String(Number((xMin+(xMax-xMin)*i/5).toPrecision(3)));svg.append(xl);
  const yl=svgEl('text',{x:L-11,y:gy+5,'text-anchor':'end',fill:'#b8cad1','font-size':mobile?16:13});
  const raw=yMax-(yMax-yMin)*i/5;yl.textContent=plot.yScale==='log'?'10^'+raw.toFixed(1):String(Number(raw.toPrecision(3)));svg.append(yl);
 }
 const colors=['#87c8eb','#e8b677','#a3dec1'];
 valid.forEach((s)=>{
  if(!s.points.length)return;
  const d=s.points.map((p,i)=>(i?'L':'M')+sx(p.x).toFixed(2)+' '+sy(p.y).toFixed(2)).join(' ');
  const path=svgEl('path',{d,fill:'none',stroke:colors[s.k%3],'stroke-width':state.seriesIndex===s.k?2.7:1.7,'vector-effect':'non-scaling-stroke'});
  svg.append(path);
  const hit=svgEl('path',{d,fill:'none',stroke:'transparent','stroke-width':19,class:'series-hit'});
  hit.addEventListener('click',event=>{
   const rect=svg.getBoundingClientRect(),vx=(event.clientX-rect.left)/rect.width*W;
   let nearest=s.points[0];for(const p of s.points)if(Math.abs(sx(p.x)-vx)<Math.abs(sx(nearest.x)-vx))nearest=p;
   state.seriesIndex=s.k;state.pointIndex=nearest.index;drawChart(run);
  });svg.append(hit);
 });
 const legend=elt('div','series-picker');legend.setAttribute('role','group');legend.setAttribute('aria-label','数据序列');
 series.forEach((s,i)=>{const b=elt('button','series-button',s.label);b.type='button';b.style.setProperty('--line-color',colors[i%3]);b.setAttribute('aria-pressed',String(i===state.seriesIndex));
  b.addEventListener('click',()=>{state.seriesIndex=i;state.pointIndex=0;drawChart(run)});legend.append(b)});
 const current=selectPlotPoint(plot,state.seriesIndex,state.pointIndex);
 if(current){
  const point=svgEl('circle',{cx:sx(current.x),cy:sy(current.y),r:7,fill:'#f8faf9',stroke:colors[state.seriesIndex%3],'stroke-width':3});svg.append(point);
 }
 box.append(svg,legend);
 $('data-point').max=String(Math.max(0,(series[state.seriesIndex]?.points?.length||1)-1));$('data-point').value=String(state.pointIndex);
 onPointSelected(plot);
}
function onPointSelected(plot){
 const point=selectPlotPoint(plot,state.seriesIndex,state.pointIndex);
 if(!point){state.selected=null;$('point-info').textContent='该点没有有效数值';return}
 state.selected={plotIndex:state.plotIndex,seriesIndex:state.seriesIndex,pointIndex:state.pointIndex};
 $('point-info').textContent=(plot.series[state.seriesIndex]?.label||'轨迹')+' · n='+Number(point.x.toPrecision(7))+'，数值='+Number(point.y.toPrecision(9));
}
$('data-point').addEventListener('input',()=>{if(!state.run)return;state.pointIndex=Number($('data-point').value);drawChart(state.run)});
function renderLab(data){
 $('engine-label').textContent=data.engine+' / '+data.engineVersion;
 state.plotIndex=0;state.seriesIndex=0;state.pointIndex=0;drawChart(data);
 const metrics=$('metric-list');metrics.replaceChildren();
 (data.metrics||[]).slice(0,7).forEach(m=>{const div=elt('div');div.append(elt('dt','',m.label),elt('dd','',String(typeof m.value==='number'?Number(m.value.toPrecision(6)):m.value)+(m.unit?' '+m.unit:'')));metrics.append(div)});
 $('lab-warning').textContent=(data.warnings||[]).join(' ')||'模型输出已完成。数值为有限步数的计算结果，不是对现实世界的证明。';
 $('lab-provenance').textContent='科学来源：'+data.engine+' / '+data.engineVersion+' · 算法指纹 '+String(data.adapterSha256||'未提供').slice(0,16)+'…';
 $('mentor-output').replaceChildren();$('mentor-status').textContent='默认仅调用规则引导；不发送数据到外部模型。';
 $('reflection').value='';state.mentorDone=false;state.plan=null;display($('controlled'),false);display($('approval-section'),false);
}
$('mentor').addEventListener('click',async()=>{
 if(!state.runId)return;
 const button=$('mentor');button.disabled=true;button.textContent='获取本次实验解释…';
 try{
  const note=$('reflection').value.trim();const result=await api('/api/mentor',{runId:state.runId,note,selection:state.selected,shareApproved:false});
  if(note)try{evidenceEvent(()=>appendLearningEvent(state.store,'learning_reflection',{note:note.slice(0,500),experiment:state.run.experiment,selection:state.selected},{sessionId:state.sessionId,sourceRunId:state.runId,conceptIds:['chaos.sensitivity']}))}catch(e){notify('反思未能保存：'+e.message,true)}
  $('mentor-output').replaceChildren();
  const block=elt('div','mentor-response');const name=result.mode==='llm'?'模型辅助（已授权）':'规则导师（未调用外部模型）';
  block.append(elt('strong','',name),elt('p','',result.observed||''),elt('p','',result.question||''),elt('p','',result.suggestion||''));
  if(result.reply)block.append(elt('p','',result.reply));
  $('mentor-output').append(block);$('mentor-status').textContent=result.availability||result.rationale||'规则教学';
  state.mentorDone=true;display($('controlled'),true);renderEvidence();
 }catch(e){notify('导师反馈失败：'+e.message,true)}
 finally{button.disabled=false;button.textContent='再次查看上下文导师'}
});
$('plan-request').addEventListener('click',async()=>{
 if(!state.runId||!state.mentorDone)return notify('请先完成导师反馈',true);
 const b=$('plan-request');b.disabled=true;
 try{
  const plan=await api('/api/agent/plan',{runId:state.runId,goal:$('goal').value.trim(),mode:'rules'});
  state.plan=plan;$('plan-details').replaceChildren();
  $('plan-details').append(elt('p','','建议的单变量对照：'+(plan.why||plan.note||plan.studyQuestion||'规则方案由服务端生成')));
  $('plan-details').append(elt('pre','',JSON.stringify({changes:plan.changes,params:plan.params,limits:plan.limits,expiresAt:plan.expiresAt},null,2)));
  display($('approval-section'),true);$('approval-prediction').value='';$('approve').disabled=true;
 }catch(e){notify('生成对照方案失败：'+e.message,true)}finally{b.disabled=false}
});
$('approval-prediction').addEventListener('input',()=>{
 const v=$('approval-prediction').value.trim();$('approve').disabled=!state.plan||v.length<8||v===state.prediction;
});
$('approve').addEventListener('click',async()=>{
 const plan=state.plan,prediction=$('approval-prediction').value.trim();
 if(!plan||prediction.length<8||prediction===state.prediction)return;
 const b=$('approve');b.disabled=true;b.textContent='执行受控实验中…';
 try{
  const data=await api('/api/agent/approve',{planId:plan.planId,prediction});
  state.prediction=prediction;state.run=data;state.runId=data.runId;
  evidenceEvent(()=>recordHypothesis(state.store,data.runId,{experiment:data.experiment,prediction,engineVersion:data.engineVersion,condition:data.condition,metrics:data.metrics,results:data.results,lineage:data.lineage},{sessionId:state.sessionId}));
  renderLab(data);scrollToElement($('lab'));renderEvidence();notify('本轮审批已消费，第二次实验完成');
 }catch(e){notify('审批未执行或证据保存失败：'+e.message,true)}
 finally{b.textContent='确认并执行第二次实验'}
});
$('map-open').addEventListener('click',async()=>{
 const dialog=$('knowledge-dialog');const host=$('concept-map');host.textContent='正在读取课程概念…';dialog.showModal();
 try{
  const {concepts}=await api('/api/learning/concepts');
  host.replaceChildren();
  const evidence=state.store&&!isPretestSealed()?summarizeLearning(state.store):{concepts:[]};
  const clusterLabels={sensitivity:'Logistic：初值与控制变量','evo-pair':'EvoWorld：重复与外推'};
  for(const [experiment,label] of Object.entries(clusterLabels)){
   const members=concepts.filter(x=>x.experiment===experiment);if(!members.length)continue;
   const group=elt('section','concept-cluster');
   group.append(elt('h3','',label),elt('p','','连接表示同属一个现有课程实验，不代表未经证实的先修依赖。'));
   const lane=elt('div','concept-lane');
   for(const [i,c] of members.entries()){
    if(i)lane.append(elt('span','concept-link',''));
    const current=evidence.concepts.find(x=>x.id===c.id);
    const div=elt('div','concept-node');div.dataset.conceptId=c.id;
    div.append(elt('strong','',c.label),elt('small','',c.id));
    div.append(elt('p','',isPretestSealed()?'本轮前测封存中':(current?.status||'未评估')));
    const b=elt('button','','定位相关课程内容');b.type='button';
    b.addEventListener('click',()=>{dialog.close();scrollToElement(c.experiment==='sensitivity'?$('reading'):$('learning'));});
    div.append(b);lane.append(div);
   }
   group.append(lane);host.append(group);
  }
 }catch(e){host.textContent='知识点加载失败：'+e.message}
});
let mapScale=1;
function updateMapScale(value){
 mapScale=Math.max(.8,Math.min(1.5,Math.round(value*10)/10));
 const el=$('concept-map');el.style.zoom=String(mapScale);
 $('map-zoom-level').textContent=Math.round(mapScale*100)+'%';
 $('map-zoom-in').disabled=mapScale>=1.5;
 $('map-zoom-out').disabled=mapScale<=.8;
}
$('map-zoom-out').addEventListener('click',()=>updateMapScale(mapScale-.1));
$('map-zoom-in').addEventListener('click',()=>updateMapScale(mapScale+.1));
$('map-reset').addEventListener('click',()=>updateMapScale(1));
$('map-close').addEventListener('click',()=>$('knowledge-dialog').close());
$('evidence-open').addEventListener('click',()=>scrollToElement($('learning')));
function renderEvidence(){
 if(!state.store)return;
 if(isPretestSealed()){$('evidence-summary').replaceChildren(elt('p','record-note','前测已封存：完成两道独立迁移题后再查看本轮错题与评分依据。'));$('misconceptions').replaceChildren();$('reviews').replaceChildren();return}
 const summary=summarizeLearning(state.store),host=$('evidence-summary');host.replaceChildren();
 const h=elt('h3','','已有的学习证据');host.append(h);
 for(const [label,value] of [['完成实验记录',summary.explorations],['已提交独立题目',summary.answered],['客观错题',summary.incorrect],['已完成迁移题',summary.transfers],['待复习概念',summary.pendingConcepts]]){
  const row=elt('div','evidence-row');row.append(elt('span','',label),elt('span','',String(value)));host.append(row);
 }
 host.append(elt('h3','','题库概念状态'));
 for(const c of summary.concepts){
  const row=elt('div','evidence-row');row.append(elt('span','',c.id),elt('span','',c.status+' · '+c.evidenceIds.length+' 条题目证据'));host.append(row);
 }
 const misconceptions=$('misconceptions');misconceptions.replaceChildren();
 const ms=getMisconceptions(state.store);if(ms.length){misconceptions.append(elt('h3','','待确认的误区候选'));
  for(const m of ms.slice(-8).reverse()){
   const row=elt('div','evidence-row');row.append(elt('span','',m.payload.hypothesisCode+' · '+m.status+' · 基于题目 '+m.sourceQuestionId));
   const actions=elt('span');for(const [status,label] of [['confirmed','确认'],['rejected','不准确']]){
    const b=elt('button','',label);b.type='button';b.addEventListener('click',()=>{try{decideMisconception(state.store,m.eventId,status);renderEvidence()}catch(e){notify(e.message,true)}});actions.append(b);
   }row.append(actions);misconceptions.append(row);
  }
 }
 const reviews=$('reviews');reviews.replaceChildren();
 const tasks=getReviewTasks(state.store).filter(t=>t.status!=='dismissed');
 if(tasks.length){reviews.append(elt('h3','','待复习 · 完成后仍需巩固'));
  for(const task of tasks.slice(0,5)){
   const row=elt('div','evidence-row');row.append(elt('span','',task.conceptId+' · 到期 '+task.dueAt.slice(0,10)));
   const buttons=elt('span');
   if(task.nextItemId){const b=elt('button','','练新的变式');b.addEventListener('click',async()=>{
    display($('transfer'),true);scrollToElement($('transfer'));
    try{await renderItem(task.nextItemId,$('transfer-questions'),()=>renderEvidence())}catch(e){notify(e.message,true)}
   });buttons.append(b)}
   const defer=elt('button','','推迟一天');defer.addEventListener('click',()=>{reviewAction(state.store,task.reviewId,'defer');renderEvidence()});buttons.append(defer);
   row.append(buttons);reviews.append(row);
  }
 }
}
$('export').addEventListener('click',()=>{
 if(!state.store)return notify('没有可导出的有效学习记录',true);
 const blob=new Blob([exportLearning(state.store)],{type:'application/json'}),url=URL.createObjectURL(blob),a=elt('a');a.href=url;a.download='zhixu-learning-evidence-v2.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
try{state.store=loadLearning();state.transferCompleted=new Set(state.store.events.filter(e=>e.sessionId===state.sessionId&&e.kind==='question_attempt'&&e.payload.stage==='transfer').map(e=>e.payload.itemId)).size>=2;renderEvidence();renderPretest()}catch(e){
 $('pretest-questions').textContent='本地存储校验失败，未覆盖旧记录：'+e.message;notify(e.message,true)
}
