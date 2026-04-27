import fs from 'node:fs'
import path from 'node:path'
import type { AppConfig } from './config'
import { publicUrlForHost } from './config'
import { caddyRouteId, deleteCaddyRoute, registerCaddyRoute } from './caddy'
import { runLogged } from './command'
import type { DeploymentStore } from './db'
import type { Deployment, DeploymentLog, DeploymentStatus, LogStream } from './types'
import type { DeploymentEvents } from './events'
import { containerNameForDeployment, imageNameForDeployment } from './names'

export interface OrchestratorDeps {
  config: AppConfig
  store: DeploymentStore
  events: DeploymentEvents
}

export class DeploymentOrchestrator {
  private readonly running = new Set<string>()

  constructor(private readonly deps: OrchestratorDeps) {}

  enqueue(deploymentId: string): void {
    if (this.running.has(deploymentId)) return
    this.running.add(deploymentId)
    void this.run(deploymentId).finally(() => {
      this.running.delete(deploymentId)
    })
  }

  async stop(deploymentId: string): Promise<Deployment | null> {
    const deployment = this.deps.store.getDeployment(deploymentId)
    if (!deployment) return null

    this.append(deploymentId, 'log', 'runtime', 'system', 'Stopping deployment')

    if (deployment.containerName) {
      await runLogged('docker', ['rm', '-f', deployment.containerName], {
        onLine: (stream, line) => this.append(deploymentId, 'log', 'runtime', stream, line)
      }).catch((error: unknown) => {
        this.append(deploymentId, 'log', 'runtime', 'system', errorMessage(error))
      })
    }

    await deleteCaddyRoute(this.deps.config, caddyRouteId(deploymentId)).catch((error: unknown) => {
      this.append(deploymentId, 'log', 'routing', 'system', errorMessage(error))
    })

    return this.setStatus(deploymentId, 'stopped', {
      finishedAt: new Date().toISOString()
    })
  }

  private async run(deploymentId: string): Promise<void> {
    const deployment = this.deps.store.getDeployment(deploymentId)
    if (!deployment) return

    const workRoot = path.join(this.deps.config.sourcesDir, deployment.id)
    const sourceDir = path.join(workRoot, 'src')
    const imageTag = imageNameForDeployment(deployment.slug, deployment.id)
    const containerName = containerNameForDeployment(deployment.slug, deployment.id)
    const host = `${deployment.slug}.${this.deps.config.publicBaseDomain}`
    const liveUrl = publicUrlForHost(host, this.deps.config)

    try {
      this.setStatus(deploymentId, 'pending', {
        startedAt: new Date().toISOString(),
        errorText: null
      })

      fs.rmSync(workRoot, { recursive: true, force: true })
      fs.mkdirSync(workRoot, { recursive: true })

      await this.prepareSource(deployment, sourceDir)

      this.setStatus(deploymentId, 'building', {
        imageTag
      })
      this.append(deploymentId, 'log', 'build', 'system', `Building image ${imageTag}`)

      await runLogged('railpack', ['build', '--name', imageTag, sourceDir], {
        env: {
          BUILDKIT_HOST: this.deps.config.buildKitHost
        },
        onLine: (stream, line) => this.append(deploymentId, 'log', 'build', stream, line)
      })

      this.setStatus(deploymentId, 'deploying', {
        containerName
      })

      await runLogged('docker', ['rm', '-f', containerName], {
        onLine: (stream, line) => this.append(deploymentId, 'log', 'runtime', stream, line)
      }).catch(() => {
        return undefined
      })

      this.append(deploymentId, 'log', 'runtime', 'system', `Starting container ${containerName}`)
      await runLogged(
        'docker',
        [
          'run',
          '-d',
          '--name',
          containerName,
          '--network',
          this.deps.config.deployNetwork,
          '--label',
          `brimble-mini.deployment=${deployment.id}`,
          '-e',
          `PORT=${this.deps.config.appPort}`,
          imageTag
        ],
        {
          onLine: (stream, line) => this.append(deploymentId, 'log', 'runtime', stream, line)
        }
      )

      await this.waitForRuntime(containerName, deploymentId)

      this.append(deploymentId, 'log', 'routing', 'system', `Registering ${host} in Caddy`)
      await registerCaddyRoute(this.deps.config, {
        routeId: caddyRouteId(deploymentId),
        host,
        upstream: `${containerName}:${this.deps.config.appPort}`
      })

      this.setStatus(deploymentId, 'running', {
        routeKind: 'host',
        routeValue: host,
        liveUrl,
        finishedAt: new Date().toISOString()
      })
    } catch (error: unknown) {
      const message = errorMessage(error)
      this.append(deploymentId, 'log', 'runtime', 'system', message)
      this.setStatus(deploymentId, 'failed', {
        errorText: message,
        finishedAt: new Date().toISOString()
      })
    }
  }

  private async prepareSource(deployment: Deployment, sourceDir: string): Promise<void> {
    if (deployment.sourceType === 'git') {
      if (!deployment.gitUrl) throw new Error('git deployment missing gitUrl')
      this.append(deployment.id, 'log', 'source', 'system', `Cloning ${deployment.gitUrl}`)
      await runLogged('git', ['clone', '--depth=1', deployment.gitUrl, sourceDir], {
        onLine: (stream, line) => this.append(deployment.id, 'log', 'source', stream, line)
      })
      return
    }

    if (!deployment.uploadPath) throw new Error('upload deployment missing uploadPath')
    fs.mkdirSync(sourceDir, { recursive: true })
    this.append(deployment.id, 'log', 'source', 'system', `Unpacking ${path.basename(deployment.uploadPath)}`)
    await runLogged('unzip', ['-q', deployment.uploadPath, '-d', sourceDir], {
      onLine: (stream, line) => this.append(deployment.id, 'log', 'source', stream, line)
    })
  }

  private async waitForRuntime(containerName: string, deploymentId: string): Promise<void> {
    const base = `http://${containerName}:${this.deps.config.appPort}`
    const deadline = Date.now() + 30_000
    let lastError = 'runtime did not respond'

    while (Date.now() < deadline) {
      for (const endpoint of ['/healthz', '/']) {
        try {
          const response = await fetch(`${base}${endpoint}`, {
            signal: AbortSignal.timeout(1500)
          })
          if (response.ok) return
          lastError = `${endpoint} returned ${response.status}`
        } catch (error: unknown) {
          lastError = errorMessage(error)
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    this.append(deploymentId, 'log', 'runtime', 'system', lastError)
    throw new Error(`container ${containerName} did not become ready`)
  }

  private setStatus(
    deploymentId: string,
    status: DeploymentStatus,
    patch: Parameters<DeploymentStore['updateDeployment']>[1] = {}
  ): Deployment {
    const deployment = this.deps.store.updateDeployment(deploymentId, {
      ...patch,
      status
    })
    this.append(deploymentId, 'status', 'control', 'system', status)
    return deployment
  }

  private append(
    deploymentId: string,
    eventType: DeploymentLog['eventType'],
    phase: string,
    stream: LogStream,
    message: string
  ): DeploymentLog {
    const event = this.deps.store.appendLog(deploymentId, eventType, phase, stream, message)
    this.deps.events.publish(event)
    return event
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
