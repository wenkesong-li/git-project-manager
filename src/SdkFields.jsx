import React from 'react';
import { Input } from './ui-kit';
import { Field } from './ui';
const definitions=[['javaHome','JDK','jdk'],['mavenHome','Maven','maven'],['nodePath','Node.js','node']];
export default function SdkFields({environment,onChange,catalog,project=false,effective={}}) {
  return definitions.map(([field,label,kind])=><Field key={field} label={label} hint={project && !environment[field] ? `当前：${effective[field] || '系统 PATH'}` : '选择已检测版本，或填写绝对路径'}>
    <select aria-label={`${label} 版本`} value={environment[field] || ''} onChange={event=>onChange(field,event.target.value)}>
      <option value="">{project?'跟随全局默认':'自动检测 / 系统默认'}</option>
      {(catalog?.[kind] || []).map(item=><option key={item.path} value={item.path}>{label} {item.version} · {item.path}</option>)}
      {environment[field] && !(catalog?.[kind] || []).some(item=>item.path===environment[field]) && <option value={environment[field]}>自定义 · {environment[field]}</option>}
    </select>
    <Input aria-label={`${label} 自定义路径`} value={environment[field] || ''} onChange={value=>onChange(field,value)} placeholder={field==='nodePath'?'node / node.exe 文件路径':'安装目录（包含 bin）'} />
  </Field>);
}
