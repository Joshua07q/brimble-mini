import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import type {
  CreateDeploymentInput,
  Deployment,
  DeploymentLog,
  DeploymentStatus,
  LogEventType,
  LogStream
} from './types'

interface DeploymentRow {
  id: string
  slug: string
  source_type: 'git' | 'upload'
  git_url: string | null
  upload_path: string | null
  status: DeploymentStatus
  image_tag: string | null
  container_name: string | null
  route_kind: 'host' | null
  route_value: string | null
  live_url: string | null
  redeploy_from_id: string | null
  error_text: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  finished_at: string | null
}

interface LogRow {
  id: number
  deployment_id: string
  seq: number
  event_type: LogEventType
  phase: string
  stream: LogStream
  message: string
  created_at: string
}

export interface DeploymentPatch {
  status?: DeploymentStatus
  imageTag?: string | null
  containerName?: string | null
  routeKind?: 'host' | null
  routeValue?: string | null
  liveUrl?: string | null
  errorText?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

const patchColumns: Record<keyof DeploymentPatch, keyof DeploymentRow> = {
  status: 'status',
  imageTag: 'image_tag',
  containerName: 'container_name',
  routeKind: 'route_kind',
  routeValue: 'route_value',
  liveUrl: 'live_url',
  errorText: 'error_text',
  startedAt: 'started_at',
  finishedAt: 'finished_at'
}

function nowIso(): string {
  return new Date().toISOString()
}

function deploymentFromRow(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    slug: row.slug,
    sourceType: row.source_type,
    gitUrl: row.git_url,
    uploadPath: row.upload_path,
    status: row.status,
    imageTag: row.image_tag,
    containerName: row.container_name,
    routeKind: row.route_kind,
    routeValue: row.route_value,
    liveUrl: row.live_url,
    redeployFromId: row.redeploy_from_id,
    errorText: row.error_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  }
}

function logFromRow(row: LogRow): DeploymentLog {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    seq: row.seq,
    eventType: row.event_type,
    phase: row.phase,
    stream: row.stream,
    message: row.message,
    createdAt: row.created_at
  }
}

export class DeploymentStore {
  private readonly db: Database.Database

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    this.db = new Database(databasePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists deployments (
        id text primary key,
        slug text not null unique,
        source_type text not null,
        git_url text,
        upload_path text,
        status text not null,
        image_tag text,
        container_name text,
        route_kind text,
        route_value text,
        live_url text,
        redeploy_from_id text,
        error_text text,
        created_at text not null,
        updated_at text not null,
        started_at text,
        finished_at text
      );

      create table if not exists deployment_logs (
        id integer primary key autoincrement,
        deployment_id text not null,
        seq integer not null,
        event_type text not null,
        phase text not null,
        stream text not null,
        message text not null,
        created_at text not null,
        foreign key (deployment_id) references deployments(id) on delete cascade,
        unique (deployment_id, seq)
      );

      create index if not exists deployment_logs_deployment_seq_idx
        on deployment_logs (deployment_id, seq);
    `)
  }

  createDeployment(input: CreateDeploymentInput): Deployment {
    const createdAt = nowIso()
    this.db
      .prepare(
        `
        insert into deployments (
          id, slug, source_type, git_url, upload_path, status,
          redeploy_from_id, created_at, updated_at
        )
        values (
          @id, @slug, @sourceType, @gitUrl, @uploadPath, 'pending',
          @redeployFromId, @createdAt, @createdAt
        )
      `
      )
      .run({
        id: input.id,
        slug: input.slug,
        sourceType: input.sourceType,
        gitUrl: input.gitUrl ?? null,
        uploadPath: input.uploadPath ?? null,
        redeployFromId: input.redeployFromId ?? null,
        createdAt
      })

    const deployment = this.getDeployment(input.id)
    if (!deployment) throw new Error('failed to load created deployment')
    return deployment
  }

  listDeployments(): Deployment[] {
    const rows = this.db
      .prepare('select * from deployments order by created_at desc')
      .all() as DeploymentRow[]
    return rows.map(deploymentFromRow)
  }

  getDeployment(id: string): Deployment | null {
    const row = this.db.prepare('select * from deployments where id = ?').get(id) as
      | DeploymentRow
      | undefined
    return row ? deploymentFromRow(row) : null
  }

  slugExists(slug: string): boolean {
    const row = this.db.prepare('select 1 from deployments where slug = ?').get(slug)
    return Boolean(row)
  }

  updateDeployment(id: string, patch: DeploymentPatch): Deployment {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as Array<
      [keyof DeploymentPatch, DeploymentPatch[keyof DeploymentPatch]]
    >
    if (entries.length === 0) {
      const existing = this.getDeployment(id)
      if (!existing) throw new Error(`deployment ${id} not found`)
      return existing
    }

    const assignments: string[] = []
    const values: Record<string, unknown> = { id, updatedAt: nowIso() }

    for (const [key, value] of entries) {
      const column = patchColumns[key]
      assignments.push(`${column} = @${key}`)
      values[key] = value
    }

    assignments.push('updated_at = @updatedAt')

    this.db.prepare(`update deployments set ${assignments.join(', ')} where id = @id`).run(values)

    const deployment = this.getDeployment(id)
    if (!deployment) throw new Error(`deployment ${id} not found`)
    return deployment
  }

  appendLog(
    deploymentId: string,
    eventType: LogEventType,
    phase: string,
    stream: LogStream,
    message: string
  ): DeploymentLog {
    const insert = this.db.transaction(() => {
      const row = this.db
        .prepare('select coalesce(max(seq), 0) + 1 as next_seq from deployment_logs where deployment_id = ?')
        .get(deploymentId) as { next_seq: number }
      const createdAt = nowIso()
      const result = this.db
        .prepare(
          `
          insert into deployment_logs (
            deployment_id, seq, event_type, phase, stream, message, created_at
          )
          values (?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(deploymentId, row.next_seq, eventType, phase, stream, message, createdAt)

      return this.db
        .prepare('select * from deployment_logs where id = ?')
        .get(result.lastInsertRowid) as LogRow
    })

    return logFromRow(insert())
  }

  listLogs(deploymentId: string, afterSeq = 0): DeploymentLog[] {
    const rows = this.db
      .prepare(
        `
        select * from deployment_logs
        where deployment_id = ? and seq > ?
        order by seq asc
      `
      )
      .all(deploymentId, afterSeq) as LogRow[]
    return rows.map(logFromRow)
  }

  markInterruptedDeployments(): void {
    const updatedAt = nowIso()
    this.db
      .prepare(
        `
        update deployments
        set status = 'failed',
            error_text = coalesce(error_text, 'API restarted before this deployment finished'),
            updated_at = ?,
            finished_at = coalesce(finished_at, ?)
        where status in ('pending', 'building', 'deploying')
      `
      )
      .run(updatedAt, updatedAt)
  }
}
