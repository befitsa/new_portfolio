// src/utils/gsap.js
// Register GSAP plugins exactly once, then import { gsap, ScrollTrigger, SplitText } from here.
// SplitText is included free in the gsap package (v3.13+).
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

gsap.registerPlugin(ScrollTrigger, SplitText)

export { gsap, ScrollTrigger, SplitText }
