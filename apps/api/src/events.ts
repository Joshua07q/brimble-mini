import type { DeploymentLog } from './types'

type Subscriber = (event: DeploymentLog) => void

export class DeploymentEvents {
  private readonly subscribers = new Map<string, Set<Subscriber>>()

  subscribe(deploymentId: string, subscriber: Subscriber): () => void {
    const existing = this.subscribers.get(deploymentId) ?? new Set<Subscriber>()
    existing.add(subscriber)
    this.subscribers.set(deploymentId, existing)

    return () => {
      existing.delete(subscriber)
      if (existing.size === 0) this.subscribers.delete(deploymentId)
    }
  }

  publish(event: DeploymentLog): void {
    const subscribers = this.subscribers.get(event.deploymentId)
    if (!subscribers) return

    for (const subscriber of subscribers) {
      subscriber(event)
    }
  }
}
