// Project content is managed by the CMS and read from the published source.
// Keeping this empty array as a compatibility export prevents legacy imports
// from recreating starter cards when the CMS has no published projects.
export const categories = ['All', 'Web', 'Mobile', 'UI/UX']
export const projects = []

export const projectDetailsPath = (project) => `/projects/${project.slug}`
