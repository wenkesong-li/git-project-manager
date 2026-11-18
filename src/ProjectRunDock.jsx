import React,{useEffect,useRef,useState} from 'react';
import {get,post} from './api';
import {Button,Message} from './ui-kit';
import {useAction,useResource} from './ui';
import {copyText} from './CodeSurface';
export default function ProjectRunDock({id,version,onRefresh,onConfigure}) {
  const resource=useResource(()=>get(`/api/local/${id}/run-configurations`),[id,version]);
  const [job,setJob]=useState(null),[open,setOpen]=useState(false),[busy,run]=useAction();
  const output=useRef(null),follow=useRef(true),last=useRef(null),refresh=useRef(onRefresh);refresh.current=onRefresh;
  useEffect(()=>{let cancelled=false,timer;setJob(null);last.current=null;async function poll(){try{const {job:next}=await get(`/api/local/${id}/run`);if(cancelled)return;setJob(next);if(next?.state==='running' && last.current?.id!==next.id)setOpen(true);if(next && last.current?.id===next.id && last.current.state==='running' && next.state!=='running')refresh.current();last.current=next;timer=setTimeout(poll,next?.state==='running'?500:1500);}catch{if(!cancelled)timer=setTimeout(poll,2500);}}poll();return()=>{cancelled=true;clearTimeout(timer);};},[id]);
  useEffect(()=>{if(follow.current && output.current)output.current.scrollTop=output.current.scrollHeight;},[job?.output,open]);
  async function start(config){await run(async()=>{const result=await post(`/api/local/${id}/run`,config);setJob(result.job);last.current=result.job;follow.current=true;setOpen(true);});}
  const state={running:'运行中',success:'已完成',failed:'失败',stopped:'已停止'},meta=resource.data;
  return <>
    <div className="project-build-toolbar"><span className="muted">{resource.loading?'识别项目中…':resource.error?'识别失败':`${meta?.type} 项目`}</span>
      <Button disabled={busy || job?.state==='running' || !meta?.quickBuild} onClick={()=>start(meta.quickBuild)}>编译</Button>
      <Button disabled={busy || job?.state==='running' || !meta?.quickRun} onClick={()=>start(meta.quickRun)}>▶ 快捷运行</Button>
      <Button disabled={busy} onClick={()=>{resource.reload();onRefresh();}}>刷新项目与目录</Button>
      <Button onClick={onConfigure}>运行配置</Button>
      {!meta?.quickRun && !resource.loading && <span className="muted">{meta?.maven?'配置 Spring Boot / exec 插件后可快捷启动，也可到运行配置选择任务。':'可到运行配置选择脚本或运行文件。'}</span>}
      {job && <Button onClick={()=>setOpen(value=>!value)}>{open?'收起':'显示'}启动日志 · {state[job.state]}</Button>}
    </div>
    {job && open && <section className="project-run-dock" aria-label="底部启动日志"><div className="run-output-heading"><strong>{job.label} · {state[job.state]}{job.exitCode!=null?` · 退出码 ${job.exitCode}`:''}</strong><div className="button-group"><Button size="mini" disabled={job.state!=='running' || busy} onClick={()=>run(()=>post(`/api/local/${id}/run-stop`))}>停止</Button><Button size="mini" onClick={()=>run(async()=>{await copyText(job.output);Message.success('日志已复制');})}>复制日志</Button><Button size="mini" onClick={()=>setOpen(false)}>收起日志</Button></div></div><pre ref={output} aria-label="启动日志输出" onScroll={()=>{const el=output.current;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<40;}}>{job.output || '正在启动…'}</pre></section>}
  </>;
}
