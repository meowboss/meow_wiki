import { useEffect, useRef, useState } from 'react';
import { Puzzle, ShieldCheck } from 'lucide-react';
import { createSampleHost, type PageSummary } from './host';
import './plugin-lab.css';

type Props = { workspaceId: string | null; pages: readonly PageSummary[]; ready: boolean };

export default function PluginLabView({ workspaceId, pages, ready }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState('正在载入受信示例…');
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!workspaceId || !ready || !container.current) return;
    let active = true;
    setFailed(false);
    setLogs([]);
    setStatus('正在载入受信示例…');
    const timeout = window.setTimeout(() => {
      if (active) {
        setFailed(true);
        setStatus('示例未在预期时间内完成连接，请重试。');
      }
    }, 10000);
    let ports: MessagePort[] = [];
    const log = (text: string) => {
      if (active) setLogs((current) => [...current.slice(-39), text]);
    };
    const host = createSampleHost(() => pagesRef.current, log);
    const closePorts = () => {
      for (const port of ports) {
        port.onmessage = null;
        port.onmessageerror = null;
        port.close();
      }
      ports = [];
    };
    const iframe = document.createElement('iframe');
    iframe.title = '受信插件示例沙箱';
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute(
      'allow',
      "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'",
    );
    const onLoad = () => {
      closePorts();
      if (!active || !iframe.contentWindow || host.exhausted) return;
      const target = iframe.contentWindow;
      const channel = new MessageChannel();
      ports = [channel.port1, channel.port2];
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        if (!active) return;
        window.clearTimeout(timeout);
        setFailed(false);
        const reply = host.handle(event.data);
        if (host.exhausted) {
          closePorts();
          setStatus('消息预算已耗尽；请离开实验室后重新进入。');
          return;
        }
        if (reply) channel.port1.postMessage(reply);
      };
      channel.port1.onmessageerror = () => {
        log('宿主拒绝 · INVALID_MESSAGE · 无法解码消息，通道已关闭。');
        closePorts();
        setStatus('消息解码失败，通道已关闭。');
      };
      channel.port1.start();
      try {
        const nonce = crypto.randomUUID();
        // The sandbox has an opaque origin: '*' is necessary, but the receiver is
        // this exact iframe WindowProxy, never a broadcast or global listener.
        // nonce correlates this connection only; permissions come from the manifest.
        target.postMessage({ type: 'meow.plugin.connect', apiVersion: 1, nonce }, '*', [
          channel.port2,
        ]);
        setStatus('专用通道已建立 · 固定授权 pages.list');
        log('宿主连接 · opaque origin · 仅向指定 iframe 转移 MessagePort。');
      } catch {
        closePorts();
        window.clearTimeout(timeout);
        setFailed(true);
        setStatus('连接失败，请重试；浏览器需支持安全上下文和 MessageChannel。');
        log('宿主拒绝 · CONNECTION_FAILED · 无法建立示例通道。');
      }
    };
    iframe.addEventListener('load', onLoad);
    iframe.src = '/plugin-runtime/sample.html';
    container.current.appendChild(iframe);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      host.dispose();
      closePorts();
      iframe.removeEventListener('load', onLoad);
      iframe.remove();
    };
  }, [workspaceId, ready, attempt]);

  return (
    <section className="plugin-lab" aria-labelledby="plugin-lab-title">
      <header className="plugin-lab-heading">
        <Puzzle size={27} aria-hidden="true" />
        <div>
          <h1 id="plugin-lab-title">插件实验室</h1>
          <p>运行内置受信示例，查看插件与宿主的交互。</p>
        </div>
      </header>
      <div className="plugin-lab-boundary">
        <ShieldCheck size={21} aria-hidden="true" />
        <div>
          <strong>隔离边界与最小权限</strong>
          <p>仅授权 pages.list：读取当前空间最多 50 个页面的 id 和标题，不提供正文或凭据。</p>
          <details>
            <summary>开发边界</summary>
            <p>仅运行应用内置的受信示例，不支持上传、粘贴或执行用户任意代码。</p>
            <p>
              iframe 仅允许脚本，不允许同源、网络、弹窗或访问宿主 DOM。网络限制由示例响应的 CSP
              强制实施。workspace.summary 未授权，未知方法一律拒绝。
            </p>
            <p>
              每条消息最多 8000 字节，每次挂载最多 30 条。nonce
              仅关联握手，不是权限凭据；离开或切换空间会关闭通道并移除 iframe。
            </p>
          </details>
        </div>
      </div>
      {!workspaceId ? (
        <p role="status">请先选择工作空间，再打开受信示例。</p>
      ) : (
        <>
          <p className="plugin-lab-status" role="status">
            {ready ? status : '正在等待当前工作空间数据；尚未创建示例通道。'}
          </p>
          {failed && <p role="alert">{status}</p>}
          <button
            type="button"
            className="secondary-btn"
            onClick={() => setAttempt((value) => value + 1)}
            disabled={!ready}
          >
            重新连接示例
          </button>
          <div className="plugin-lab-frame" ref={container} />
          <section className="plugin-lab-logs" aria-labelledby="plugin-lab-log-title">
            <h2 id="plugin-lab-log-title">宿主决策日志</h2>
            <p>仅展示固定决策与错误码；不记录请求原文、nonce、页面正文或令牌。</p>
            <ol aria-live="polite" aria-relevant="additions">
              {logs.map((entry, index) => (
                <li key={index}>{entry}</li>
              ))}
            </ol>
          </section>
        </>
      )}
    </section>
  );
}
