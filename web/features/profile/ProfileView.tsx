import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type SessionInfo, type UserProfile } from '../../shared/api';
import './profile.css';

type Props = {
  sessionMode: SessionInfo['mode'];
  onUserUpdated: (name: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
};
const message = (error: unknown) => (error instanceof Error ? error.message : '请求失败，请重试。');
const timestamp = (value: string | number) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间格式无效' : date.toLocaleString();
};
function profileResponse(value: unknown): UserProfile {
  if (!value || typeof value !== 'object') throw new Error('个人资料格式无效。');
  const item = value as Record<string, unknown>;
  if (
    !['id', 'name', 'email', 'role'].every((key) => typeof item[key] === 'string') ||
    typeof item.emailVerified !== 'boolean' ||
    !['createdAt', 'updatedAt'].every(
      (key) =>
        typeof item[key] === 'string' ||
        (typeof item[key] === 'number' && Number.isFinite(item[key])),
    )
  )
    throw new Error('个人资料格式无效。');
  return {
    id: item.id as string,
    name: item.name as string,
    email: item.email as string,
    emailVerified: item.emailVerified,
    role: item.role as string,
    createdAt: item.createdAt as string | number,
    updatedAt: item.updatedAt as string | number,
  };
}

export default function ProfileView({
  sessionMode,
  onUserUpdated,
  onDirtyChange,
  onBusyChange,
}: Props) {
  const editable = sessionMode === 'session';
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(editable);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [attempt, setAttempt] = useState(0);
  const callbacks = useRef({ onUserUpdated, onDirtyChange, onBusyChange });
  callbacks.current = { onUserUpdated, onDirtyChange, onBusyChange };
  const lifecycle = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const dirty = !!profile && name !== profile.name;
  const working = loading || saving;
  const trimmedName = name.trim();
  const invalidName = trimmedName.length < 1 || trimmedName.length > 80;

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    if (editable) {
      setLoading(true);
      setError('');
      void api<unknown>('/profile', undefined, 'GET', controller.signal)
        .then(profileResponse)
        .then((next) => {
          if (controller.signal.aborted) return;
          setProfile(next);
          setName(next.name);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(message(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }
    return () => {
      controller.abort();
      callbacks.current.onDirtyChange(false);
      callbacks.current.onBusyChange(false);
    };
  }, [editable, attempt]);
  useEffect(() => {
    callbacks.current.onDirtyChange(dirty);
  }, [dirty]);
  useEffect(() => {
    callbacks.current.onBusyChange(working);
  }, [working]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || !profile || working || lock.current) return;
    setSuccess('');
    if (invalidName) {
      setError('昵称去除首尾空格后须为 1 至 80 个字符。');
      return;
    }
    if (!dirty) return;
    const signal = lifecycle.current?.signal;
    if (!signal || signal.aborted) return;
    lock.current = true;
    setSaving(true);
    callbacks.current.onBusyChange(true);
    setError('');
    try {
      const next = profileResponse(
        await api<unknown>('/profile', { name: trimmedName }, 'PATCH', signal),
      );
      if (signal.aborted) return;
      if (next.id !== profile.id) throw new Error('个人资料账户不一致，请重试。');
      setProfile(next);
      setName(next.name);
      callbacks.current.onDirtyChange(false);
      callbacks.current.onUserUpdated(next.name);
      setSuccess('昵称已保存。');
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      lock.current = false;
      if (!signal.aborted) {
        setSaving(false);
        callbacks.current.onBusyChange(false);
      }
    }
  }

  return (
    <section className="profile-view" aria-labelledby="profile-title" aria-busy={working}>
      <header className="profile-view-heading">
        <h1 id="profile-title">个人设置</h1>
        <p>管理你的平台个人资料。头像根据名字首字符在本地生成。</p>
      </header>
      {!editable ? (
        <p className="profile-view-card" role="status">
          当前为{sessionMode === 'local' ? '本地模式' : 'Token 模式'}，没有可编辑的平台账号。
        </p>
      ) : loading ? (
        <p role="status">正在加载个人资料…</p>
      ) : !profile ? (
        <div className="profile-view-card">
          <p role="alert">{error || '无法加载个人资料。'}</p>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => setAttempt((value) => value + 1)}
          >
            重试加载个人资料
          </button>
        </div>
      ) : (
        <form className="profile-view-card" onSubmit={(event) => void save(event)}>
          <div className="profile-view-summary">
            <span className="profile-view-initial" aria-hidden="true">
              {Array.from(profile.name.trim())[0] || '我'}
            </span>
            <div>
              <h2>{profile.name}</h2>
              <p>平台账号</p>
            </div>
          </div>
          <div className="profile-view-fields">
            <label className="profile-view-field" htmlFor="profile-name">
              昵称
              <input
                id="profile-name"
                aria-label="昵称"
                name="name"
                autoComplete="name"
                required
                minLength={1}
                maxLength={80}
                value={name}
                disabled={working}
                aria-describedby="profile-name-hint"
                aria-invalid={dirty && invalidName ? true : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  callbacks.current.onDirtyChange(event.target.value !== profile.name);
                  setSuccess('');
                }}
              />
              <small id="profile-name-hint">1 至 80 个字符，保存时去除首尾空格。</small>
            </label>
            <label className="profile-view-field" htmlFor="profile-email">
              邮箱
              <input
                id="profile-email"
                aria-label="邮箱"
                type="email"
                readOnly
                value={profile.email}
              />
              <small>{profile.emailVerified ? '邮箱已验证' : '邮箱未验证'}</small>
            </label>
            <label className="profile-view-field" htmlFor="profile-role">
              角色
              <input id="profile-role" readOnly value={profile.role} />
            </label>
            <label className="profile-view-field" htmlFor="profile-id">
              用户 ID
              <input id="profile-id" readOnly value={profile.id} />
            </label>
            <label className="profile-view-field" htmlFor="profile-created-at">
              注册时间
              <input id="profile-created-at" readOnly value={timestamp(profile.createdAt)} />
            </label>
            <label className="profile-view-field" htmlFor="profile-updated-at">
              更新时间
              <input id="profile-updated-at" readOnly value={timestamp(profile.updatedAt)} />
            </label>
          </div>
          {error && (
            <p className="profile-view-error" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="profile-view-success" role="status">
              {success}
            </p>
          )}
          <footer className="profile-view-actions">
            <span>{dirty ? '有未保存的昵称更改' : '个人资料已同步'}</span>
            <button
              type="submit"
              className="primary-btn"
              disabled={working || !dirty || invalidName}
            >
              {saving ? '正在保存昵称…' : '保存昵称'}
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}
