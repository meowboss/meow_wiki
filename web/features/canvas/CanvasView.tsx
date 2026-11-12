import { Component, type ReactNode } from 'react';
import type { CanvasInstance } from './useCanvasComposition';

export class ViewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div role="alert" className="canvas-view-error">
        此组件暂时无法显示。
        <button type="button" onClick={() => this.setState({ failed: false })}>
          重试组件
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function ViewContent({
  instance,
  renderView,
}: {
  instance: CanvasInstance;
  renderView: (instance: CanvasInstance) => ReactNode;
}) {
  return instance.viewId === 'builtin.text' ? (
    <div className="canvas-text">{instance.config.text ?? ''}</div>
  ) : (
    renderView(instance)
  );
}
