export function sanitizeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/\.git$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42)

  return slug.length > 0 ? slug : 'app'
}

export function slugFromGitUrl(gitUrl: string): string {
  try {
    const url = new URL(gitUrl)
    const last = url.pathname.split('/').filter(Boolean).pop()
    return sanitizeSlug(last ?? 'app')
  } catch {
    return sanitizeSlug(gitUrl.split('/').pop() ?? 'app')
  }
}

export function slugFromUploadName(name: string | undefined): string {
  if (!name) return 'upload'
  return sanitizeSlug(name.replace(/\.zip$/i, ''))
}

export function imageNameForDeployment(slug: string, deploymentId: string): string {
  return `local/brimble-mini-${sanitizeSlug(slug)}:${deploymentId.slice(0, 12).toLowerCase()}`
}

export function containerNameForDeployment(slug: string, deploymentId: string): string {
  return `deploy-${sanitizeSlug(slug)}-${deploymentId.slice(0, 8).toLowerCase()}`
}
