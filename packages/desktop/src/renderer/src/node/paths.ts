import EnvPaths from 'common/envPaths'

class RendererPaths extends EnvPaths {
  /**
   * @param userDataPath The user data path.
   */
  constructor(userDataPath: string) {
    if (!userDataPath) {
      throw new Error('No user data path is given.')
    }
    super(userDataPath)
  }
}

export default RendererPaths
