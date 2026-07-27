import { t } from '../../i18n'
import type { PrefSelectOption } from '../common/types'

export const getTextDirectionOptions = (): PrefSelectOption<string>[] => [
  {
    label: t('preferences.editor.misc.textDirection.ltr'),
    value: 'ltr'
  },
  {
    label: t('preferences.editor.misc.textDirection.rtl'),
    value: 'rtl'
  }
]
