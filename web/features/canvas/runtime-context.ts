import { createContext, useContext } from 'react';
/** Effective presentation state, not an authorization grant. Suspends media while hidden/editing/loading. */
export const CanvasRuntimeContext = createContext({ active: true });
export function useCanvasActive() {
  return useContext(CanvasRuntimeContext).active;
}
