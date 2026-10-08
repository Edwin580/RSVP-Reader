/**
 * Save a file the way the device does best: on phones, the share sheet
 * (Files, iCloud, AirDrop, another app); elsewhere, a download. Resolves
 * false if the share sheet was closed without saving.
 *
 * Only the file is shared: given a title too, an iPhone's Save to Files
 * saves it as a second, text file beside the first.
 */
export async function saveFile(file: File): Promise<boolean> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return true
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false
      throw e
    }
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return true
}
