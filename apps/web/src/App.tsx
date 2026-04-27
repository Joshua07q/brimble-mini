import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  createGitDeployment,
  createUploadDeployment,
  getDeployment,
  listDeployments,
  redeployDeployment,
  stopDeployment
} from './lib/api'
import type { Deployment, DeploymentLog, DeploymentStatus } from './types'

type CreateMode = 'git' | 'upload'

export function App() {
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/' })
  const search = useSearch({ strict: false }) as { deploymentId?: string }
  const selectedId = search.deploymentId

  const deploymentsQuery = useQuery({
    queryKey: ['deployments'],
    queryFn: listDeployments,
    refetchInterval: 5000
  })

  const deployments = deploymentsQuery.data ?? []
  const activeId = selectedId ?? deployments[0]?.id

  useEffect(() => {
    if (!selectedId && deployments[0]?.id) {
      void navigate({
        to: '/',
        search: { deploymentId: deployments[0].id },
        replace: true
      })
    }
  }, [deployments, navigate, selectedId])

  const detailQuery = useQuery({
    queryKey: ['deployment', activeId],
    queryFn: () => getDeployment(activeId as string),
    enabled: Boolean(activeId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'pending' || status === 'building' || status === 'deploying' ? 3000 : false
    }
  })

  const selectedDeployment =
    detailQuery.data ?? deployments.find((deployment) => deployment.id === activeId) ?? null

  const [logs, setLogs] = useState<DeploymentLog[]>([])
  const [streamState, setStreamState] = useState<'idle' | 'connected' | 'disconnected'>('idle')

  useEffect(() => {
    if (!activeId) {
      setLogs([])
      setStreamState('idle')
      return
    }

    setLogs([])
    setStreamState('connected')
    const source = new EventSource(`/api/deployments/${activeId}/events`)

    const onEvent = (event: Event) => {
      const payload = JSON.parse((event as MessageEvent).data) as DeploymentLog
      setLogs((previous) => upsertLog(previous, payload))

      if (payload.eventType === 'status') {
        void queryClient.invalidateQueries({ queryKey: ['deployments'] })
        void queryClient.invalidateQueries({ queryKey: ['deployment', activeId] })
      }
    }

    source.addEventListener('log', onEvent)
    source.addEventListener('status', onEvent)
    source.onerror = () => {
      setStreamState('disconnected')
    }
    source.onopen = () => {
      setStreamState('connected')
    }

    return () => {
      source.close()
    }
  }, [activeId, queryClient])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Brimble Mini</h1>
          <p>Deployments</p>
        </div>
        <div className="topbar-meta">
          <span>{deployments.length} total</span>
          <span className={`stream-dot ${streamState}`}>{streamState}</span>
        </div>
      </header>

      <section className="layout">
        <CreateDeploymentPanel
          onCreated={(deployment) => {
            void queryClient.invalidateQueries({ queryKey: ['deployments'] })
            void navigate({ to: '/', search: { deploymentId: deployment.id } })
          }}
        />

        <DeploymentList
          deployments={deployments}
          selectedId={activeId}
          loading={deploymentsQuery.isLoading}
          onSelect={(id) => {
            void navigate({ to: '/', search: { deploymentId: id } })
          }}
        />

        <DeploymentDetail
          deployment={selectedDeployment}
          logs={logs}
          loading={detailQuery.isLoading}
          onRedeploy={(id) =>
            redeployDeployment(id).then((deployment) => {
              void queryClient.invalidateQueries({ queryKey: ['deployments'] })
              void navigate({ to: '/', search: { deploymentId: deployment.id } })
            })
          }
          onStop={(id) =>
            stopDeployment(id).then(() => {
              void queryClient.invalidateQueries({ queryKey: ['deployments'] })
              void queryClient.invalidateQueries({ queryKey: ['deployment', id] })
            })
          }
        />
      </section>
    </main>
  )
}

function CreateDeploymentPanel({ onCreated }: { onCreated: (deployment: Deployment) => void }) {
  const [mode, setMode] = useState<CreateMode>('git')
  const [gitUrl, setGitUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const mutation = useMutation({
    mutationFn: () => {
      if (mode === 'git') return createGitDeployment(gitUrl)
      if (!file) throw new Error('Choose a zip archive')
      return createUploadDeployment(file)
    },
    onSuccess: (deployment) => {
      setGitUrl('')
      setFile(null)
      onCreated(deployment)
    }
  })

  return (
    <section className="pane create-pane">
      <div className="pane-heading">
        <h2>Create</h2>
      </div>

      <div className="segmented">
        <button className={mode === 'git' ? 'active' : ''} onClick={() => setMode('git')} type="button">
          Git URL
        </button>
        <button
          className={mode === 'upload' ? 'active' : ''}
          onClick={() => setMode('upload')}
          type="button"
        >
          Zip upload
        </button>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        {mode === 'git' ? (
          <label className="field">
            <span>Public Git URL</span>
            <input
              value={gitUrl}
              onChange={(event) => setGitUrl(event.target.value)}
              placeholder="https://github.com/org/repo.git"
              required
            />
          </label>
        ) : (
          <label className="field">
            <span>Archive</span>
            <input
              accept=".zip,application/zip"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              type="file"
              required
            />
          </label>
        )}

        <button className="primary" disabled={mutation.isPending} type="submit">
          {mutation.isPending ? 'Creating...' : 'Deploy'}
        </button>
        {mutation.error ? <p className="error-text">{mutation.error.message}</p> : null}
      </form>
    </section>
  )
}

function DeploymentList({
  deployments,
  selectedId,
  loading,
  onSelect
}: {
  deployments: Deployment[]
  selectedId?: string
  loading: boolean
  onSelect: (id: string) => void
}) {
  return (
    <section className="pane list-pane">
      <div className="pane-heading">
        <h2>History</h2>
      </div>

      {loading ? <p className="muted">Loading deployments...</p> : null}
      {!loading && deployments.length === 0 ? <p className="muted">No deployments yet.</p> : null}

      <div className="deployment-list">
        {deployments.map((deployment) => (
          <button
            className={deployment.id === selectedId ? 'deployment-row active' : 'deployment-row'}
            key={deployment.id}
            onClick={() => onSelect(deployment.id)}
            type="button"
          >
            <span className="row-main">
              <strong>{deployment.slug}</strong>
              <small>{formatDate(deployment.createdAt)}</small>
            </span>
            <StatusBadge status={deployment.status} />
          </button>
        ))}
      </div>
    </section>
  )
}

function DeploymentDetail({
  deployment,
  logs,
  loading,
  onRedeploy,
  onStop
}: {
  deployment: Deployment | null
  logs: DeploymentLog[]
  loading: boolean
  onRedeploy: (id: string) => Promise<void>
  onStop: (id: string) => Promise<void>
}) {
  const orderedLogs = useMemo(() => [...logs].sort((a, b) => a.seq - b.seq), [logs])
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  if (!deployment) {
    return (
      <section className="pane detail-pane empty-detail">
        <p>{loading ? 'Loading deployment...' : 'Select a deployment.'}</p>
      </section>
    )
  }

  const runAction = async (name: string, action: () => Promise<void>) => {
    setActionError(null)
    setBusyAction(name)
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <section className="pane detail-pane">
      <div className="detail-header">
        <div>
          <div className="title-row">
            <h2>{deployment.slug}</h2>
            <StatusBadge status={deployment.status} />
          </div>
          <p className="muted">{deployment.id}</p>
        </div>

        <div className="actions">
          <button
            disabled={busyAction !== null}
            onClick={() => runAction('redeploy', () => onRedeploy(deployment.id))}
            type="button"
          >
            {busyAction === 'redeploy' ? 'Redeploying...' : 'Redeploy'}
          </button>
          <button
            disabled={busyAction !== null || deployment.status === 'stopped'}
            onClick={() => runAction('stop', () => onStop(deployment.id))}
            type="button"
          >
            {busyAction === 'stop' ? 'Stopping...' : 'Stop'}
          </button>
        </div>
      </div>

      <dl className="metadata">
        <div>
          <dt>Image</dt>
          <dd>{deployment.imageTag ?? '-'}</dd>
        </div>
        <div>
          <dt>URL</dt>
          <dd>
            {deployment.liveUrl ? (
              <a href={deployment.liveUrl} rel="noreferrer" target="_blank">
                {deployment.liveUrl}
              </a>
            ) : (
              '-'
            )}
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{deployment.gitUrl ?? deployment.sourceType}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatDate(deployment.updatedAt)}</dd>
        </div>
      </dl>

      {deployment.errorText ? <p className="error-text">{deployment.errorText}</p> : null}
      {actionError ? <p className="error-text">{actionError}</p> : null}

      <div className="logs-header">
        <h3>Logs</h3>
        <span>{orderedLogs.length} lines</span>
      </div>
      <div className="logs" role="log">
        {orderedLogs.length === 0 ? <p className="muted">Waiting for log events...</p> : null}
        {orderedLogs.map((log) => (
          <div className={`log-line ${log.stream}`} key={log.seq}>
            <span className="log-seq">{log.seq.toString().padStart(3, '0')}</span>
            <span className="log-phase">{log.phase}</span>
            <span className="log-message">{log.message}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function StatusBadge({ status }: { status: DeploymentStatus }) {
  return <span className={`status ${status}`}>{status}</span>
}

function upsertLog(previous: DeploymentLog[], next: DeploymentLog): DeploymentLog[] {
  if (previous.some((item) => item.seq === next.seq)) {
    return previous.map((item) => (item.seq === next.seq ? next : item))
  }

  return [...previous, next]
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}
