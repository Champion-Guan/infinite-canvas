import { Button, Input } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { ModelChannel } from '@/stores/use-config-store';
import { flushSQLiteStorage, retrySQLiteStorage } from '../本机存储/上游浏览器存储桥';
import { isChannelBinding, isProtectedCredential, isSealedCredential } from './页面凭据引用.mjs';
import { readCredentialPreview } from './密钥脱敏.mjs';
import { createChannelSaveFlow, patchChannelDraft, saveChannelBinding } from './渠道编辑流程.mjs';
import type { ChannelBindingHost } from '../生成网关/渠道绑定客户端';

export function ChannelCredentialInput({ value, onChange, disabled }: { value: string; onChange(value: string): void; disabled?: boolean }) {
  const protectedValue = isProtectedCredential(value);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState({ binding: '', text: '', failed: false });
  useEffect(() => {
    let current = true;
    if (!isChannelBinding(value)) return;
    setEditing(false);
    const host = (window as unknown as { __guanGenerationHost?: ChannelBindingHost }).__guanGenerationHost;
    void readCredentialPreview(host, value).then(text => {
      if (current) setPreview({ binding: value, text, failed: false });
    }, () => {
      if (current) setPreview({ binding: value, text: '', failed: true });
    });
    return () => { current = false; };
  }, [value]);
  const savedDisplay = protectedValue && !editing;
  const masked = preview.binding === value ? preview.text : '';
  return <div className="flex items-center gap-2">
    {savedDisplay ? <Input aria-label="已保存的 API Key（脱敏）" readOnly disabled={disabled} value={masked} autoComplete="off"
      onFocus={event => event.target.select()} onCopy={event => { if (masked) { event.preventDefault(); event.clipboardData.setData('text/plain', masked); } }}
      placeholder={isSealedCredential(value) ? '旧凭据已保留，请重新输入当前渠道密钥' : preview.binding === value && preview.failed ? '已保存，暂时无法读取核对信息' : '正在读取密钥核对信息…'} />
      : <Input.Password aria-label="输入新的 API Key" autoFocus={editing} autoComplete="new-password" disabled={disabled} value={protectedValue ? '' : value} onChange={event => onChange(event.target.value)} placeholder="输入完整 API Key" />}
    {protectedValue ? <Button aria-label={editing ? '取消替换 API Key' : '替换 API Key'} disabled={disabled} onClick={event => { event.preventDefault(); setEditing(!editing); }}>{editing ? '取消替换' : '替换'}</Button> : null}
    {protectedValue ? <Button aria-label="清除 API Key" disabled={disabled} onClick={event => { event.preventDefault(); onChange(''); }}>清除</Button> : null}
  </div>;
}

export function useChannelCredentialEditor({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave(channel: ModelChannel): void; onClose(): void }) {
  const [draft, setDraft] = useState<ModelChannel | null>(channel);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const current = useRef({ open, channel, id: channel?.id, onSave, onClose });
  current.current = { open, channel, id: channel?.id, onSave, onClose };
  const flow = useRef<ReturnType<typeof createChannelSaveFlow> | null>(null);
  if (!flow.current) flow.current = createChannelSaveFlow({
    bind(value: ModelChannel) {
      const host = (window as unknown as { __guanGenerationHost?: ChannelBindingHost }).__guanGenerationHost;
      if (!host) throw new Error('本机渠道服务尚未连接，请重新打开工作台。');
      return saveChannelBinding(host, value);
    },
    commit(value: ModelChannel) { current.current.onSave(value); },
    flush: flushSQLiteStorage,
    retry: retrySQLiteStorage,
  });
  useEffect(() => {
    flow.current!.invalidate();
    if (open && current.current.channel) setDraft(current.current.channel);
    setMessage('');
    return () => { flow.current!.invalidate(); };
  }, [open, channel?.id]);
  const patch = (value: Partial<ModelChannel>) => {
    if (saving || pending) return;
    const next = patchChannelDraft(draft, value);
    if (draft && isProtectedCredential(draft.apiKey) && next?.apiKey === '' && !Object.hasOwn(value, 'apiKey')) setMessage('渠道地址或协议已改变，请重新输入密钥；原配置仍保留，取消即可返回。');
    setDraft(next);
  };
  const close = () => {
    if (flow.current!.getStatus().pending) { setMessage('这次保存尚未确认，请先重试原保存。'); return; }
    flow.current!.invalidate();
    current.current.onClose();
  };
  const save = async (value: ModelChannel) => {
    if (saving) return;
    setSaving(true); setMessage('');
    const id = channel?.id;
    try {
      const saved = await flow.current!.save(value, () => current.current.open && current.current.id === id);
      if (saved) { setDraft(saved); current.current.onClose(); }
    } catch (error) {
      setMessage(flow.current!.getStatus().pending ? '保存尚未确认，编辑已保留。请点击保存重试原操作，不要刷新。' : error instanceof Error ? error.message : '渠道保存未确认，请重试。');
    } finally { setPending(flow.current!.getStatus().pending); setSaving(false); }
  };
  return { draft, patch, saving, pending, message, save, close, locked: saving || pending };
}
