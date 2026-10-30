import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { byPrefixAndName } from '../src/lib/fontawesome.js'

test('Font Awesome regular grid-2 is registered and accessible via byPrefixAndName.far', () => {
  const icon = byPrefixAndName.far['grid-2']
  assert.ok(icon, 'Icon definition should exist')
  assert.equal(icon.prefix, 'far')
  assert.equal(icon.iconName, 'grid-2')
  assert.equal(icon.icon[0], 512)
  assert.equal(icon.icon[1], 512)
  assert.equal(icon.icon[3], 'e196')
  assert.equal(typeof icon.icon[4], 'string', 'Path should be a string for regular icon')

  // Render with FontAwesomeIcon
  const html = renderToStaticMarkup(
    React.createElement(FontAwesomeIcon, {
      icon: byPrefixAndName.far['grid-2'],
      className: 'size-6',
      'aria-hidden': 'true',
    })
  )

  assert.ok(html.includes('data-prefix="far"'), 'Should render with far prefix')
  assert.ok(html.includes('data-icon="grid-2"'), 'Should render with grid-2 icon name')
  assert.ok(html.includes('svg-inline--fa fa-grid-2 size-6'), 'Should preserve size-6 and FA classes')
  assert.ok(html.includes('<path fill="currentColor"'), 'Should render filled path')
})

test('Font Awesome duotone light and thin grid-2 remain available via byPrefixAndName', () => {
  assert.ok(byPrefixAndName.fadl['grid-2'], 'fadl should exist')
  assert.equal(byPrefixAndName.fadl['grid-2'].prefix, 'fadl')
  assert.ok(byPrefixAndName.fadt['grid-2'], 'fadt should exist')
  assert.equal(byPrefixAndName.fadt['grid-2'].prefix, 'fadt')
})
