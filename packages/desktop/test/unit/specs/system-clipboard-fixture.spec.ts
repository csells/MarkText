import { afterEach, expect, it, vi } from 'vitest'
import { preserveSystemClipboard } from '../../e2e/helpers/systemClipboardFixture'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('allows clipboard writes on an explicitly isolated GitHub-hosted Windows runner', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.stubEnv('GITHUB_ACTIONS', 'true')
  vi.stubEnv('RUNNER_ENVIRONMENT', 'github-hosted')
  vi.stubEnv('MARKTEXT_E2E_PRIVATE_CLIPBOARD', '1')
  const clipboard = preserveSystemClipboard()
  clipboard.rememberOwnedWrite('fixture text')
  clipboard.restore()
})

it.each([
  ['true', 'self-hosted', '1'],
  ['false', 'github-hosted', '1'],
  ['true', 'github-hosted', '0']
])('refuses unowned Windows clipboard state (%s, %s, %s)', (actions, runner, isolated) => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.stubEnv('GITHUB_ACTIONS', actions)
  vi.stubEnv('RUNNER_ENVIRONMENT', runner)
  vi.stubEnv('MARKTEXT_E2E_PRIVATE_CLIPBOARD', isolated)
  expect(() => preserveSystemClipboard()).toThrow()
})
