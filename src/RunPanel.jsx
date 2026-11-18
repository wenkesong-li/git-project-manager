import React, { useEffect, useRef, useState } from 'react';
import { get, post } from './api';
import { Button, Input, Message } from './ui-kit';
import { Resource, useAction, useResource } from './ui';
import EnvironmentSettings from './EnvironmentSettings';
import { copyText } from './CodeSurface';
export default function RunPanel({ id }) {
  const resource = useResource(() => get(`/api/local/${id}/run-configurations`), [id]);
  const [action, setAction] = useState('npm'), [script, setScript] = useState(''), [path, setPath] = useState(''), [goal, setGoal] = useState('compile'), [job, setJob] = useState(null), [busy, run] = useAction();
  const [environmentDirty,setEnvironmentDirty]=useState(false);
  const output = useRef(null), follow = useRef(true);
  useEffect(() => { if (resource.data?.scripts.length && !script) setScript(resource.data.scripts[0]); if(resource.data?.maven) setAction('maven'); }, [resource.data]);
  useEffect(() => {
    let cancelled = false, timer;
    async function poll() { try { const data = await get(`/api/local/${id}/run`); if (!cancelled) { setJob(data.job); timer = setTimeout(poll, data.job?.state === 'running' ? 500 : 2500); } } catch { if (!cancelled) timer = setTimeout(poll, 2500); } }
    poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [id]);
  useEffect(() => { if (follow.current && output.current) output.current.scrollTop = output.current.scrollHeight; }, [job?.output]);
  const state = { running: '运行中', success: '已完成', failed: '执行失败', stopped: '已停止' };
  return <section className="run-panel"><div className="section-toolbar"><div><h3>编译与运行</h3><p className="muted">使用已保存的磁盘文件；展开下方设置可为当前项目选择 SDK；修改后请先保存。</p></div><Button size="small" onClick={() => resource.reload()}>刷新运行配置</Button></div><details className="project-environment"><summary>项目 SDK 与版本设置</summary><EnvironmentSettings id={id} onDirty={setEnvironmentDirty} /></details><Resource resource={resource}>{data => <div className="run-configuration">
    <label>运行方式<select aria-label="运行方式" value={action} onChange={event => setAction(event.target.value)}><option value="npm">npm 脚本</option><option value="node">Node 文件</option><option value="java-compile">编译 Java 文件</option><option value="java-run">编译并运行 Java</option><option value="maven">Maven</option></select></label>
    {action === 'npm' ? <label>脚本<select aria-label="npm 脚本" value={script} onChange={event => setScript(event.target.value)}>{!data.scripts.length && <option value="">未找到 package.json 脚本</option>}{data.scripts.map(value => <option key={value}>{value}</option>)}</select></label> : action === 'maven' ? <label>目标<select aria-label="Maven 目标" value={goal} onChange={event => setGoal(event.target.value)}>{['compile', 'test', 'package', 'clean',...(data.quickRun?.action==='maven'?[data.quickRun.goal]:[])].map(value => <option key={value}>{value}</option>)}</select></label> : <label>文件路径<Input aria-label="运行文件路径" value={path} onChange={setPath} placeholder={action === 'node' ? '相对路径，例如 src/main.js' : '相对路径，例如 src/Main.java'} /></label>}
    <Button type="primary" disabled={environmentDirty || busy || job?.state === 'running' || (action === 'npm' && !script) || (!['npm', 'maven'].includes(action) && !path.trim()) || (action === 'maven' && !data.maven)} onClick={() => run(async () => { const result = await post(`/api/local/${id}/run`, { action, script, path: path.trim(), goal }); setJob(result.job); follow.current = true; })}>▶ {action === 'java-compile' || action === 'maven' ? '执行' : '运行'}</Button>
    <Button status="danger" disabled={busy || job?.state !== 'running'} onClick={() => run(async () => { await post(`/api/local/${id}/run-stop`); Message.success('已发送停止请求'); })}>■ 停止</Button>
  </div>}</Resource><div className="run-output-heading"><span>{job ? `${job.label} · ${state[job.state]}${job.exitCode !== null ? ` · 退出码 ${job.exitCode}` : ''}` : '尚未运行'}</span><Button size="mini" disabled={!job?.output} onClick={() => run(async () => { await copyText(job.output); Message.success('已复制运行日志'); })}>复制日志</Button></div><pre ref={output} className="run-output" aria-label="编译运行日志" onScroll={() => { const element = output.current; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40; }}>{job?.output || '编译和运行的输出将在这里显示。'}</pre></section>;
}
