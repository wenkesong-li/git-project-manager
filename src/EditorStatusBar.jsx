import React,{useEffect,useState} from 'react';
import {copyText} from './CodeSurface';
import {Message} from './ui-kit';
export default function EditorStatusBar(){
  const [status,setStatus]=useState(null),[job,setJob]=useState(null);
  useEffect(()=>{const editor=event=>setStatus(event.detail),run=event=>setJob(event.detail);window.addEventListener('gitpm:editor-status',editor);window.addEventListener('gitpm:run-status',run);return()=>{window.removeEventListener('gitpm:editor-status',editor);window.removeEventListener('gitpm:run-status',run);};},[]);
  const command=action=>window.dispatchEvent(new CustomEvent('gitpm:editor-command',{detail:{action,path:status?.path}}));
  return <div className="ide-statusbar" aria-label="编辑器状态栏"><button disabled={!job} onClick={()=>window.dispatchEvent(new Event('gitpm:toggle-runlog'))}>{{running:'● 运行中',success:'✓ 已完成',failed:'! 运行失败',stopped:'■ 已停止'}[job?.state] || '▷ 运行'}{job?.label?` · ${job.label}`:''}</button><button className="status-file-path" title={status?.path || '尚未打开文件'} disabled={!status} onClick={async()=>{try{await copyText(status.path);Message.success('已复制文件路径');}catch(error){Message.error(error.message);}}}>{status?.path || '选择文件开始编辑'}</button>{status && <><button title="跳转行号" onClick={()=>command('gotoLine')}>{status.line}:{status.column}{status.selected?` · 已选择 ${status.selected}`:''}</button><span>{status.readOnly?'只读':'编辑'}</span><span>UTF-8</span><span>{status.ending}</span><span>{status.indent} 空格</span><span>{status.language}</span></>}</div>;
}
