import type { Deployment } from '../types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed with ${response.status}`)
  }

  return (await response.json()) as T
}

export function listDeployments(): Promise<Deployment[]> {
  return request<Deployment[]>('/api/deployments')
}

export function getDeployment(id: string): Promise<Deployment> {
  return request<Deployment>(`/api/deployments/${id}`)
}

export function createGitDeployment(gitUrl: string): Promise<Deployment> {
  return request<Deployment>('/api/deployments', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ gitUrl })
  })
}

export function createUploadDeployment(file: File): Promise<Deployment> {
  const form = new FormData()
  form.append('archive', file)

  return request<Deployment>('/api/deployments', {
    method: 'POST',
    body: form
  })
}

export function redeployDeployment(id: string): Promise<Deployment> {
  return request<Deployment>(`/api/deployments/${id}/redeploy`, {
    method: 'POST'
  })
}

export function stopDeployment(id: string): Promise<Deployment> {
  return request<Deployment>(`/api/deployments/${id}`, {
    method: 'DELETE'
  })
}
