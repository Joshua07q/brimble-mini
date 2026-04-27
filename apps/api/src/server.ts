import fs from 'node:fs'
import { createApp } from './app'
import { loadConfig } from './config'
import { DeploymentStore } from './db'
import { DeploymentEvents } from './events'
import { DeploymentOrchestrator } from './orchestrator'

const config = loadConfig()

fs.mkdirSync(config.workDir, { recursive: true })
fs.mkdirSync(config.uploadsDir, { recursive: true })
fs.mkdirSync(config.sourcesDir, { recursive: true })

const store = new DeploymentStore(config.databasePath)
store.markInterruptedDeployments()

const events = new DeploymentEvents()
const orchestrator = new DeploymentOrchestrator({
  config,
  store,
  events
})

const app = createApp({
  config,
  store,
  events,
  orchestrator
})

app.listen(config.port, () => {
  console.log(`api listening on ${config.port}`)
})
