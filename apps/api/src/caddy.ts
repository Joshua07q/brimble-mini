import type { AppConfig } from './config'

export function caddyRouteId(deploymentId: string): string {
  return `deploy-${deploymentId}`
}

export interface RegisterRouteInput {
  routeId: string
  host: string
  upstream: string
}

function adminBase(config: AppConfig): string {
  return config.caddyAdminUrl.replace(/\/$/, '')
}

function adminOrigin(config: AppConfig): string {
  return adminBase(config)
}

export async function registerCaddyRoute(config: AppConfig, input: RegisterRouteInput): Promise<void> {
  const route = {
    '@id': input.routeId,
    match: [
      {
        host: [input.host]
      }
    ],
    handle: [
      {
        handler: 'reverse_proxy',
        upstreams: [
          {
            dial: input.upstream
          }
        ]
      }
    ],
    terminal: true
  }

  const response = await fetch(
    `${adminBase(config)}/config/apps/http/servers/${config.caddyServerName}/routes/0`,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: adminOrigin(config)
      },
      body: JSON.stringify(route)
    }
  )

  if (!response.ok) {
    throw new Error(`Caddy route registration failed: ${response.status} ${await response.text()}`)
  }
}

export async function deleteCaddyRoute(config: AppConfig, routeId: string): Promise<void> {
  const response = await fetch(`${adminBase(config)}/id/${encodeURIComponent(routeId)}`, {
    method: 'DELETE',
    headers: {
      origin: adminOrigin(config)
    }
  })

  if (!response.ok && response.status !== 404) {
    throw new Error(`Caddy route deletion failed: ${response.status} ${await response.text()}`)
  }
}
