import React, { useEffect, useState } from 'react';
import { get, post } from './api';
import { Modal, Button } from './ui-kit';
import { useAction } from './ui';
import DataTransfer from './DataTransfer';
export default function FirstRunImport({ ctx, onReady }) {
  const [status, setStatus] = useState(null), [busy, run] = useAction();
  useEffect(() => { let active = true; get('/api/configuration/onboarding').then(value => { if (active) { setStatus(value); onReady(!value.required); } }).catch(() => {}); return () => { active = false; }; }, []);
  if (!status?.required) return null;
  function close() { run(async () => { await post('/api/configuration/finish'); setStatus({ required: false }); onReady(true); }); }
  return <Modal visible title="欢迎使用 Git 项目管家" onCancel={close} maskClosable={false} closable={!busy} footer={null} style={{ width: 760 }}><div className="first-run-intro"><span>首次启动</span><h2>把熟悉的工作环境带过来</h2><p>本机以前配置过？导入历史数据即可继续使用，无需重新添加平台和项目。</p></div><DataTransfer ctx={ctx} sources={status.sources} firstRun onImported={() => { setStatus({ required: false }); onReady(true); ctx.navigate(); }} /><div className="first-run-footer"><span className="muted">稍后也可在「设置 → 数据与备份」中导入。</span><Button disabled={busy} onClick={close}>暂不导入，开始使用</Button></div></Modal>;
}
