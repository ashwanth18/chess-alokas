import postgres, { type Sql } from 'postgres';
import type {
  CertificateIssue,
  CertificateIssueStatus,
  CertificateIssueType,
} from '@chess-alokas/shared';

export interface CertificateIssueInput {
  id: string;
  tournamentId: string;
  participantId?: string | null;
  type: CertificateIssueType;
  rank?: number | null;
  categoryId?: string | null;
  recipientEmail?: string | null;
  recipientName: string;
  storagePath: string;
  contentSha256: string;
  byteSize: number;
  status: CertificateIssueStatus;
  serial?: string | null;
  emailedAt?: string | null;
  error?: string | null;
  createdAt: string;
}

function toIso(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

interface IssueRow {
  id: string;
  tournament_id: string;
  participant_id: string | null;
  type: string;
  rank: number | null;
  category_id: string | null;
  recipient_email: string | null;
  recipient_name: string;
  storage_path: string;
  content_sha256: string;
  byte_size: number;
  status: string;
  serial: string | null;
  emailed_at: Date | string | null;
  error: string | null;
  created_at: Date | string;
}

function rowToIssue(row: IssueRow): CertificateIssue {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    participantId: row.participant_id ?? undefined,
    type: row.type as CertificateIssueType,
    rank: row.rank ?? undefined,
    categoryId: row.category_id ?? undefined,
    recipientEmail: row.recipient_email ?? undefined,
    recipientName: row.recipient_name,
    storagePath: row.storage_path,
    contentSha256: row.content_sha256,
    byteSize: row.byte_size,
    status: row.status as CertificateIssueStatus,
    serial: row.serial ?? undefined,
    emailedAt: toIso(row.emailed_at) ?? undefined,
    error: row.error ?? undefined,
    createdAt: toIso(row.created_at)!,
  };
}

export interface CertificateIssueStore {
  createIssue(input: CertificateIssueInput): Promise<CertificateIssue>;
  listIssues(tournamentId: string): Promise<CertificateIssue[]>;
  getIssue(id: string): Promise<CertificateIssue | null>;
  updateIssueStatus(
    id: string,
    patch: {
      status: CertificateIssueStatus;
      emailedAt?: string | null;
      error?: string | null;
    },
  ): Promise<CertificateIssue | null>;
}

export class MemoryCertificateIssueStore implements CertificateIssueStore {
  private issues = new Map<string, CertificateIssue>();

  async createIssue(input: CertificateIssueInput): Promise<CertificateIssue> {
    const issue: CertificateIssue = {
      id: input.id,
      tournamentId: input.tournamentId,
      participantId: input.participantId ?? undefined,
      type: input.type,
      rank: input.rank ?? undefined,
      categoryId: input.categoryId ?? undefined,
      recipientEmail: input.recipientEmail ?? undefined,
      recipientName: input.recipientName,
      storagePath: input.storagePath,
      contentSha256: input.contentSha256,
      byteSize: input.byteSize,
      status: input.status,
      serial: input.serial ?? undefined,
      emailedAt: input.emailedAt ?? undefined,
      error: input.error ?? undefined,
      createdAt: input.createdAt,
    };
    this.issues.set(issue.id, issue);
    return issue;
  }

  async listIssues(tournamentId: string): Promise<CertificateIssue[]> {
    return [...this.issues.values()]
      .filter((i) => i.tournamentId === tournamentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getIssue(id: string): Promise<CertificateIssue | null> {
    return this.issues.get(id) ?? null;
  }

  async updateIssueStatus(
    id: string,
    patch: {
      status: CertificateIssueStatus;
      emailedAt?: string | null;
      error?: string | null;
    },
  ): Promise<CertificateIssue | null> {
    const existing = this.issues.get(id);
    if (!existing) return null;
    const next: CertificateIssue = {
      ...existing,
      status: patch.status,
      emailedAt: patch.emailedAt === undefined ? existing.emailedAt : (patch.emailedAt ?? undefined),
      error: patch.error === undefined ? existing.error : (patch.error ?? undefined),
    };
    this.issues.set(id, next);
    return next;
  }
}

export class PostgresCertificateIssueStore implements CertificateIssueStore {
  constructor(private readonly sql: Sql) {}

  async createIssue(input: CertificateIssueInput): Promise<CertificateIssue> {
    const rows = await this.sql<IssueRow[]>`
      INSERT INTO certificate_issues
        (id, tournament_id, participant_id, type, rank, category_id, recipient_email, recipient_name,
         storage_path, content_sha256, byte_size, status, serial, emailed_at, error, created_at)
      VALUES
        (${input.id}, ${input.tournamentId}, ${input.participantId ?? null}, ${input.type},
         ${input.rank ?? null}, ${input.categoryId ?? null}, ${input.recipientEmail ?? null},
         ${input.recipientName}, ${input.storagePath}, ${input.contentSha256}, ${input.byteSize},
         ${input.status}, ${input.serial ?? null}, ${input.emailedAt ?? null}, ${input.error ?? null}, ${input.createdAt})
      RETURNING *
    `;
    return rowToIssue(rows[0]!);
  }

  async listIssues(tournamentId: string): Promise<CertificateIssue[]> {
    const rows = await this.sql<IssueRow[]>`
      SELECT * FROM certificate_issues
      WHERE tournament_id = ${tournamentId}
      ORDER BY created_at DESC
    `;
    return rows.map(rowToIssue);
  }

  async getIssue(id: string): Promise<CertificateIssue | null> {
    const rows = await this.sql<IssueRow[]>`SELECT * FROM certificate_issues WHERE id = ${id}`;
    const row = rows[0];
    return row ? rowToIssue(row) : null;
  }

  async updateIssueStatus(
    id: string,
    patch: {
      status: CertificateIssueStatus;
      emailedAt?: string | null;
      error?: string | null;
    },
  ): Promise<CertificateIssue | null> {
    const rows = await this.sql<IssueRow[]>`
      UPDATE certificate_issues SET
        status = ${patch.status},
        emailed_at = COALESCE(${patch.emailedAt ?? null}, emailed_at),
        error = ${patch.error ?? null}
      WHERE id = ${id}
      RETURNING *
    `;
    const row = rows[0];
    return row ? rowToIssue(row) : null;
  }
}

export function createCertificateIssueStore(): CertificateIssueStore {
  const dbUrl = process.env['DATABASE_URL'];
  if (dbUrl) {
    return new PostgresCertificateIssueStore(postgres(dbUrl, { max: 5, prepare: false }));
  }
  return new MemoryCertificateIssueStore();
}
