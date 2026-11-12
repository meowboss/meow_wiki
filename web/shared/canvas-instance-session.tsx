import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

// Deliberately not a general-purpose component cache: no drafts, tokens, API data,
// DOM/media handles, or persistence. Each surface retains at most 40 × 3 scalars.
export type CanvasInstanceSessionValues = {
  'directory.query': string;
  'pet.paused': boolean;
  'pet.greetings': number;
};
type SessionKey = keyof CanvasInstanceSessionValues;
export const CANVAS_SESSION_MAX_INSTANCES = 40;
export const CANVAS_SESSION_MAX_STRING_LENGTH = 5000;
export const CANVAS_SESSION_MAX_NUMBER = 1_000_000;

function boundedValue<K extends SessionKey>(
  key: K,
  value: unknown,
): CanvasInstanceSessionValues[K] {
  let bounded: string | boolean | number;
  if (key === 'directory.query' && typeof value === 'string') {
    bounded = value.slice(0, CANVAS_SESSION_MAX_STRING_LENGTH);
  } else if (key === 'pet.paused' && typeof value === 'boolean') {
    bounded = value;
  } else if (key === 'pet.greetings' && typeof value === 'number' && Number.isFinite(value)) {
    bounded = Math.min(CANVAS_SESSION_MAX_NUMBER, Math.max(0, Math.floor(value)));
  } else {
    throw new TypeError('Unsupported canvas session key or value');
  }
  return bounded as CanvasInstanceSessionValues[K];
}

export class CanvasInstanceSessionStore {
  private readonly instances = new Map<string, Partial<CanvasInstanceSessionValues>>();

  get size() {
    return this.instances.size;
  }

  getOrInitialize<K extends SessionKey>(
    instanceId: string,
    key: K,
    initial: CanvasInstanceSessionValues[K],
  ): CanvasInstanceSessionValues[K] {
    const fallback = boundedValue(key, initial);
    const existing = this.instances.get(instanceId)?.[key];
    if (existing !== undefined) return existing;
    this.set(instanceId, key, fallback);
    return fallback;
  }

  set<K extends SessionKey>(instanceId: string, key: K, value: CanvasInstanceSessionValues[K]) {
    const bounded = boundedValue(key, value);
    // IDs are bounded too; malformed/unadmitted instances remain local-only.
    if (!instanceId || instanceId.length > 256) return false;
    let entry = this.instances.get(instanceId);
    if (!entry) {
      if (this.instances.size >= CANVAS_SESSION_MAX_INSTANCES) return false;
      entry = {};
      this.instances.set(instanceId, entry);
    }
    entry[key] = bounded;
    return true;
  }

  retain(instanceIds: readonly string[]) {
    const live = new Set(instanceIds);
    for (const id of this.instances.keys()) {
      if (!live.has(id)) this.instances.delete(id);
    }
  }
}

export type CanvasInstanceSessionScope = {
  scope: string;
  store: CanvasInstanceSessionStore;
};
type ScopeIdentity = { ownerId: string; workspaceId: string; surface: string };

// Pure helper also makes reset/isolation semantics testable without a browser.
export function resolveCanvasInstanceSessionScope(
  previous: CanvasInstanceSessionScope | null,
  identity: ScopeIdentity,
): CanvasInstanceSessionScope {
  const scope = JSON.stringify([identity.ownerId, identity.workspaceId, identity.surface]);
  return previous?.scope === scope ? previous : { scope, store: new CanvasInstanceSessionStore() };
}

/** Call once at CanvasSurface level, not in a Frame or tree leaf. */
export function useCanvasInstanceSessionScope(
  identity: ScopeIdentity,
  liveInstanceIds: readonly string[],
): CanvasInstanceSessionScope {
  const current = useRef<CanvasInstanceSessionScope | null>(null);
  current.current = resolveCanvasInstanceSessionScope(current.current, identity);
  const session = current.current;
  // Parent owns deletion. Leaf cleanup must NOT clear state during a cross-parent move.
  useEffect(() => {
    session.store.retain(liveInstanceIds);
  }, [session, liveInstanceIds]);
  return session;
}

type SessionContext = CanvasInstanceSessionScope & { instanceId?: string };
const CanvasInstanceSessionContext = createContext<SessionContext | null>(null);
export const CanvasInstanceSessionScopeProvider = CanvasInstanceSessionContext.Provider;

/** Nested Frame provider only adds an ID; the surface-owned Map survives its remount. */
export function CanvasInstanceSessionProvider({
  instanceId,
  children,
}: {
  instanceId: string;
  children: ReactNode;
}) {
  const session = useContext(CanvasInstanceSessionContext);
  return (
    <CanvasInstanceSessionContext.Provider value={session ? { ...session, instanceId } : null}>
      {children}
    </CanvasInstanceSessionContext.Provider>
  );
}

/** Only the three explicit query/pet keys above are supported. One mounted leaf per ID. */
export function useInstanceSessionState<K extends SessionKey>(
  key: K,
  initial: CanvasInstanceSessionValues[K],
): [CanvasInstanceSessionValues[K], Dispatch<SetStateAction<CanvasInstanceSessionValues[K]>>] {
  const session = useContext(CanvasInstanceSessionContext);
  const [, notifyLocal] = useState(0);
  const local = useRef({
    store: session?.store,
    instanceId: session?.instanceId,
    key,
    value: boundedValue(key, initial),
  });
  if (
    local.current.store !== session?.store ||
    local.current.instanceId !== session?.instanceId ||
    local.current.key !== key
  ) {
    local.current = {
      store: session?.store,
      instanceId: session?.instanceId,
      key,
      value: boundedValue(key, initial),
    };
  }
  const binding = local.current;
  const current = session?.instanceId
    ? session.store.getOrInitialize(session.instanceId, key, binding.value)
    : binding.value;
  const setValue: Dispatch<SetStateAction<CanvasInstanceSessionValues[K]>> = (update) => {
    const previous = session?.instanceId
      ? session.store.getOrInitialize(session.instanceId, key, binding.value)
      : binding.value;
    const value = boundedValue(key, typeof update === 'function' ? update(previous) : update);
    if (session?.instanceId) session.store.set(session.instanceId, key, value);
    binding.value = value;
    // Only this leaf rerenders; there are intentionally no sibling subscriptions.
    notifyLocal((revision) => revision + 1);
  };
  return [current, setValue];
}
