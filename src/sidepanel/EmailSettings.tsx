import { useEffect, useState } from 'react';
import { EMAIL_CONFIG_KEY, type EmailConfig } from '@/types/email';
export function EmailSettings({notify}:{notify:(message:string)=>void}) {
  const [config,setConfig]=useState<EmailConfig>({host:'',port:465,secure:true,user:'',password:'',from:''});
  const [ready,setReady]=useState(false);
  useEffect(()=>{void chrome.storage.local.get(EMAIL_CONFIG_KEY).then((stored)=>{if(stored[EMAIL_CONFIG_KEY])setConfig(stored[EMAIL_CONFIG_KEY]);setReady(true);}).catch(()=>notify('读取邮箱配置失败'));},[notify]);
  const save=async()=>{try{if(!config.host||!config.user||!config.password||!config.from)throw new Error('请完整填写 SMTP 信息');await chrome.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});await chrome.storage.local.set({[EMAIL_CONFIG_KEY]:config});notify('发送邮箱配置已保存到本机，不随工作流导出');}catch(error){notify((error as Error).message);}};
  return <details><summary>配置发送邮箱（本机 SMTP）</summary>
    <small>邮件通过本机 MCP 服务发送；密码/授权码仅存本机扩展存储（非加密保险库），不写入工作流。必须启用 TLS，请使用邮箱授权码。</small>
    <label>SMTP 服务器<input value={config.host} onChange={e=>setConfig({...config,host:e.target.value})}/></label>
    <label>端口<input type="number" min="1" max="65535" value={config.port} onChange={e=>setConfig({...config,port:Number(e.target.value)})}/></label>
    <label>连接加密<select value={config.secure?'tls':'starttls'} onChange={e=>setConfig({...config,secure:e.target.value==='tls'})}><option value="tls">TLS（通常 465）</option><option value="starttls">STARTTLS（通常 587）</option></select></label>
    <label>登录账号<input value={config.user} onChange={e=>setConfig({...config,user:e.target.value})}/></label>
    <label>密码 / 授权码<input type="password" autoComplete="new-password" value={config.password} onChange={e=>setConfig({...config,password:e.target.value})}/></label>
    <label>发件地址<input type="email" value={config.from} onChange={e=>setConfig({...config,from:e.target.value})}/></label>
    <button disabled={!ready} className="secondary" onClick={()=>void save()}>保存邮箱配置</button>
  </details>;
}
