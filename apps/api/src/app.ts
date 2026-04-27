import crypto from 'node:crypto'
import fs from 'node:fs'
import express from 'express'
import multer from 'multer'
import { z } from 'zod'
import type { AppConfig } from './config'
import type { DeploymentStore } from './db'
import type { DeploymentEvents } from './events'
import type { DeploymentOrchestrator } from './orchestrator'
import { slugFromGitUrl, slugFromUploadName, sanitizeSlug } from './names'

export interface CreateAppDeps {
  config: AppConfig
  store: DeploymentStore
  events: DeploymentEvents
  orchestrator: DeploymentOrchestrator
}

const gitUrlSchema = z.string().trim().url().refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
  message: 'Only public http(s) Git URLs are supported'
})

export function createApp(deps: CreateAppDeps): express.Express {
  fs.mkdirSync(deps.config.uploadsDir, { recursive: true })

  const app = express()
  const upload = multer({
    dest: deps.config.uploadsDir,
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 1
    }
  })

  app.use(express.json())

  app.get('/api/healthz', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/deployments', (_req, res) => {
    res.json(deps.store.listDeployments())
  })

  app.get('/api/deployments/:id', (req, res) => {
    const deployment = deps.store.getDeployment(req.params.id)
    if (!deployment) {
      res.status(404).json({ error: 'Deployment not found' })
      return
    }

    res.json(deployment)
  })

  app.post('/api/deployments', upload.single('archive'), (req, res) => {
    const gitUrl = typeof req.body.gitUrl === 'string' ? req.body.gitUrl.trim() : ''
    const file = req.file

    if (!gitUrl && !file) {
      res.status(400).json({ error: 'Provide a public gitUrl or an archive zip upload' })
      return
    }

    if (gitUrl && file) {
      res.status(400).json({ error: 'Provide either gitUrl or archive, not both' })
      return
    }

    if (gitUrl) {
      const parsed = gitUrlSchema.safeParse(gitUrl)
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid gitUrl' })
        return
      }
    }

    const id = crypto.randomUUID()
    const baseSlug = gitUrl ? slugFromGitUrl(gitUrl) : slugFromUploadName(file?.originalname)
    const slug = uniqueSlug(deps.store, baseSlug, id)

    const deployment = deps.store.createDeployment({
      id,
      slug,
      sourceType: gitUrl ? 'git' : 'upload',
      gitUrl: gitUrl || null,
      uploadPath: file?.path ?? null
    })

    deps.orchestrator.enqueue(deployment.id)
    res.status(202).json(deployment)
  })

  app.post('/api/deployments/:id/redeploy', (req, res) => {
    const original = deps.store.getDeployment(req.params.id)
    if (!original) {
      res.status(404).json({ error: 'Deployment not found' })
      return
    }

    if (original.sourceType === 'upload' && !original.uploadPath) {
      res.status(400).json({ error: 'Original upload artifact is missing' })
      return
    }

    const id = crypto.randomUUID()
    const slug = uniqueSlug(deps.store, `${original.slug}-redeploy`, id)
    const deployment = deps.store.createDeployment({
      id,
      slug,
      sourceType: original.sourceType,
      gitUrl: original.gitUrl,
      uploadPath: original.uploadPath,
      redeployFromId: original.id
    })

    deps.orchestrator.enqueue(deployment.id)
    res.status(202).json(deployment)
  })

  app.delete('/api/deployments/:id', async (req, res, next) => {
    try {
      const deployment = await deps.orchestrator.stop(req.params.id)
      if (!deployment) {
        res.status(404).json({ error: 'Deployment not found' })
        return
      }

      res.json(deployment)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/deployments/:id/events', (req, res) => {
    const deployment = deps.store.getDeployment(req.params.id)
    if (!deployment) {
      res.status(404).json({ error: 'Deployment not found' })
      return
    }

    const lastEventId = Number(req.header('last-event-id') ?? 0)
    const afterSeq = Number.isFinite(lastEventId) ? lastEventId : 0

    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    for (const event of deps.store.listLogs(deployment.id, afterSeq)) {
      writeSse(res, event.seq, event.eventType, event)
    }

    const off = deps.events.subscribe(deployment.id, (event) => {
      writeSse(res, event.seq, event.eventType, event)
    })

    req.on('close', off)
  })

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: message })
  })

  return app
}

function writeSse(res: express.Response, id: number, event: string, data: unknown): void {
  res.write(`id: ${id}\n`)
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function uniqueSlug(store: DeploymentStore, baseSlug: string, id: string): string {
  const prefix = sanitizeSlug(baseSlug)
  const initial = `${prefix}-${id.slice(0, 6).toLowerCase()}`
  if (!store.slugExists(initial)) return initial

  let index = 2
  while (store.slugExists(`${initial}-${index}`)) {
    index += 1
  }

  return `${initial}-${index}`
}
