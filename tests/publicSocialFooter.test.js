import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { toProfileSettings } from '../src/lib/db/presentation.js'
import { profile as fallbackProfile } from '../src/data/profile.js'

test('public footer renders published built-in and custom social links in order after email', async () => {
  const vite = await createServer({
    configFile: 'vite.config.js',
    server: { middlewareMode: true },
    appType: 'custom',
  })

  try {
    const [{ default: Footer }, { PortfolioProfileProvider }] = await Promise.all([
      vite.ssrLoadModule('/src/components/layout/Footer.jsx'),
      vite.ssrLoadModule('/src/context/PortfolioProfileContext.jsx'),
    ])
    const settings = {
      ...fallbackProfile,
      socialLinks: {
        email: 'mailto:contact@example.com',
        github: 'https://github.com/fitsum',
        linkedin: 'https://linkedin.com/in/fitsum',
        instagram: 'https://instagram.com/fitsum',
        telegram: 'https://t.me/fitsum',
      },
      socialLinkDisplayOrders: { github: 4, linkedin: 2, instagram: 1, telegram: 3 },
      socialLinkDetails: {
        github: { platform: 'GitHub', enabled: true, logo: null },
        linkedin: { platform: 'LinkedIn', enabled: true, logo: null },
        instagram: { platform: 'Instagram', enabled: true, logo: null },
        telegram: { platform: 'Telegram', enabled: true, logo: null },
      },
      customSocialLinks: [{
        id: 'custom-dribbble',
        platform: 'Dribbble',
        url: 'https://dribbble.com/fitsum',
        logo: { url: 'https://cdn.example.com/dribbble.png' },
        displayOrder: 5,
      }],
    }
    const publishedProfile = toProfileSettings(settings, fallbackProfile)
    const markup = renderToStaticMarkup(React.createElement(
      PortfolioProfileProvider,
      { value: publishedProfile },
      React.createElement(Footer),
    ))
    const links = [...markup.matchAll(/<a\b[^>]*>/g)]
      .map(([tag]) => ({
        label: tag.match(/\baria-label="([^"]*)"/)?.[1],
        href: tag.match(/\bhref="([^"]*)"/)?.[1],
      }))
      .filter(({ label }) => ['Email', 'Instagram', 'LinkedIn', 'Telegram', 'GitHub', 'Dribbble'].includes(label))

    assert.deepEqual(links, [
      { label: 'Email', href: 'mailto:contact@example.com' },
      { label: 'Instagram', href: 'https://instagram.com/fitsum' },
      { label: 'LinkedIn', href: 'https://linkedin.com/in/fitsum' },
      { label: 'Telegram', href: 'https://t.me/fitsum' },
      { label: 'GitHub', href: 'https://github.com/fitsum' },
      { label: 'Dribbble', href: 'https://dribbble.com/fitsum' },
    ])
    assert.match(markup, /rel="noopener noreferrer"/)
    assert.match(markup, /dribbble\.png/)
  } finally {
    await vite.close()
  }
})
