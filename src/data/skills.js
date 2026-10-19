// src/data/skills.js
// Logos come from react-icons (Simple Icons set), so they are real brand marks.
// Colors are the brand colors, lightened slightly where needed to read on dark.
import { Layers } from 'lucide-react'
import { SiReact, SiFigma, SiJavascript, SiHtml5, SiCss, SiFlutter, SiDart } from 'react-icons/si'

export const skills = [
  { name: 'React', Icon: SiReact, color: '#61DAFB' },
  { name: 'JavaScript', Icon: SiJavascript, color: '#F7DF1E' },
  { name: 'HTML5', Icon: SiHtml5, color: '#E34F26' },
  { name: 'CSS3', Icon: SiCss, color: '#4C9BE8' },
  { name: 'Flutter', Icon: SiFlutter, color: '#54C5F8' },
  { name: 'Dart', Icon: SiDart, color: '#2BB7F6' },
  { name: 'Stacked MVVM', Icon: Layers, color: '#8A6A3E' },
  { name: 'Figma', Icon: SiFigma, color: '#F24E1E' },
]
