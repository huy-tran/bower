// Opens Bower's own settings (this computer, every project) from anywhere: the header, the setup chip, links.
export type BowerSettingsTab = 'claude' | 'defaults' | 'apps'

const open = ref(false)
const tab = ref<BowerSettingsTab>('claude')

export function useBowerSettings() {
  return {
    open,
    tab,
    show: (t: BowerSettingsTab = 'claude') => { tab.value = t; open.value = true }
  }
}
