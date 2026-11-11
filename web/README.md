# Web module boundaries

- `main.tsx` remains the HTML entry point and loads the global `styles.css`.
- `app/` owns account/session startup, workspace activation, application layout and feature composition. `App` deliberately retains its editor orchestration and existing navigation/unsaved-change guards in this structural refactor.
- `features/` owns each screen or capability. A feature may import its own files and `shared/`, but must not import `app/` or another feature.
- `shared/api.ts` owns the browser API client, session/workspace request state and common transport types. It has no screen dependencies.
- `shared/components/ComponentRenderer.tsx` is the shared declarative component renderer, consumed by the extension catalog, home and reviews. It belongs below those features rather than creating cross-feature imports.
- `shared/ui/Modal.tsx` shares only the existing backdrop/dialog DOM shell. Search and question dialogs use it; their existing focus management, keyboard handlers and close/busy rules remain with their callers. It intentionally does not add portals, listeners or new dismissal behavior.
- Knowledge-specific CSS stays beside `features/knowledge/KnowledgeView.tsx`; global styles remain at the entry point.

There are no compatibility re-exports at the former flat module paths. Import the owning module directly.
