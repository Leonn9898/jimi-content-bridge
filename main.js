// 仅浏览器端载入飞书官方 JS SDK，不包含应用密钥；首次加载需访问公网 CDN。
import {bitable} from 'https://esm.sh/@lark-base-open/js-sdk?bundle';
const $=id=>document.getElementById(id);
let task=null;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function flatten(v){
 if(v==null)return '';
 if(typeof v==='string'||typeof v==='number'||typeof v==='boolean')return String(v);
 if(Array.isArray(v))return v.map(flatten).join('');
 if(typeof v==='object')return typeof v.text==='string'?v.text:typeof v.name==='string'?v.name:'';
 return '';
}
async function loadTable(name){ return await bitable.base.getTableByName(name); }
async function cell(table,recordId,name){const field=await table.getFieldByName(name);return flatten(await table.getCellValue(field.id,recordId));}
async function find(table,key,value){
 let token=undefined;
 for(let p=0;p<15;p++){
  const page=await table.getRecordsByPage({pageSize:200,...(token?{pageToken:token}:{})});
  const records=page.records||[];
  for(const r of records){if((await cell(table,r.recordId,key)).trim()===value)return r.recordId;}
  if(!page.hasMore||!page.pageToken)break;
  token=page.pageToken;
 }
 throw Error(`在 ${key} 中没有找到 ${value}（最多扫描 3000 行）`);
}
$('read').onclick=async()=>{
 $('send').disabled=true;task=null;$('result').textContent='正在通过飞书插件 SDK 读取……';
 try{
  const tasks=await loadTable('04发布任务'); const contents=await loadTable('03内容库'); const accounts=await loadTable('02平台账号');
  const record=await find(tasks,'任务ID','TASK-001');
  const [contentId,customerId,accountId,platform,action,approval,status]=await Promise.all(['内容ID','客户ID','账号ID','平台','目标动作','审核状态','执行状态'].map(n=>cell(tasks,record,n)));
  if(platform!=='微信公众号'||approval!=='已审核'||status!=='待执行')throw Error(`任务未满足测试条件：平台=${platform}，审核=${approval}，执行=${status}`);
  if(!['保存草稿','普通发表'].includes(action))throw Error('目标动作必须是“保存草稿”或“普通发表”');
  const cr=await find(contents,'内容ID',contentId);const ar=await find(accounts,'账号ID',accountId);
  const [contentCustomer,title,body,contentStatus]=await Promise.all(['客户ID','文章标题','正文（纯文本）','内容状态'].map(n=>cell(contents,cr,n)));
  const [accountCustomer,accountPlatform,account,enabled]=await Promise.all(['客户ID','平台','账号显示名','启用状态'].map(n=>cell(accounts,ar,n)));
  if(customerId!==contentCustomer||customerId!==accountCustomer||accountPlatform!=='微信公众号'||enabled!=='启用'||contentStatus!=='已审核')throw Error('客户归属、账号状态或文章审核不匹配');
  if(!title||!body||body.length>20000)throw Error('测试文章标题/正文为空或超过限制');
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  task={taskId:'TASK-001',customerId,account,platform,action,title,body,nonce:[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('')};
  $('preview').textContent=`任务：${task.taskId}\n客户：${customerId}\n目标公众号：${account}\n目标动作：${action}\n标题：${title}\n正文：${body}`;
  $('result').textContent='飞书只读校验通过。';$('send').disabled=false;
 }catch(e){$('result').textContent='读取失败：'+(e?.message||String(e));}
};
function externalMessage(id,payload){return new Promise((resolve,reject)=>{
 if(typeof chrome==='undefined'||!chrome.runtime?.sendMessage){reject(Error('当前飞书自定义插件 iframe 无法访问 Chrome 消息接口；请截图，此环境的通信路径需要调整。'));return;}
 try{chrome.runtime.sendMessage(id,payload,response=>{
  const err=chrome.runtime.lastError;
  if(err){reject(Error(err.message));return;}
  resolve(response);
 });}catch(e){reject(e);}
});}
$('send').onclick=async()=>{
 if(!task)return;const id=$('ext').value.trim();if(!/^[a-p]{32}$/.test(id)){$('result').textContent='请填写 chrome://extensions 中的 32 位扩展 ID';return;}
 $('send').disabled=true;
 try{
  const response=await externalMessage(id,{kind:'JIMI_SUBMIT',task});
  if(!response?.ok)throw Error(response?.error||'发送失败');
  $('result').textContent='插件已接收任务。请点击 Chrome 工具栏中的「季米内容分发｜通信测试」，查看文章并点击“确认模拟完成”。';
  for(let i=0;i<600;i++){
   await delay(2000);
   const r=await externalMessage(id,{kind:'JIMI_POLL',nonce:task.nonce});
   if(!r?.ok)throw Error(r?.error||'轮询失败');
   if(r.done){$('result').textContent='✅ 已收到 Chrome 插件模拟完成回执（仅页面展示；没有改飞书记录、没有发布文章）。';return;}
  }
  $('result').textContent='等待超时：请重新读取任务后再试。';
 }catch(e){$('result').textContent='通信失败：'+(e?.message||String(e));}
 finally{$('send').disabled=false;}
};
