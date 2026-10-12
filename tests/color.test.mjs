#!/usr/bin/env node
/**
 * Offline unit tests for the colour maths inside `client.js` — no DOM, no browser.
 *
 * Everything that went wrong around transparency lived here: a hex edit that reset the
 * opacity to 100 %, a picker value whose alpha was flattened, a percentage alpha that got
 * clamped to 1, a slider writing back a stale draft. Those are pure functions, so they get
 * tests; the React surfaces stay covered by the browser verification in
 * `docs/verification.md`.
 *
 * `client.js` is a browser module, so it is evaluated in a bare `node:vm` context with the
 * test flag set; the module returns its internals on `exports.__internals` only then.
 *
 * @module dsh-colorize/tests/color
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT = join(root, 'client.js')

/** Load the browser half in a bare context and hand back its test-only internals. */
function loadInternals() {
  let exports = null
  const context = createContext({ __DSH_COLORIZE_TEST__: true, console })
  context.window = context
  context.document = {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
    head: { appendChild() {} },
    body: { appendChild() {} },
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  }
  context.require = (id) => (id === 'react'
    ? { createElement: () => null, useState: (value) => [value, () => {}], useRef: (value) => ({ current: value }), useEffect() {}, useCallback: (fn) => fn }
    : {})
  context.__ModuleLoader__ = {
    load: (spec) => {
      assert.equal(spec.id, 'dsh-colorize', 'the loader id must be the package name')
      exports = spec.factory(context.require)
    },
  }
  runInContext(readFileSync(CLIENT, 'utf8'), context, { filename: 'client.js' })
  assert.ok(exports !== null, 'client.js must call window.__ModuleLoader__.load()')
  assert.ok(exports.__internals !== undefined, 'the test flag must expose __internals')
  return exports.__internals
}

const { parseColor, toHex, toHexAlpha, toCss, carriesAlpha, colorKey, ruleId } = loadInternals()

test('parseColor understands every notation the fields accept', () => {
  // 展开成宿主 realm 的普通对象再比：`client.js` 是在 vm 里求值的，原型不同。
  assert.deepEqual({ ...parseColor('#adb2b8') }, { r: 173, g: 178, b: 184, a: 1 })
  assert.deepEqual({ ...parseColor('#f0a') }, { r: 255, g: 0, b: 170, a: 1 })
  assert.deepEqual({ ...parseColor('#22A2B8') }, { r: 34, g: 162, b: 184, a: 1 })
  assert.equal(parseColor('#22a2b880').a, 128 / 255)
  assert.equal(parseColor('#f0a8').a, 136 / 255)
  assert.deepEqual({ ...parseColor('rgb(1, 2, 3)') }, { r: 1, g: 2, b: 3, a: 1 })
  assert.deepEqual({ ...parseColor('rgba(1, 2, 3, 0.4)') }, { r: 1, g: 2, b: 3, a: 0.4 })
  assert.deepEqual({ ...parseColor('transparent') }, { r: 0, g: 0, b: 0, a: 0 })
})

test('parseColor turns a percentage alpha into a fraction, not a clamped 1', () => {
  // 回归：`rgba(0, 0, 0, 40%)` 曾经 parseFloat 出 40 → clamp 到 1，透明度静默消失。
  assert.equal(parseColor('rgba(0, 0, 0, 40%)').a, 0.4)
  assert.equal(parseColor('rgba(0, 0, 0, 100%)').a, 1)
  assert.equal(parseColor('rgb(0 0 0 / 25%)').a, 0.25)
})

test('parseColor returns null for what it cannot read', () => {
  for (const bad of ['', '   ', 'zzz', '#12', '#12345', 'rgb(1, 2)', null, 42, 'var(--x)']) {
    assert.equal(parseColor(bad), null, `${JSON.stringify(bad)} must not parse`)
  }
})

test('toCss keeps the alpha and only collapses to hex when opaque', () => {
  assert.equal(toCss({ r: 173, g: 178, b: 184, a: 1 }), '#adb2b8')
  assert.equal(toCss({ r: 173, g: 178, b: 184, a: 0.999 }), '#adb2b8')
  assert.equal(toCss({ r: 173, g: 178, b: 184, a: 0.4 }), 'rgba(173, 178, 184, 0.4)')
  assert.equal(toCss({ r: 34, g: 162, b: 184, a: 0.502 }), 'rgba(34, 162, 184, 0.502)')
})

test('toHexAlpha is what makes transparency visible in the row', () => {
  assert.equal(toHexAlpha({ r: 173, g: 178, b: 184, a: 1 }), '#adb2b8')
  // 这两个值来自 0.5.3 的浏览器实测，别改。
  assert.equal(toHexAlpha({ r: 173, g: 178, b: 184, a: 0.4 }), '#adb2b866')
  assert.equal(toHexAlpha({ r: 34, g: 162, b: 184, a: 0.502 }), '#22a2b880')
  assert.equal(toHexAlpha({ r: 0, g: 0, b: 0, a: 0.3 }), '#0000004d')
})

test('a hex written with an alpha wins; a plain hex keeps the row opacity', () => {
  // HexField/ColorEditor 的分支判断就是这一句。
  const decide = (raw, current) => (carriesAlpha(raw) ? parseColor(raw).a : current)
  assert.equal(decide('#22a2b880', 1), 128 / 255)
  assert.equal(decide('#22a2b8', 0.4), 0.4)
  assert.equal(decide('#f0a8', 1), 136 / 255)
  assert.equal(decide('rgba(1, 2, 3, 0.25)', 1), 0.25)
  assert.equal(decide('rgb(1, 2, 3)', 0.4), 0.4)
})

test('carriesAlpha only fires on real alpha carriers', () => {
  for (const yes of ['#f0a8', '#22a2b880', 'rgba(1, 2, 3, 0.4)', 'hsla(1, 2%, 3%, 0.4)', 'rgb(1 2 3 / 50%)', 'rgb(1, 2, 3, 50%)']) {
    assert.equal(carriesAlpha(yes), true, `${yes} carries an alpha`)
  }
  for (const no of ['', '#f0a', '#22a2b8', 'rgb(1, 2, 3)', 'transparent', 'zzz']) {
    assert.equal(carriesAlpha(no), false, `${no} does not`)
  }
})

test('colorKey compares notation-independently (the "overridden by rule" hint)', () => {
  assert.equal(colorKey(parseColor('#adb2b866')), colorKey(parseColor('rgba(173, 178, 184, 0.4)')))
  assert.notEqual(colorKey(parseColor('#adb2b8')), colorKey(parseColor('#adb2b866')))
  assert.equal(colorKey(null), '')
})

test('ruleId is one rule per property + selector', () => {
  assert.equal(ruleId('color', 'p.x'), 'color::p.x')
  assert.equal(ruleId('background-color', 'p.x'), 'background-color::p.x')
})
