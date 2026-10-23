// src/data/profile.js
// One place for personal details. Edit here, and every component updates.

export const profile = {
  name: 'Fitsum Mesfin',
  firstName: 'FITSUM',
  lastName: 'MESFIN',
  monogram: 'FM',
  title: 'Software Developer',
  email: 'Befitsa123@gmail.com',
  about:
    'Iâ€™m Fitsum Mesfin, a passionate software developer creating high-performance, user-centered digital experiences. I turn complex ideas into clear, useful products that feel as good as they work.',
  roles: ['React Developer', 'Flutter Developer', 'UI/UX Designer'],
  intro:
    'Fueling the future with sleek, responsive websites and intuitive digital experiences. From thoughtful UI/UX to practical technology solutions.',

  // Put your photo at public/images/profile.JPG (any size works, ~1000px wide
  // is plenty). Until the file exists, a clean placeholder is shown instead.
  portrait: {
    src: '/images/profile.JPG',
    alt: 'Portrait of Fitsum Mesfin',
  },

  // Download is enabled only when the CMS publishes a real PDF.
  resume: {
    downloadName: 'Fitsum-Mesfin-Resume.pdf',
  },

  // Social links. An empty `url` means "not provided yet" and the icon is hidden,
  // so visitors never see a dead link. Fill in the real URLs to show them.
  // To add another profile, add an object; `id` picks the icon (see SocialLinks.jsx).
  socials: [
    { id: 'github', label: 'GitHub', url: '' },
    { id: 'linkedin', label: 'LinkedIn', url: '' },
    { id: 'email', label: 'Email', url: 'mailto:Befitsa123@gmail.com' },
  ],
}

// Navigation items. `id` must match a section/element id on the page.
export const navItems = [
  { label: 'Home', id: 'home' },
  { label: 'About Me', id: 'about' },
  { label: 'Skills', id: 'skills' },
  { label: 'Services', id: 'services' },
  { label: 'Projects', id: 'projects' },
  { label: 'Contact', id: 'contact' },
]

// Every section id in DOM order — used to work out which one is on screen.
export const sectionIds = [
  'home',
  'about',
  'skills',
  'services',
  'background',
  'projects',
  'opportunities',
  'contact',
]
