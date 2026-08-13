import { describe, expect, it, vi } from 'vitest'

vi.mock('@/pages/app.vue', () => ({ default: { name: 'AppPage' } }))
vi.mock('@/pages/preference.vue', () => ({ default: { name: 'PreferencePage' } }))
vi.mock('@/prefComponents/general/index.vue', () => ({ default: { name: 'GeneralPreference' } }))
vi.mock('@/prefComponents/editor/index.vue', () => ({ default: { name: 'EditorPreference' } }))
vi.mock('@/prefComponents/markdown/index.vue', () => ({ default: { name: 'MarkdownPreference' } }))
vi.mock('@/prefComponents/spellchecker/index.vue', () => ({ default: { name: 'SpellingPreference' } }))
vi.mock('@/prefComponents/theme/index.vue', () => ({ default: { name: 'ThemePreference' } }))
vi.mock('@/prefComponents/image/index.vue', () => ({ default: { name: 'ImagePreference' } }))
vi.mock('@/prefComponents/keybindings/index.vue', () => ({ default: { name: 'KeybindingsPreference' } }))

import routes from '@/router'

type RouteLike = Readonly<{
  path: string
  name?: string
  component?: unknown
  redirect?: string
  children?: readonly RouteLike[]
}>

const childRoutes = (type: string): readonly RouteLike[] => {
  const preference = (routes(type) as RouteLike[])
    .find(route => route.path === '/preference')
  if (!preference?.children) {
    throw new Error('Preference route requires registered child routes')
  }
  return preference.children
}

describe('CriticMarkup renderer route production surfaces', () => {
  it('dispatches the index route to the exact editor or preference entry surface', () => {
    const dispatches = [
      {
        itemId: 'route:',
        type: undefined,
        expected: '/preference'
      },
      {
        itemId: 'route:/',
        type: 'editor',
        expected: '/editor'
      }
    ] as const

    for (const { itemId, type, expected } of dispatches) {
      const root = (routes(type) as RouteLike[]).find(route => route.path === '/')
      expect(root?.redirect, itemId).toBe(expected)
    }
  })

  it('registers every concrete editor and preference route with its exact path and component', () => {
    const topLevel = routes('editor') as RouteLike[]
    const registrations = [
      {
        itemId: 'route:/editor',
        route: topLevel.find(candidate => candidate.path === '/editor'),
        expected: { path: '/editor' }
      },
      {
        itemId: 'route:/preference',
        route: topLevel.find(candidate => candidate.path === '/preference'),
        expected: { path: '/preference' }
      },
      ...[
        ['route:general', 'general'],
        ['route:editor', 'editor'],
        ['route:markdown', 'markdown'],
        ['route:spelling', 'spelling'],
        ['route:theme', 'theme'],
        ['route:image', 'image'],
        ['route:keybindings', 'keybindings']
      ].map(([itemId, path]) => ({
        itemId,
        route: childRoutes('preference').find(candidate => candidate.path === path),
        expected: { path, name: path }
      }))
    ] as const

    for (const { itemId, route, expected } of registrations) {
      expect(route, itemId).toMatchObject(expected)
      expect(route?.component, itemId).toBeDefined()
    }
  })
})
