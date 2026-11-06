import React from 'react'
import {createRoot} from 'react-dom/client'

// UI harness only: real plugin components, synthetic state, no provider requests or credentials.
const params = new URLSearchParams(location.search)
const scenario = params.get('scenario') || 'ready'
const english = (params.get('lang') || 'zh-CN').startsWith('en')
const now = Math.floor(Date.now()/1000)
let models = [
  {id:'claude-opus-demo',name:'Claude Opus Demo',contextWindow:200000,maxTokens:64000,reasoning:true,enabled:true},
  {id:'claude-sonnet-demo',name:'Claude Sonnet Demo',contextWindow:1000000,maxTokens:64000,reasoning:true,enabled:true},
  {id:'claude-haiku-demo',name:'Claude Haiku Demo',contextWindow:200000,maxTokens:64000,enabled:true},
  {id:'claude-sonnet-previous',name:'Claude Sonnet Previous Generation',contextWindow:200000,maxTokens:32000,enabled:false},
  {id:'claude-haiku-previous',name:'Claude Haiku Previous Generation',contextWindow:200000,maxTokens:32000,enabled:false},
]
let defaultModel=models[1].id
let connected=!['disconnected','login'].includes(scenario)
let failures=scenario==='error'
let pendingLogin=false
window.__previewRequests=[]
const quota={ok:true,source:'usage',fetchedAt:now,fiveHour:{utilization:.42,reset:now+8200,status:'allowed'},sevenDay:{utilization:.83,reset:now+265000,status:'allowed'},extra:[{id:'seven_day_opus',utilization:.91,reset:now+220000,status:'allowed'}]}
let requestCount=0
window.fetch=async (url,opts={})=>{
  requestCount++
  document.querySelector('#request-count').textContent=String(requestCount)
  const path=String(url)
  window.__previewRequests.push({path,method:opts.method||'GET'})
  const data=opts.body?JSON.parse(opts.body):{}
  let body
  if(path.includes('/status')) body={ok:true,authenticated:connected,canAdopt:false,email:'preview@example.invalid',sub:'max',tier:'default_claude_max_5x',modelsAt:1}
  else if(path.includes('/models')) {
    if(opts.method==='POST'&&failures) return new Response(JSON.stringify({ok:false,error:'Preview: model settings could not be saved.'}),{status:503})
    if(data.enabled) models=models.map(m=>({...m,enabled:data.enabled.includes(m.id)}))
    if(data.defaultModel)defaultModel=data.defaultModel
    body={ok:true,models,defaultModel,canSetDefault:true}
  } else if(path.includes('/quota')) body=!connected?{ok:false,error:'Not connected.'}:failures?{ok:false,error:'Preview: quota service unavailable (503).'}:scenario==='manual'?{ok:true,manualRequired:true,source:'none'}:quota
  else if(path.includes('/logout')) {connected=false;pendingLogin=false;body={ok:true}}
  else if(path.includes('/cancel')) {pendingLogin=false;body={ok:true}}
  else if(path.includes('/login')) {
    if(scenario==='login') {pendingLogin=true;body={ok:true,authUrl:'about:blank#preview-authorization'}}
    else body={ok:false,error:'Preview only: authentication is not started.'}
  }
  else body={ok:true}
  return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}})
}
window.__previewRecover=()=>{failures=false;window.dispatchEvent(new Event('focus'))}
window.__previewCompleteLogin=()=>{if(pendingLogin){pendingLogin=false;connected=true}}
window.__previewLoginPending=()=>pendingLogin
let definition
window.__ModuleLoader__={load: d=>{definition=d}}
await import('/plugin.js')
const plugin=definition.factory(name=>{if(name==='react')return React;throw new Error(name)})
const components={}
const slots={inject:(_,cb)=>cb(),register:(meta,component)=>{components[meta.name]=component;return ()=>{}}}
const modelDirectories={directoryFor:()=>({store:{getSnapshot:()=>({status:'ready',current:{provider:'anthropic',model:models[1].id}}),subscribe:()=>()=>{}}})}
plugin.apply({slots,inject:(_,cb)=>cb({slots,modelDirectories})})
const Settings=components['settings.section']
const Meter=components['conversation.input.right']
const Dock=components['conversation.composer.dock']
const app=createRoot(document.querySelector('#app'))
app.render(<><header className="preview-header"><b>{english?'UI preview · simulated data':'UI 预览 · 模拟数据'}</b><span>{english?'Requests':'请求次数'} <span id="request-count">0</span></span></header><main><Settings/></main><footer className="preview-composer"><span>{english?'Composer quota preview':'输入框额度预览'}</span><Meter sessionId="preview-session"/><Dock sessionId="preview-session"/></footer></>)
