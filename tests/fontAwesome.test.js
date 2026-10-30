import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { library } from '@fortawesome/fontawesome-svg-core'
import { byPrefixAndName, faGrid2DuotoneThin } from '../src/lib/fontawesome.js'

test('Font Awesome duotone thin grid-2 is registered and accessible via byPrefixAndName', () => {
  const icon = byPrefixAndName.fadt['grid-2']
  assert.ok(icon, 'Icon definition should exist')
  assert.equal(icon.prefix, 'fadt')
  assert.equal(icon.iconName, 'grid-2')
  assert.equal(icon.icon[0], 512)
  assert.equal(icon.icon[1], 512)
  assert.equal(icon.icon[3], 'e196')
  assert.ok(Array.isArray(icon.icon[4]), 'Paths should be an array for duotone')
  assert.equal(icon.icon[4].length, 2, 'Should have secondary and primary path layers')

  // Render with FontAwesomeIcon
  const html = renderToStaticMarkup(
    React.createElement(FontAwesomeIcon, {
      icon: byPrefixAndName.fadt['grid-2'],
      className: 'size-6',
      'aria-hidden': 'true',
    })
  )

  assert.ok(html.includes('data-prefix="fadt"'), 'Should render with fadt prefix')
  assert.ok(html.includes('data-icon="grid-2"'), 'Should render with grid-2 icon name')
  assert.ok(html.includes('svg-inline--fa fa-grid-2 size-6'), 'Should preserve size-6 and FA classes')
  assert.ok(html.includes('fa-duotone-group'), 'Should include duotone group element')
  assert.ok(html.includes('fa-secondary'), 'Should include secondary layer')
  assert.ok(html.includes('fa-primary'), 'Should include primary layer')
})

