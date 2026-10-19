# Fitsum Mesfin — 3D Portfolio

React + Vite + Tailwind CSS v4, with real 3D (Three.js / React Three Fiber), Motion, GSAP ScrollTrigger and Lenis.

## Run it
```bash
npm install
npm run dev       # development server
npm run build     # production build -> dist/
npm run preview   # serve the production build locally
```

## Where to put your things
| What | Where |
|---|---|
| Portrait photo | `public/images/portrait.webp` (path set in `src/data/profile.js`) |
| Resume PDF | `public/resume/Fitsum-Mesfin-Resume.pdf` (or set `resume.url` in `src/data/profile.js`) |
| Social links | `src/data/profile.js` -> `socials` (empty URL = icon hidden) |
| 12 projects | `src/data/projects.js` (images in `public/images/projects/`) |
| Experience tab | `src/data/experience.js` (empty until you add entries) |
| Education, skills, services | `src/data/education.js`, `skills.js`, `services.js` |
| Colors and fonts | `@theme` block in `src/index.css` |

## Contact form
The form posts JSON `{ name, email, subject, message }` to your own backend.
1. Copy `.env.example` to `.env`
2. Set `VITE_CONTACT_API_URL=https://your-endpoint`
Without it, the form says plainly that nothing was sent and offers a mailto link.
Never put email-service secrets in `VITE_` variables: they are public.

## Structure
`src/components/{layout,common,sections,projects,three}`, `src/data`, `src/hooks`, `src/services`, `src/utils`.
