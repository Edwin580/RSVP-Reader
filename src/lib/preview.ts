/**
 * Pull request previews (see .github/workflows/preview.yml) are built with
 * VITE_PREVIEW set to the PR number. They're served from the same site as
 * the real app, so they keep their data separately: a preview can never
 * change or lose the books in your real library.
 */
export const PREVIEW_PR: string = import.meta.env.VITE_PREVIEW ?? ''
export const IS_PREVIEW = PREVIEW_PR !== ''

/** Storage name, kept apart for previews. */
export const storageName = (name: string) => (IS_PREVIEW ? `${name}-preview` : name)
