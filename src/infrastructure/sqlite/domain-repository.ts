import type { DatabaseSync } from 'node:sqlite';
import type { Contribution, Domain, DomainRole, Membership } from '../../modules/domains/domain.ts';

/** Owns all Domain SQL, but never owns or closes the injected connection. */
export class DomainRepository {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS domains (
        id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL REFERENCES workspaces(id),
        ownerId TEXT NOT NULL REFERENCES user(id), name TEXT NOT NULL, description TEXT NOT NULL,
        buildProfile TEXT NOT NULL CHECK(buildProfile IN ('general','project','research','product')),
        revision INTEGER NOT NULL CHECK(revision > 0)
      );
      CREATE INDEX IF NOT EXISTS domains_owner ON domains(ownerId);
      CREATE TABLE IF NOT EXISTS domain_members (
        domainId TEXT NOT NULL REFERENCES domains(id), userId TEXT NOT NULL REFERENCES user(id),
        role TEXT NOT NULL CHECK(role IN ('reader','contributor','maintainer')),
        PRIMARY KEY(domainId,userId)
      );
      CREATE INDEX IF NOT EXISTS domain_members_user ON domain_members(userId,domainId);
      CREATE TABLE IF NOT EXISTS domain_contributions (
        id TEXT PRIMARY KEY, domainId TEXT NOT NULL REFERENCES domains(id),
        authorId TEXT NOT NULL REFERENCES user(id), title TEXT NOT NULL,
        content TEXT NOT NULL CHECK(length(content) <= 100000),
        expectedDomainRevision INTEGER NOT NULL CHECK(expectedDomainRevision > 0),
        status TEXT NOT NULL CHECK(status IN ('pending','published','rejected')),
        reviewerId TEXT REFERENCES user(id), reason TEXT
      );
      CREATE INDEX IF NOT EXISTS domain_contributions_domain ON domain_contributions(domainId,status);
    `);
  }

  transaction<T>(operation: () => T): T {
    // A savepoint composes with a caller's existing synchronous transaction.
    this.db.exec('SAVEPOINT domain_operation');
    try {
      const result = operation();
      this.db.exec('RELEASE domain_operation');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK TO domain_operation; RELEASE domain_operation');
      throw error;
    }
  }

  ownsWorkspace(caller: string, id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM workspaces WHERE id=? AND owner=?').get(id, caller);
  }
  userExists(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM user WHERE id=?').get(id);
  }
  ownerCount(caller: string): number {
    return Number(
      this.db.prepare('SELECT count(*) AS n FROM domains WHERE ownerId=?').get(caller)!.n,
    );
  }
  list(caller: string): Domain[] {
    return this.db
      .prepare(
        `SELECT d.* FROM domains d WHERE d.ownerId=? OR EXISTS
      (SELECT 1 FROM domain_members m WHERE m.domainId=d.id AND m.userId=?) ORDER BY d.rowid`,
      )
      .all(caller, caller) as unknown as Domain[];
  }
  get(caller: string, id: string): Domain | undefined {
    return this.db
      .prepare(
        `SELECT d.* FROM domains d WHERE d.id=? AND (d.ownerId=? OR EXISTS
      (SELECT 1 FROM domain_members m WHERE m.domainId=d.id AND m.userId=?))`,
      )
      .get(id, caller, caller) as Domain | undefined;
  }
  role(caller: string, id: string): DomainRole | undefined {
    const row = this.db
      .prepare(
        `SELECT CASE WHEN d.ownerId=? THEN 'owner' ELSE m.role END AS role
      FROM domains d LEFT JOIN domain_members m ON m.domainId=d.id AND m.userId=?
      WHERE d.id=? AND (d.ownerId=? OR m.userId IS NOT NULL)`,
      )
      .get(caller, caller, id, caller);
    return row?.role as DomainRole | undefined;
  }
  insert(domain: Domain) {
    this.db
      .prepare('INSERT INTO domains VALUES(?,?,?,?,?,?,?)')
      .run(
        domain.id,
        domain.workspaceId,
        domain.ownerId,
        domain.name,
        domain.description,
        domain.buildProfile,
        domain.revision,
      );
  }
  update(domain: Domain, expectedRevision: number): boolean {
    return (
      this.db
        .prepare(
          `UPDATE domains SET name=?,description=?,buildProfile=?,revision=?
      WHERE id=? AND revision=?`,
        )
        .run(
          domain.name,
          domain.description,
          domain.buildProfile,
          domain.revision,
          domain.id,
          expectedRevision,
        ).changes === 1
    );
  }
  setMember(id: string, userId: string, role: string) {
    this.db
      .prepare(
        `INSERT INTO domain_members VALUES(?,?,?)
      ON CONFLICT(domainId,userId) DO UPDATE SET role=excluded.role`,
      )
      .run(id, userId, role);
  }
  removeMember(id: string, userId: string) {
    this.db.prepare('DELETE FROM domain_members WHERE domainId=? AND userId=?').run(id, userId);
  }
  members(caller: string, id: string): Membership[] {
    return this.db
      .prepare(
        `SELECT id AS domainId, ownerId AS userId, 'owner' AS role FROM domains
      WHERE id=? AND (ownerId=? OR EXISTS(SELECT 1 FROM domain_members WHERE domainId=? AND userId=? AND role='maintainer'))
      UNION ALL SELECT m.* FROM domain_members m JOIN domains d ON d.id=m.domainId WHERE m.domainId=?
      AND (d.ownerId=? OR EXISTS(SELECT 1 FROM domain_members WHERE domainId=? AND userId=? AND role='maintainer'))`,
      )
      .all(id, caller, id, caller, id, caller, id, caller) as unknown as Membership[];
  }
  userByEmail(email: string) {
    return this.db
      .prepare('SELECT id FROM user WHERE lower(email)=?')
      .get(email.trim().toLowerCase());
  }
  memberProfiles(caller: string, id: string) {
    return this.members(caller, id).map((member) => {
      const user = this.db.prepare('SELECT name,email FROM user WHERE id=?').get(member.userId);
      return {
        ...member,
        name: String(user?.name ?? member.userId),
        email: String(user?.email ?? ''),
      };
    });
  }
  contributionCount(caller: string, id: string): number {
    if (!this.get(caller, id)) return 0;
    return Number(
      this.db.prepare('SELECT count(*) AS n FROM domain_contributions WHERE domainId=?').get(id)!.n,
    );
  }
  insertContribution(c: Contribution) {
    this.db
      .prepare('INSERT INTO domain_contributions VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        c.id,
        c.domainId,
        c.authorId,
        c.title,
        c.content,
        c.expectedDomainRevision,
        c.status,
        c.reviewerId,
        c.reason,
      );
  }
  contributions(caller: string, id: string): Contribution[] {
    return this.db
      .prepare(
        `SELECT c.* FROM domain_contributions c JOIN domains d ON d.id=c.domainId
      LEFT JOIN domain_members m ON m.domainId=d.id AND m.userId=? WHERE d.id=?
      AND (d.ownerId=? OR m.userId IS NOT NULL) AND (d.ownerId=? OR m.role='maintainer'
      OR c.status='published' OR (c.authorId=? AND c.status='pending')) ORDER BY c.rowid`,
      )
      .all(caller, id, caller, caller, caller) as unknown as Contribution[];
  }
  review(c: Contribution): boolean {
    return (
      this.db
        .prepare(
          `UPDATE domain_contributions SET status=?,reviewerId=?,reason=?
      WHERE id=? AND domainId=? AND status='pending'`,
        )
        .run(c.status, c.reviewerId, c.reason, c.id, c.domainId).changes === 1
    );
  }
  search(caller: string, id: string, query: string): Contribution[] {
    return this.db
      .prepare(
        `SELECT c.* FROM domain_contributions c JOIN domains d ON d.id=c.domainId
      WHERE d.id=? AND (d.ownerId=? OR EXISTS(SELECT 1 FROM domain_members m WHERE m.domainId=d.id AND m.userId=?))
      AND c.status='published' AND (instr(lower(c.title),lower(?))>0 OR instr(lower(c.content),lower(?))>0)
      ORDER BY c.rowid LIMIT 20`,
      )
      .all(id, caller, caller, query, query) as unknown as Contribution[];
  }
}
