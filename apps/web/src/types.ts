export type DeploymentStatus =
  | 'pending'
  | 'building'
  | 'deploying'
  | 'running'
  | 'failed'
  | 'stopped'

export interface Deployment {
  id: string
  slug: string
  sourceType: 'git' | 'upload'
  gitUrl: string | null
  uploadPath: string | null
  status: DeploymentStatus
  imageTag: string | null
  containerName: string | null
  routeKind: 'host' | null
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
  eventType: 'log' | 'status'
  phase: string
  stream: 'stdout' | 'stderr' | 'system'
  message: string
  createdAt: string
}
