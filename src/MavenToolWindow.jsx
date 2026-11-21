import React, { useState } from 'react';
import { ChevronRight, Package, Play, RefreshCw, Settings2 } from 'lucide-react';
import EnvironmentSettings from './EnvironmentSettings';

export default function MavenToolWindow({ id, goals, busy, onRun, onRefresh }) {
  const [open, setOpen] = useState(true);
  const [configuring, setConfiguring] = useState(null);
  const [dirty, setDirty] = useState(false);

  function task(goal) {
    return (
      <button key={goal} type="button" className="maven-goal" disabled={busy || dirty}
        onClick={() => onRun(goal)} aria-label={`执行 Maven ${goal}`}>
        <Play size={12} /> <code>{goal}</code>
      </button>
    );
  }

  return (
    <div className="maven-tool-window">
      <aside id="maven-tool-panel" aria-label="Maven 工具窗口" hidden={!open}>
        <header>
          <strong>Maven</strong>
          <button className="icon-button" title="刷新 Maven 项目" aria-label="刷新 Maven 项目" onClick={onRefresh}><RefreshCw size={14} /></button>
          <button className="icon-button" title="JDK 与 Maven 配置" aria-label="JDK 与 Maven 配置"
            aria-expanded={!!configuring} onClick={() => setConfiguring(value => !value)}><Settings2 size={14} /></button>
          <button className="icon-button" title="收起 Maven" aria-label="收起 Maven" onClick={() => setOpen(false)}><ChevronRight size={14} /></button>
        </header>
        <div className="maven-tool-body">
          {configuring !== null && <div hidden={!configuring}><EnvironmentSettings id={id} mavenOnly onDirty={setDirty} /></div>}
          {!configuring && dirty && <button type="button" onClick={() => setConfiguring(true)}>查看未保存的运行环境</button>}
          <details open>
            <summary>生命周期</summary>
            {goals.filter(goal => !goal.includes(':')).map(task)}
          </details>
          {goals.some(goal => goal.includes(':')) && <details open>
            <summary>启动任务</summary>
            {goals.filter(goal => goal.includes(':')).map(task)}
          </details>}
        </div>
      </aside>
      <button type="button" className="maven-tool-toggle" aria-controls="maven-tool-panel"
        aria-expanded={open} onClick={() => setOpen(value => !value)}><Package size={15} /> Maven</button>
    </div>
  );
}
