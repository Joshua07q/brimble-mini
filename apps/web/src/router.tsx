import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { App } from './App'

const rootRoute = createRootRoute({
  component: () => <Outlet />
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (search: Record<string, unknown>) => ({
    deploymentId: typeof search.deploymentId === 'string' ? search.deploymentId : undefined
  }),
  component: App
})

const routeTree = rootRoute.addChildren([indexRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
