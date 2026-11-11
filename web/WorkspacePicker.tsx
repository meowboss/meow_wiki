import { useState, type FormEvent } from 'react';
import { Check, ChevronDown, LoaderCircle, Plus, Settings2, X } from 'lucide-react';
import { api, type Workspace } from './api';

type Props = { workspace: Workspace | null; workspaces: Workspace[]; guard: () => boolean; onChange: (workspace: Workspace) => void; disabled: boolean; onBusyChange: (busy: boolean) => void };
export default function WorkspacePicker({ workspace, workspaces, guard, onChange, disabled, onBusyChange }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<'create' | 'settings' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function form(mode: 'create' | 'settings') { setEditing(mode); setError(''); setName(mode === 'settings' ? workspace?.name || '' : ''); setDescription(mode === 'settings' ? workspace?.description || '' : ''); }
  async function save(e: FormEvent) {
    e.preventDefault(); if (busy || disabled || !name.trim()) return;
    if (editing === 'create' && !guard()) return;
    setBusy(true); onBusyChange(true); setError('');
    try {
      const fields = { name: name.trim(), description: description.trim() };
      if (editing === 'settings' && workspace) {
        await api(`/workspaces/${encodeURIComponent(workspace.id)}`, fields, 'PATCH');
        onChange({ id: workspace.id, ...fields });
      } else {
        const created = await api<{ id: string }>('/workspaces', fields);
        if (!created.id) throw new Error('创建接口未返回工作空间 ID。');
        onChange({ id: created.id, ...fields });
      }
      setEditing(null); setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : '保存工作空间失败，请重试。'); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <div className="workspace-picker"><button className="workspace-switch" aria-expanded={open} aria-label="选择或管理工作空间" disabled={disabled || busy} onClick={() => setOpen(v => !v)}><span className="workspace-avatar">{workspace?.name.slice(0, 1) || '+'}</span><div><strong>{workspace?.name || '创建工作空间'}</strong><small>切换与管理空间</small></div><ChevronDown size={16}/></button>{open && <div className="workspace-menu"><div className="workspace-menu-heading">我的工作空间<button className="icon-btn" aria-label="关闭空间列表" onClick={() => setOpen(false)}><X size={14}/></button></div>{workspaces.map(w => <button className="workspace-option" key={w.id} disabled={disabled || busy} onClick={() => { if (w.id === workspace?.id) { setOpen(false); return; } if (guard()) { onChange(w); setOpen(false); } }}><span><strong>{w.name}</strong><small>{w.description || '暂无说明'}</small></span>{w.id === workspace?.id && <Check size={16}/>}</button>)}{!workspaces.length && <p className="form-hint">还没有工作空间，创建一个开始吧。</p>}<button className="workspace-option" disabled={disabled || busy} onClick={() => form('create')}><Plus size={16}/>创建工作空间</button>{workspace && <button className="workspace-option" disabled={disabled || busy} onClick={() => form('settings')}><Settings2 size={16}/>名称与说明设置</button>}</div>}{editing && <div className="modal-backdrop"><section className="dialog workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title"><div className="dialog-heading"><span className="dialog-icon"><Settings2 size={22}/></span><button className="icon-btn" aria-label="关闭工作空间设置" disabled={busy} onClick={() => setEditing(null)}><X size={20}/></button></div><h2 id="workspace-dialog-title">{editing === 'create' ? '新的空间，新的可能' : '工作空间设置'}</h2><p className="dialog-description">用名称与说明，让知识各得其所。</p><form onSubmit={e => void save(e)}><label className="field">工作空间名称<input autoFocus required maxLength={100} value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="例如：我的知识花园"/></label><label className="field">空间说明<textarea rows={3} maxLength={1000} value={description} disabled={busy} onChange={e => setDescription(e.target.value)} placeholder="这里收藏哪些想法？"/></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={() => setEditing(null)}>取消</button><button className="primary-btn" disabled={busy || disabled || !name.trim()}>{busy && <LoaderCircle className="spin" size={16}/>} {busy ? '正在保存…' : editing === 'create' ? '创建并打开' : '保存设置'}</button></div></form></section></div>}</div>;
}
