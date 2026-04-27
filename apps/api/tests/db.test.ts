import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeploymentStore } from '../src/db'

let tmpDir: string
let store: DeploymentStore

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brimble-mini-db-'))
  store = new DeploymentStore(path.join(tmpDir, 'test.db'))
})

afterEach(() => {
  store.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('DeploymentStore', () => {
  it('persists deployment state transitions and ordered logs', () => {
    const deployment = store.createDeployment({
      id: 'dep-1',
      slug: 'sample-dep-1',
      sourceType: 'git',
      gitUrl: 'https://github.com/example/app.git'
    })

    expect(deployment.status).toBe('pending')

    const updated = store.updateDeployment(deployment.id, {
      status: 'building',
      imageTag: 'local/brimble-mini-sample:dep-1'
    })
    expect(updated.status).toBe('building')
    expect(updated.imageTag).toBe('local/brimble-mini-sample:dep-1')

    const first = store.appendLog(deployment.id, 'log', 'build', 'stdout', 'installing')
    const second = store.appendLog(deployment.id, 'status', 'control', 'system', 'building')

    expect(first.seq).toBe(1)
    expect(second.seq).toBe(2)
    expect(store.listLogs(deployment.id, 1).map((row) => row.message)).toEqual(['building'])
  })
})
