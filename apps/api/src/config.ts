import path from 'node:path'

export interface AppConfig {
  port: number
  databasePath: string
  workDir: string
  uploadsDir: string
  sourcesDir: string
  deployNetwork: string
  caddyAdminUrl: string
  caddyServerName: string
  publicBaseDomain: string
  publicPort: string
  appPort: number
  buildKitHost: string
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stringEnv(name: string, fallback: string): string {
  const raw = process.env[name]
  return raw && raw.trim().length > 0 ? raw.trim() : fallback
}

export function loadConfig(): AppConfig {
  const workDir = stringEnv('WORK_DIR', path.resolve(process.cwd(), 'work'))

  return {
    port: numberEnv('PORT', 3000),
    databasePath: stringEnv('DATABASE_PATH', path.join(workDir, 'brimble-mini.db')),
    workDir,
    uploadsDir: path.join(workDir, 'uploads'),
    sourcesDir: path.join(workDir, 'deployments'),
    deployNetwork: stringEnv('DEPLOY_NETWORK', 'brimble_deploynet'),
    caddyAdminUrl: stringEnv('CADDY_ADMIN_URL', 'http://localhost:2019'),
    caddyServerName: stringEnv('CADDY_SERVER_NAME', 'brimble'),
    publicBaseDomain: stringEnv('PUBLIC_BASE_DOMAIN', 'localhost'),
    publicPort: stringEnv('PUBLIC_PORT', '8080'),
    appPort: numberEnv('APP_PORT', 3000),
    buildKitHost: stringEnv('BUILDKIT_HOST', 'tcp://buildkit:1234')
  }
}

export function publicUrlForHost(host: string, config: AppConfig): string {
  const port = config.publicPort
  const suffix = port && port !== '80' ? `:${port}` : ''
  return `http://${host}${suffix}`
}
