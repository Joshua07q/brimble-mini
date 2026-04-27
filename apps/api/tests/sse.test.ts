import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { AppConfig } from '../src/config'
import { DeploymentStore } from '../src/db'
import { DeploymentEvents } from '../src/events'
import type { DeploymentOrchestrator } from '../src/orchestrator'

let tmpDir: string
let store: DeploymentStore
let events: DeploymentEvents
let server: http.Server | undefined

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brimble-mini-sse-'))
  store = new DeploymentStore(path.join(tmpDir, 'test.db'))
  events = new DeploymentEvents()
})

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server?.listening) {
      resolve()
      return
    }
    server.close(() => resolve())
  })
  store.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('SSE log stream', () => {
  it('replays persisted backlog and tails live events', async () => {
    const deployment = store.createDeployment({
      id: 'dep-1',
      slug: 'sample-dep-1',
      sourceType: 'git',
      gitUrl: 'https://github.com/example/app.git'
    })
    store.appendLog(deployment.id, 'log', 'source', 'system', 'backlog line')

    const app = createApp({
      config: testConfig(tmpDir),
      store,
      events,
      orchestrator: {
        enqueue: () => undefined,
        stop: async () => null
      } as unknown as DeploymentOrchestrator
    })

    server = app.listen(0)
    await onceListening(server)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing test server port')

    const response = await fetch(`http://127.0.0.1:${address.port}/api/deployments/${deployment.id}/events`)
    expect(response.ok).toBe(true)
    if (!response.body) throw new Error('missing SSE response body')

    const reader = response.body.getReader()
    let body = await readUntil(reader, 'backlog line')
    const live = store.appendLog(deployment.id, 'log', 'build', 'stdout', 'live line')
    events.publish(live)
    body += await readUntil(reader, 'live line')
    await reader.cancel()

    expect(body).toContain('event: log')
    expect(body).toContain('backlog line')
    expect(body).toContain('live line')
  })
})

function testConfig(root: string): AppConfig {
  return {
    port: 0,
    databasePath: path.join(root, 'test.db'),
    workDir: root,
    uploadsDir: path.join(root, 'uploads'),
    sourcesDir: path.join(root, 'deployments'),
    deployNetwork: 'brimble_deploynet',
    caddyAdminUrl: 'http://localhost:2019',
    caddyServerName: 'brimble',
    publicBaseDomain: 'localhost',
    publicPort: '8080',
    appPort: 3000,
    buildKitHost: 'tcp://buildkit:1234'
  }
}

function onceListening(target: http.Server): Promise<void> {
  if (target.listening) return Promise.resolve()
  return new Promise((resolve) => target.once('listening', resolve))
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
  const decoder = new TextDecoder()
  const deadline = Date.now() + 2000
  let body = ''

  while (Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out waiting for ${needle}`)), 100)
      )
    ]).catch(() => null)

    if (!result) continue
    if (result.done) break

    body += decoder.decode(result.value, { stream: true })
    if (body.includes(needle)) return body
  }

  throw new Error(`timed out waiting for ${needle}`)
}
