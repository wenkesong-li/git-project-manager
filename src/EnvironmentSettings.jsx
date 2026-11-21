import React, { useEffect, useState } from 'react';
import { api, get, post } from './api';
import { Button, Input, Message } from './ui-kit';
import SdkFields from './SdkFields';
import { Field, Resource, useAction, useResource } from './ui';
export default function EnvironmentSettings({ id, onDirty, mavenOnly }) {
  const endpoint = id != null ? `/api/local/${id}/environment` : '/api/environment';
  const resource = useResource(() => Promise.all([get(endpoint),get('/api/environment/catalog')]).then(([settings,scan])=>({...settings,...scan})), [id]);
  const [catalog,setCatalog] = useState(null), [roots,setRoots]=useState('');
  const [environment, setEnvironment] = useState({ nodePath: '', javaHome: '', mavenHome: '' }), [detected, setDetected] = useState(null), [busy, run] = useAction();
  useEffect(() => { if (resource.data) { setEnvironment(resource.data.environment); setCatalog(resource.data.catalog); setRoots((resource.data.roots || []).join("\n")); } }, [resource.data]);
  useEffect(()=>{onDirty?.(!!resource.data && JSON.stringify(environment)!==JSON.stringify(resource.data.environment));},[environment,resource.data,onDirty]);
  const update = (field, value) => { setEnvironment(previous => ({ ...previous, [field]: value })); setDetected(null); };
  return <section className="environment-settings"><h3>{id != null ? "项目运行环境" : "全局运行环境"}</h3><p className="muted">自动检测已安装版本；项目可单独选择，留空跟随全局默认。保存后应用到后续任务。</p><Resource resource={resource}>{() => <>
    <SdkFields mavenOnly={mavenOnly} environment={environment} onChange={update} catalog={catalog} project={id != null} effective={resource.data?.effective} />
    {id == null && <Field label="额外搜索目录" hint="每行一个绝对目录，用于自定义 SDK 安装位置"><Input.TextArea aria-label="额外搜索目录" value={roots} onChange={setRoots} rows={3} /></Field>}
    <Button disabled={busy} onClick={() => run(async()=>{const result=await post('/api/environment/scan',id != null?{}:{roots:roots.split(/\r?\n/).map(value=>value.trim()).filter(Boolean)});setCatalog(result.catalog);Message.success('版本列表已更新');})}>{busy?'正在扫描…':'重新扫描版本'}</Button>
    {catalog && <p className="muted">发现 {catalog.jdk.length} 个 JDK · {catalog.maven.length} 个 Maven · {catalog.node.length} 个 Node.js</p>}
    <div className="button-group"><Button disabled={busy} onClick={() => run(async () => { const result = await post('/api/environment/detect', {...catalog?.preferred,...resource.data?.inherited,...Object.fromEntries(Object.entries(environment).filter(([,value])=>value))}); setDetected(result.tools); })}>{busy ? '正在检测…' : '检测环境'}</Button><Button disabled={busy} onClick={() => run(async () => { await api('PUT', endpoint, environment); resource.reload(); Message.success('运行环境已保存'); })}>保存运行环境</Button></div>
    {detected && <div className="environment-results">{Object.entries(detected).map(([key, tool]) => <div key={key}><strong>{key} · {tool.ok ? '可用' : '未就绪'}</strong><pre>{tool.version}</pre></div>)}</div>}
  </>}</Resource></section>;
}
