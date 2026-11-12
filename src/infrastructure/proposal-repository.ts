import type { DatabaseSync } from 'node:sqlite';

/** Persistence only: no page mutation, model call or HTTP authorization policy. */
export class ProposalRepository {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS mw_proposals(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,owner TEXT NOT NULL,data TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')));
      CREATE INDEX IF NOT EXISTS mw_proposals_scope ON mw_proposals(owner,workspace_id);`);
  }
  insert(owner: string, workspaceId: string, id: string, data: unknown) {
    this.db
      .prepare('INSERT INTO mw_proposals VALUES(?,?,?,?,?)')
      .run(id, workspaceId, owner, JSON.stringify(data), 'pending');
  }
  get(owner: string, workspaceId: string, id: string) {
    return this.db
      .prepare('SELECT data,status FROM mw_proposals WHERE id=? AND owner=? AND workspace_id=?')
      .get(id, owner, workspaceId);
  }
  list(owner: string, workspaceId: string) {
    return this.db
      .prepare(
        "SELECT data,status FROM mw_proposals WHERE owner=? AND workspace_id=? ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, rowid DESC LIMIT 200",
      )
      .all(owner, workspaceId);
  }
  count(owner: string) {
    return Number(
      this.db.prepare('SELECT count(*) AS n FROM mw_proposals WHERE owner=?').get(owner)!.n,
    );
  }
  transition(owner: string, workspaceId: string, id: string, status: 'accepted' | 'rejected') {
    return this.db
      .prepare(
        "UPDATE mw_proposals SET status=? WHERE id=? AND owner=? AND workspace_id=? AND status='pending'",
      )
      .run(status, id, owner, workspaceId).changes;
  }
  evidenceExists(workspaceId: string, sourceId: string, revision: number, chunkId: string) {
    return !!this.db
      .prepare(
        'SELECT 1 FROM knowledge_chunks WHERE id=? AND workspace_id=? AND source_id=? AND revision=?',
      )
      .get(chunkId, workspaceId, sourceId, revision);
  }
}
