import { z } from 'zod';

export const pluginManifest = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  description: z.string(),
  version: z.string(),
  apiVersion: z.literal(1),
  kind: z.enum(['renderer', 'search', 'assistant']),
  requires: z.array(z.string()).default([]),
});
export type Manifest = z.infer<typeof pluginManifest>;
export type Services = {
  render: (markdown: string) => Promise<string>;
  search: (query: string, pages: SearchPage[]) => SearchResult[];
  ask: (
    question: string,
    pages: SearchPage[],
  ) => { mode: string; answer: string; sources: SearchResult[] };
};
export type SearchPage = { id: string; title: string; markdown: string };
export type SearchResult = { id: string; title: string; excerpt: string };
export interface Plugin {
  manifest: Manifest;
  setup: (
    register: <K extends keyof Services>(key: K, service: Services[K]) => void,
    effect: (dispose: () => void) => void,
  ) => void;
}
export class PluginError extends Error {
  statusCode = 409;
}

/** Trusted bundled plugins only. This registry is deliberately NOT a JS sandbox. */
export class Kernel {
  private plugins = new Map<string, Plugin>();
  private services = new Map<keyof Services, { owner: string; value: Services[keyof Services] }>();
  private cleanup = new Map<string, (() => void)[]>();
  register(plugin: Plugin) {
    const manifest = pluginManifest.parse(plugin.manifest);
    if (this.plugins.has(manifest.id)) throw new PluginError('插件 ID 重复');
    for (const dependency of manifest.requires) {
      if (!this.plugins.has(dependency)) throw new PluginError(`缺少插件依赖：${dependency}`);
    }
    const pending = new Map<keyof Services, Services[keyof Services]>();
    const disposers: (() => void)[] = [];
    try {
      plugin.setup(
        (key, service) => {
          if (this.services.has(key) || pending.has(key)) throw new PluginError(`能力重复：${key}`);
          pending.set(key, service);
        },
        (dispose) => disposers.push(dispose),
      );
    } catch (error) {
      const failures: unknown[] = [];
      for (const dispose of disposers.reverse()) {
        try {
          dispose();
        } catch (failure) {
          failures.push(failure);
        }
      }
      if (failures.length) throw new AggregateError([error, ...failures], '插件初始化与清理失败');
      throw error;
    }
    this.cleanup.set(manifest.id, disposers);
    this.plugins.set(manifest.id, { ...plugin, manifest });
    for (const [key, value] of pending) this.services.set(key, { owner: manifest.id, value });
  }
  unregister(id: string) {
    if (!this.plugins.has(id)) return;
    if ([...this.plugins.values()].some((p) => p.manifest.requires.includes(id)))
      throw new PluginError('请先卸载依赖此插件的能力');
    const disposers = this.cleanup.get(id) ?? [];
    this.plugins.delete(id);
    this.cleanup.delete(id);
    for (const [key, service] of this.services) if (service.owner === id) this.services.delete(key);
    const failures: unknown[] = [];
    for (const dispose of [...disposers].reverse()) {
      try {
        dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, '插件清理失败');
  }
  dispose() {
    const failures: unknown[] = [];
    for (const id of [...this.plugins.keys()].reverse()) {
      try {
        this.unregister(id);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, '插件宿主清理失败');
  }
  list() {
    return [...this.plugins.values()].map((p) => structuredClone(p.manifest));
  }
  validateEnabled(enabled: Set<string>) {
    for (const id of enabled) {
      const plugin = this.plugins.get(id);
      if (!plugin) throw new PluginError(`未知插件：${id}`);
      for (const dependency of plugin.manifest.requires) {
        if (!enabled.has(dependency))
          throw new PluginError(`请先启用依赖 ${dependency}，或禁用依赖它的插件`);
      }
    }
  }
  service<K extends keyof Services>(key: K, enabled: Set<string>): Services[K] {
    this.validateEnabled(enabled);
    const service = this.services.get(key);
    if (!service || !enabled.has(service.owner)) throw new PluginError('此能力对应的插件尚未启用');
    return service.value as Services[K];
  }
}
