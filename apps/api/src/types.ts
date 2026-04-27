export type DeploymentStatus =
  | 'pending'
  | 'building'
  | 'deploying'
  | 'running'
  | 'failed'
  | 'stopped'

export type SourceType = 'git' | 'upload'
export type RouteKind = 'host'
export type LogEventType = 'log' | 'status'
export type LogStream = 'stdout' | 'stderr' | 'system'

export interface Deployment {
  id: string
  slug: string
  sourceType: SourceType
  gitUrl: string | null
  uploadPath: string | null
  status: DeploymentStatus
  imageTag: string | null
  containerName: string | null
  routeKind: RouteKind | null
  routeValue: string | null
  liveUrl: string | null
  redeployFromId: string | null
  errorText: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface DeploymentLog {
  id: number
  deploymentId: string
  seq: number
  eventType: LogEventType
  phase: string
  stream: LogStream
  message: string
  createdAt: string
}

export interface CreateDeploymentInput {
  id: string
  slug: string
  sourceType: SourceType
  gitUrl?: string | null
  uploadPath?: string | null
  redeployFromId?: string | null
}
