// Check for updates (desktop app only): asks the desktop app to look for a new release now instead of waiting for
// the hourly check. A new version downloads in the background, then DesktopUpdate offers to restart into it.
const checking = ref(false)
// Bumped when a check finds an update already downloaded, so DesktopUpdate reopens its dialog after a "Later".
const reopen = ref(0)

export function useUpdateCheck() {
  const toast = useToast()
  const available = computed(() => !!bowerDesktop()?.checkForUpdate)

  async function check() {
    const desktop = bowerDesktop()
    if (!desktop?.checkForUpdate || checking.value) return
    checking.value = true
    try {
      const r = await desktop.checkForUpdate()
      if (!r) return
      if (r.status === 'latest') toast.add({ title: 'Bower is up to date', description: `You have the latest version, ${r.version}.`, color: 'success', icon: 'i-heroicons-check-circle' })
      else if (r.status === 'downloading') toast.add({ title: `Downloading Bower ${r.version}`, description: 'You will be asked to restart once it has downloaded.', color: 'neutral', icon: 'i-heroicons-arrow-down-tray' })
      else if (r.status === 'ready') reopen.value++
      else if (r.status === 'unavailable') toast.add({ title: 'Updates are off', description: 'Only the installed desktop app updates itself.', color: 'neutral' })
      else toast.add({ title: 'Could not check for updates', description: r.message, color: 'error' })
    } finally {
      checking.value = false
    }
  }

  return { available, checking, check, reopen }
}
