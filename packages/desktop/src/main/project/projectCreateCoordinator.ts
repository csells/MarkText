import type {
  ProjectCreateIntent,
  ProjectCreateReceipt
} from '@shared/types/projectCreate'
import {
  createProjectEntry,
  type CreateProjectEntryOptions
} from './projectCreateService'

export interface ProjectCreateEditorWindow {
  readonly openedRootDirectory: string | null
  admitProjectFile(pathname: string): Promise<void>
}

export type ProjectCreateEntry = (
  options: CreateProjectEntryOptions
) => Promise<ProjectCreateReceipt>

export async function coordinateProjectCreate(
  editor: ProjectCreateEditorWindow,
  intent: ProjectCreateIntent,
  createEntry: ProjectCreateEntry = createProjectEntry
): Promise<ProjectCreateReceipt> {
  const root = editor.openedRootDirectory
  if (!root) {
    throw new Error('Project creation requires a retained project root')
  }
  return await createEntry({
    root,
    intent,
    admitFile: pathname => editor.admitProjectFile(pathname)
  })
}
