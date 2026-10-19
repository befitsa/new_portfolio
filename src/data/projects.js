// src/data/projects.js
// 12 editable project slots. Replace each placeholder with a real project.
//
// Fields:
//   id          unique string
//   title       project name
//   description one or two sentences
//   category    'Web Design' | 'Mobile App' | 'UI/UX'   (drives the filters)
//   tech        array of strings, e.g. ['React', 'Tailwind']
//   image       path in /public, e.g. '/images/projects/my-app.webp' ('' = designed placeholder)
//   preview3d   null | 'orbit' | 'stack'   (optional real 3D preview instead of an image)
//   liveUrl / sourceUrl / caseStudyUrl   leave '' and the button is hidden
//   isPlaceholder   set to false once the slot holds a real project

export const categories = ['All', 'Web Design', 'Mobile App', 'UI/UX']

const slot = (n, category, extra = {}) => ({
  id: `project-${String(n).padStart(2, '0')}`,
  title: `Project slot ${String(n).padStart(2, '0')}`,
  description: 'Placeholder. Replace this slot in src/data/projects.js with a real project.',
  category,
  tech: [],
  image: '',
  preview3d: null,
  liveUrl: '',
  sourceUrl: '',
  caseStudyUrl: '',
  isPlaceholder: true,
  ...extra,
})

export const projects = [
  slot(1, 'Web Design'),
  slot(2, 'Mobile App'),
  slot(3, 'UI/UX'),
  slot(4, 'Web Design'),
  slot(5, 'Mobile App'),
  slot(6, 'Web Design'),
  slot(7, 'UI/UX'),
  slot(8, 'Mobile App'),
  slot(9, 'Web Design'),
  slot(10, 'UI/UX'),
  slot(11, 'Mobile App'),
  slot(12, 'Web Design'),
]
