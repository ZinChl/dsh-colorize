/**
 * dsh-colorize — browser half (v0.2).
 *
 * Three surfaces, one store
 * -------------------------
 * 1. `settings.general.item` — the "自定义色彩" row in 设置 → 常规, with a button
 *    that arms pick mode. This is the mouse-only entry point: it works even when
 *    the OS or an IME swallows the key combination.
 * 2. A keyboard command registered through the official `shortcuts` service
 *    (`colorize.pick`, default primary+shift+K). Because it goes through the
 *    application registry rather than a private listener, it appears in
 *    设置 → 常规 → 快捷键, obeys DSH's region/modal arbitration, and the user can
 *    rebind it there or in this plugin's own settings card.
 * 3. `plugins.bundle.config` — this plugin's page in 插件配置: the shortcut
 *    recorder plus every changed colour, each with a palette swatch.
 *
 * The floating panel in `shell.overlay` is the fourth, transient surface: it
 * appears next to the element you clicked.
 *
 * Pick mode: the overlay outlines whatever is under the pointer; a click selects
 * it. Element edits become one CSS rule each in a package-owned stylesheet; a
 * colour that matches a semantic token can instead be changed at the token layer
 * through `theme.overrideTokens`, which is the non-fragile way to recolour a
 * whole region.
 *
 * Idle cost is one `<style>` tag, one registered command and a zero-size React
 * host — no polling, no MutationObserver and no interval anywhere. Pick mode adds
 * four listeners (three pointer/click plus Escape) and removes them on exit;
 * pointer movement is coalesced to one requestAnimationFrame per frame and the
 * outline is moved by writing a ref'd element's style, not by re-rendering React.
 */

window.__ModuleLoader__.load({
  id: 'dsh-colorize',
  factory(require) {
    'use strict'

    /** Module exports handed back to the shell's module table. */
    const exports = {}

    /**
     * Bumped per module evaluation. A second copy of this file loaded into one page
     * would show up here — the cheapest diagnosis for a double-loaded client bundle,
     * where the mounted component and the console API end up in different stores.
     */
    globalThis.__dshColorizeModules = (globalThis.__dshColorizeModules || 0) + 1

    const React = require('react')
    const h = React.createElement

    const PACKAGE_ID = 'dsh-colorize'
    const NS = 'colorize'
    /** Shown in the panel header so it is obvious which build the page is running. */
    const VERSION = '0.5.4'
    const STORAGE_KEY = 'dsh-colorize:v1'
    const MARK = 'data-dsh-colorize'
    const Z_LAYER = 2147483000
    const COMMAND_ID = 'colorize.pick'
    const TOKEN_RE = /^--dsw-(alias|specific)-/
    const MAX_TOKENS = 96

    /** Editor reservation check: a bare printable key would hijack typing. */
    const MODIFIER_CODES = /^(Control|Alt|Shift|Meta)(Left|Right)$/

    /** Same default on every shell/OS pair this build admits; verified unbound. */
    const DEFAULT_BINDING = { code: 'KeyK', modifiers: ['primary', 'shift'] }
    /**
     * `web:linux` is deliberately omitted: `register()` validates every declared
     * default atomically and throws on one bad row, and the browser allowance for
     * Linux admits only primary+Slash, primary+shift+Comma and primary+shift+Period
     * — all three already taken by shipped commands. Leaving that profile unbound
     * keeps the command registered everywhere else; the user can still bind it
     * there from the shortcut editor, which reports the allowed set itself.
     */
    const PROFILES = [
      'desktop:macos',
      'desktop:windows',
      'desktop:linux',
      'web:macos',
      'web:windows',
    ]

    /* --------------------------------------------------------------- copy */

    const DICT_ZH = {
      entryLabel: '界面调色师',
      title: '界面调色',
      pickOn: '拾色模式：移动鼠标选中元素，单击确认，Esc 取消',
      repick: '重新拾取',
      close: '关闭',
      target: '目标',
      matches: '匹配 {n} 个',
      tokenHit: '该元素用的是语义色 {token}',
      tokenSection: '语义色（全局生效）',
      colorsOnTarget: '可调颜色',
      background: '背景',
      text: '文字',
      border: '边框',
      fill: '填充',
      stroke: '描边',
      alpha: '不透明度',
      pickCustom: '选色',
      confirm: '应用',
      cancel: '取消',
      done: '完成',
      withImage: '含背景图',
      transparentRow: '当前透明',
      childPaint: '子元素',
      ancestorPaint: '祖先',
      overriddenByRule: '已被更高优先级的样式覆盖（颜色写进去了但看不到）',
      scopeSelf: '仅此元素',
      scopeGroup: '同类',
      scopeDescendants: '含后代',
      modePalette: '调色盘',
      modeMixer: '混合器',
      paletteHint: '系统取色器（含屏幕吸管）：选完点「应用」确认',
      reset: '重置',
      noColors: '这个元素没有可调的颜色属性',
      noTarget: '没有选中元素',
      undo: '撤销',
      clearAll: '全部清除',
      data: '导出 / 导入',
      apply: '应用',
      badJson: 'JSON 解析失败',
      crash: '面板渲染失败：{message}',

      rowLabel: '自定义色彩',
      rowDesc: '点选界面上的任意元素，就地修改它的颜色',
      settingsTitle: '调色设置',
      settingsDesc: '改过的颜色都存在浏览器里；下面可以逐条改色或删除。',
      hotkeySection: '快捷键',
      hotkeyChange: '修改',
      hotkeyReset: '恢复默认',
      hotkeyRecording: '按下组合键…',
      hotkeyUnbound: '未绑定',
      hotkeyNeedModifier: '至少按一个修饰键（Ctrl / Alt / Shift / Cmd）',
      hotkeyConflict: '这个组合已被「{command}」占用',
      hotkeySaved: '已保存',
      hotkeyFailed: '保存失败：{status}',
      hotkeyNotReady: '快捷键配置还没读完，重开这个页面再试',
      hotkeyCaption: '也可以在「设置 → 常规 → 快捷键」里修改',
      issueReserved: '这个组合被系统或编辑器占用',
      issueUnsupportedBrowser: '浏览器不接受这个组合',
      issueModifierRequired: '系统要求带修饰键',
      issueUnsupportedKey: '这个按键不支持',
      colorsSection: '已改的颜色',
      colorsEmpty: '还没有改过任何颜色。点「开始拾色」后选择界面元素即可。',
      tokensSection: '语义色覆盖',
      tokensEmpty: '没有覆盖任何语义色',
      startPick: '开始拾色',
      stopPick: '退出拾色',
      light: '明',
      dark: '暗',
    }

    const DICT_EN = {
      entryLabel: 'UI Colorizer',
      title: 'Recolor UI',
      pickOn: 'Pick mode: move to highlight, click to select, Esc to cancel',
      repick: 'Pick again',
      close: 'Close',
      target: 'Target',
      matches: '{n} match(es)',
      tokenHit: 'This element uses semantic color {token}',
      tokenSection: 'Semantic color (global)',
      colorsOnTarget: 'Editable colors',
      background: 'Background',
      text: 'Text',
      border: 'Border',
      fill: 'Fill',
      stroke: 'Stroke',
      alpha: 'Opacity',
      pickCustom: 'Pick color',
      confirm: 'Apply',
      cancel: 'Cancel',
      done: 'Done',
      withImage: 'has image',
      transparentRow: 'currently transparent',
      childPaint: 'child',
      ancestorPaint: 'ancestor',
      overriddenByRule: 'A higher-priority rule wins (the value is written but invisible)',
      scopeSelf: 'This element',
      scopeGroup: 'Same class',
      scopeDescendants: 'With descendants',
      modePalette: 'Palette',
      modeMixer: 'Mixer',
      paletteHint: 'System picker (with eyedropper): press Apply when done',
      reset: 'Reset',
      noColors: 'This element has no color property to edit',
      noTarget: 'No element selected',
      undo: 'Undo',
      clearAll: 'Clear all',
      data: 'Export / import',
      apply: 'Apply',
      badJson: 'Could not parse JSON',
      crash: 'Panel failed to render: {message}',

      rowLabel: 'Custom colors',
      rowDesc: 'Click any element in the interface and recolor it in place',
      settingsTitle: 'Recolor settings',
      settingsDesc: 'Every change lives in this browser; edit or delete them below.',
      hotkeySection: 'Shortcut',
      hotkeyChange: 'Change',
      hotkeyReset: 'Restore default',
      hotkeyRecording: 'Press a combination…',
      hotkeyUnbound: 'Not bound',
      hotkeyNeedModifier: 'Hold at least one modifier (Ctrl / Alt / Shift / Cmd)',
      hotkeyConflict: 'Already used by “{command}”',
      hotkeySaved: 'Saved',
      hotkeyFailed: 'Could not save: {status}',
      hotkeyNotReady: 'Shortcut settings are still loading; reopen this page',
      hotkeyCaption: 'Also editable in Settings → General → Shortcuts',
      issueReserved: 'Reserved by the system or the editor',
      issueUnsupportedBrowser: 'The browser refuses this combination',
      issueModifierRequired: 'This platform requires a modifier',
      issueUnsupportedKey: 'That key is not supported',
      colorsSection: 'Changed colors',
      colorsEmpty: 'Nothing changed yet. Press “Start picking”, then click an element.',
      tokensSection: 'Semantic overrides',
      tokensEmpty: 'No semantic color overridden',
      startPick: 'Start picking',
      stopPick: 'Stop picking',
      light: 'Light',
      dark: 'Dark',
    }

    /* -------------------------------------------------------------- colors */

    /** Parse `#rgb`, `#rrggbb`, `rgb()`, `rgba()` or `transparent`. */
    function parseColor(input) {
      if (typeof input !== 'string') return null
      const text = input.trim().toLowerCase()
      if (text === '') return null
      if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
      if (text.charAt(0) === '#') {
        const body = text.slice(1)
        const expand = (ch) => parseInt(ch + ch, 16)
        const pair = (i) => parseInt(body.slice(i, i + 2), 16)
        if (body.length === 3 || body.length === 4) {
          const r = expand(body[0])
          const g = expand(body[1])
          const b = expand(body[2])
          const a = body.length === 4 ? expand(body[3]) / 255 : 1
          if ([r, g, b].some((v) => !Number.isFinite(v))) return null
          return { r, g, b, a }
        }
        if (body.length === 6 || body.length === 8) {
          const r = pair(0)
          const g = pair(2)
          const b = pair(4)
          const a = body.length === 8 ? pair(6) / 255 : 1
          if ([r, g, b].some((v) => !Number.isFinite(v))) return null
          return { r, g, b, a }
        }
        return null
      }
      const match = text.match(/^rgba?\(([^)]+)\)$/)
      if (match === null) return null
      const parts = match[1].split(/[\s,/]+/).filter((part) => part !== '')
      if (parts.length < 3) return null
      const channel = (raw) => {
        const value = parseFloat(raw)
        if (!Number.isFinite(value)) return 0
        return Math.max(0, Math.min(255, Math.round(value)))
      }
      let alpha = 1
      if (parts.length > 3) {
        const raw = parts[3]
        const value = parseFloat(raw)
        // `rgba(0, 0, 0, 40%)` and the `rgb(0 0 0 / 40%)` slash form both carry a
        // percentage; without this the raw 40 was clamped to 1 and the transparency
        // silently vanished.
        const fraction = /%\s*$/.test(raw) ? value / 100 : value
        alpha = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 1
      }
      return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha }
    }

    function hexByte(value) {
      return ('0' + Math.max(0, Math.min(255, Math.round(value))).toString(16)).slice(-2)
    }

    function toHex(color) {
      return '#' + hexByte(color.r) + hexByte(color.g) + hexByte(color.b)
    }

    function toCss(color) {
      if (!color) return 'transparent'
      if (color.a >= 0.999) return toHex(color)
      const alpha = Math.round(color.a * 1000) / 1000
      return 'rgba(' + color.r + ', ' + color.g + ', ' + color.b + ', ' + alpha + ')'
    }

    /**
     * `#rrggbb`, plus the alpha byte when the colour is translucent.
     *
     * Every inline hex field shows this instead of plain `toHex`: a 40 % colour used to
     * read `#74fafb` next to `40%`, which looked exactly like "the transparency was
     * thrown away" even though the rule carried `rgba(..., 0.4)`.
     */
    function toHexAlpha(color) {
      const base = toHex(color)
      if (!color || !Number.isFinite(color.a) || color.a >= 0.999) return base
      return base + hexByte(color.a * 255)
    }

    /**
     * Does this text carry its own alpha? `#rgba` / `#rrggbbaa`, `rgba()` / `hsla()` with a
     * fourth component, or the slash form `rgb(... / a)`.
     *
     * The hex fields use it to decide whether the alpha the user typed wins over the one
     * the row already had. Without it, typing `#74fafb66` silently produced an opaque
     * colour, and a colour the OS picker returned with alpha was flattened the same way.
     */
    function carriesAlpha(text) {
      const value = String(text === undefined || text === null ? '' : text).trim().toLowerCase()
      if (value === '') return false
      if (value.charAt(0) === '#') return /^#[0-9a-f]{4}$/.test(value) || /^#[0-9a-f]{8}$/.test(value)
      const open = value.indexOf('(')
      if (open < 0) return false
      const body = value.slice(open + 1, value.lastIndexOf(')'))
      if (body.indexOf('/') >= 0) return true
      return body.split(/[\s,]+/).filter((part) => part !== '').length > 3
    }

    /**
     * The alpha a hex edit should end up with.
     *
     * * the input carries its own alpha (`#rrggbbaa`, `rgba(...)`) → that one wins;
     * * otherwise the row's current opacity is kept…
     * * …**unless it is 0**. 0 % is not a colour, it is an empty slot: a transparent element
     *   (背景行「当前透明」、没被覆盖的 token) starts at `rgba(0, 0, 0, 0)`, and keeping that 0
     *   means the colour the user just typed renders as nothing at all — which reads as
     *   "the background still cannot be changed". A colour typed into an empty slot starts
     *   opaque; the opacity field is right there to dial it back down.
     */
    function alphaForEdit(parsed, current, raw) {
      if (carriesAlpha(raw)) return parsed.a
      if (Number.isFinite(current) && current > 0) return current
      return parsed.a
    }

    /** A fully transparent colour is an empty slot, not a chosen transparency. */
    function opaqueIfEmpty(color) {
      if (color === null || color === undefined) return color
      return color.a === 0 ? Object.assign({}, color, { a: 1 }) : color
    }

    /** Identity used to compare two computed colors regardless of notation. */
    function colorKey(color) {
      if (!color) return ''
      return color.r + ',' + color.g + ',' + color.b + ',' + Math.round(color.a * 100)
    }

    const SIDES = ['top', 'right', 'bottom', 'left']

    function cap(text) {
      return text.charAt(0).toUpperCase() + text.slice(1)
    }

    /* ------------------------------------------------------------ selectors */

    function escIdent(value) {
      try {
        if (typeof CSS !== 'undefined' && CSS !== null && typeof CSS.escape === 'function') {
          return CSS.escape(String(value))
        }
      } catch (error) {
        /* fall through to the manual escape */
      }
      return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\' + ch)
    }

    function escAttr(value) {
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    }

    function isUnique(selector) {
      try {
        return document.querySelectorAll(selector).length === 1
      } catch (error) {
        return false
      }
    }

    function classesOf(el) {
      const raw = typeof el.className === 'string' ? el.className : ''
      return raw
        .split(/\s+/)
        .filter((name) => name !== '' && name.length <= 40)
        .slice(0, 3)
    }

    /** Attributes that usually survive a React re-render. */
    function anchorsOf(el) {
      const out = []
      const fixed = ['data-testid', 'data-test-id', 'data-slot', 'data-part', 'data-state', 'aria-label', 'name', 'role']
      for (const name of fixed) {
        const value = typeof el.getAttribute === 'function' ? el.getAttribute(name) : null
        if (typeof value === 'string' && value !== '' && value.length <= 60) out.push([name, value])
      }
      if (el.attributes) {
        for (const attr of Array.prototype.slice.call(el.attributes)) {
          if (attr.name.slice(0, 5) !== 'data-') continue
          if (fixed.indexOf(attr.name) !== -1) continue
          if (typeof attr.value === 'string' && attr.value !== '' && attr.value.length <= 60) {
            out.push([attr.name, attr.value])
          }
        }
      }
      return out
    }

    /**
     * Build the shortest selector that uniquely identifies `el`.
     *
     * Order of preference: a unique id, a unique stable attribute on the element
     * itself, then the shortest unique ancestor path (tag + at most three classes,
     * `:nth-of-type` only where siblings collide). Never trusts the first guess:
     * every candidate is verified against `querySelectorAll`.
     */
    function buildSelector(el) {
      if (!el || el.nodeType !== 1) return ''
      const tag = String(el.tagName || '').toLowerCase()
      if (tag === '' || tag === 'html' || tag === 'body') return tag
      if (typeof el.id === 'string' && el.id !== '') {
        const byId = '#' + escIdent(el.id)
        if (isUnique(byId)) return byId
      }
      for (const anchor of anchorsOf(el)) {
        const attr = '[' + anchor[0] + '="' + escAttr(anchor[1]) + '"]'
        if (isUnique(attr)) return attr
        if (isUnique(tag + attr)) return tag + attr
      }
      const parts = []
      let node = el
      let guard = 0
      while (node && node.nodeType === 1 && guard < 8) {
        guard += 1
        const nodeTag = String(node.tagName || '').toLowerCase()
        if (nodeTag === 'html' || nodeTag === 'body') break
        let part = nodeTag
        const classes = classesOf(node)
        if (classes.length > 0) part += '.' + classes.map(escIdent).join('.')
        const parent = node.parentElement
        if (parent) {
          const siblings = Array.prototype.filter.call(
            parent.children,
            (child) => child.tagName === node.tagName,
          )
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')'
        }
        parts.unshift(part)
        const candidate = parts.join(' > ')
        if (isUnique(candidate)) return candidate
        node = parent
      }
      return parts.join(' > ')
    }

    function describe(el) {
      if (!el || !el.tagName) return '?'
      const tag = String(el.tagName).toLowerCase()
      const classes = classesOf(el)
      return tag + (classes.length > 0 ? '.' + classes.join('.') : '')
    }

    /* --------------------------------------------------------------- store */

    const store = {
      rules: [],
      tokens: {},
      picking: false,
      selected: null,
      /** @type {Set<Function>} */
      listeners: new Set(),
      snapshot: null,
    }

    function snapshot() {
      return {
        rules: store.rules,
        tokens: store.tokens,
        picking: store.picking,
        selected: store.selected,
      }
    }

    function current() {
      if (store.snapshot === null) store.snapshot = snapshot()
      return store.snapshot
    }

    function emit() {
      store.snapshot = snapshot()
      const value = store.snapshot
      // Array.from, not Array.prototype.slice: `slice` reads `this.length`, and a Set
      // has `size`, so the slice form silently yields [] and no subscriber ever runs.
      for (const listener of Array.from(store.listeners)) {
        try {
          listener(value)
        } catch (error) {
          console.error('[dsh-colorize] listener failed', error)
        }
      }
    }

    function subscribe(listener) {
      store.listeners.add(listener)
      return () => {
        store.listeners.delete(listener)
      }
    }

    /* -------------------------------------------------------- persistence */

    let saveTimer = 0

    function persist() {
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: 1, rules: store.rules, tokens: store.tokens }),
        )
      } catch (error) {
        console.warn('[dsh-colorize] could not persist settings', error)
      }
    }

    function persistSoon(delay) {
      if (saveTimer !== 0) return
      saveTimer = window.setTimeout(() => {
        saveTimer = 0
        persist()
      }, delay === undefined ? 250 : delay)
    }

    function restore() {
      let raw = null
      try {
        raw = window.localStorage.getItem(STORAGE_KEY)
      } catch (error) {
        return
      }
      if (raw === null || raw === '') return
      let data = null
      try {
        data = JSON.parse(raw)
      } catch (error) {
        console.warn('[dsh-colorize] stored settings are not JSON, ignoring')
        return
      }
      if (!data || typeof data !== 'object') return
      if (Array.isArray(data.rules)) {
        store.rules = data.rules
          .filter((rule) => {
            return (
              rule &&
              typeof rule.selector === 'string' &&
              rule.selector !== '' &&
              typeof rule.prop === 'string' &&
              rule.prop !== '' &&
              typeof rule.value === 'string' &&
              rule.value !== ''
            )
          })
          .map((rule) => {
            const restored = {
              id: ruleId(rule.prop, rule.selector),
              selector: rule.selector,
              prop: rule.prop,
              value: rule.value,
              label: typeof rule.label === 'string' ? rule.label : rule.selector,
            }
            if (typeof rule.extra === 'string' && rule.extra !== '') restored.extra = rule.extra
            return restored
          })
      }
      if (data.tokens && typeof data.tokens === 'object') {
        const tokens = {}
        for (const name of Object.keys(data.tokens)) {
          if (!TOKEN_RE.test(name)) continue
          const modes = data.tokens[name]
          if (!modes || typeof modes !== 'object') continue
          if (typeof modes.light !== 'string' || typeof modes.dark !== 'string') continue
          tokens[name] = { light: modes.light, dark: modes.dark }
        }
        store.tokens = tokens
      }
    }

    /* ---------------------------------------------------- the rule engine */

    let styleTag = null

    function ruleId(prop, selector) {
      return prop + '::' + selector
    }

    function applyRules() {
      if (styleTag === null) return
      const body = store.rules
        .map((rule) => rule.selector + ' { ' + rule.prop + ': ' + rule.value + ' !important;' +
          (typeof rule.extra === 'string' && rule.extra !== '' ? ' ' + rule.extra : '') + ' }')
        .join('\n')
      styleTag.textContent =
        '/* dsh-colorize — element overrides. Removing this tag removes every edit. */\n' + body + '\n'
    }

    /** `extra` is a raw declaration list appended to the same rule (e.g. background-image: none). */
    function upsertRule(selector, prop, value, label, extra) {
      if (typeof selector !== 'string' || selector === '') return
      const id = ruleId(prop, selector)
      const tail = typeof extra === 'string' && extra !== '' ? extra : ''
      let found = null
      for (const rule of store.rules) {
        if (rule.id === id) {
          found = rule
          break
        }
      }
      if (found === null) {
        const rule = { id, selector, prop, value, label: label || selector }
        if (tail !== '') rule.extra = tail
        store.rules = store.rules.concat([rule])
      } else {
        found.value = value
        if (tail !== '') found.extra = tail
        else delete found.extra
        if (label) found.label = label
      }
      applyRules()
      persistSoon()
      emit()
    }

    /** Rewrite one rule's colour by id — what the settings card edits. */
    function setRuleValue(id, value, extra) {
      for (const rule of store.rules) {
        if (rule.id !== id) continue
        rule.value = value
        if (typeof extra === 'string' && extra !== '') rule.extra = extra
        applyRules()
        persistSoon()
        emit()
        return
      }
    }

    function removeRule(id) {
      const next = store.rules.filter((rule) => rule.id !== id)
      if (next.length === store.rules.length) return
      store.rules = next
      applyRules()
      persistSoon()
      emit()
    }

    function clearRules() {
      if (store.rules.length === 0) return
      store.rules = []
      applyRules()
      persistSoon()
      emit()
    }

    function undoRule() {
      if (store.rules.length === 0) return
      store.rules = store.rules.slice(0, store.rules.length - 1)
      applyRules()
      persistSoon()
      emit()
    }

    function ruleFor(prop, selector) {
      const id = ruleId(prop, selector)
      for (const rule of store.rules) {
        if (rule.id === id) return rule
      }
      return null
    }

    /* ------------------------------------------------------ token overrides */

    let theme = null
    let probe = null
    let probeHost = null

    function tokenLayer() {
      const out = {}
      for (const name of Object.keys(store.tokens)) {
        const modes = store.tokens[name]
        out[name] = { light: modes.light, dark: modes.dark }
      }
      return out
    }

    function applyTokens() {
      if (theme === null || typeof theme.overrideTokens !== 'function') return
      try {
        theme.overrideTokens(PACKAGE_ID, tokenLayer())
      } catch (error) {
        console.error('[dsh-colorize] theme.overrideTokens rejected the layer', error)
      }
    }

    function themeSnapshot() {
      if (theme === null || typeof theme.getTheme !== 'function') return null
      try {
        return theme.getTheme()
      } catch (error) {
        return null
      }
    }

    /** The order that matters most when the scan is cut short by MAX_TOKENS. */
    const TOKEN_PRIORITY = [
      'bg-base',
      'bg-layer-1',
      'bg-layer-2',
      'bg-overlay',
      'brand-primary',
      'label-primary',
      'label-secondary',
      'border-l1',
      'border-l2',
    ]

    /** Documented alias tokens, used only if enumeration finds nothing. */
    const FALLBACK_TOKENS = [
      '--dsw-alias-bg-base',
      '--dsw-alias-bg-layer-1',
      '--dsw-alias-bg-layer-2',
      '--dsw-alias-bg-overlay',
      '--dsw-alias-border-l1',
      '--dsw-alias-border-l2',
      '--dsw-alias-brand-primary',
      '--dsw-alias-label-primary',
      '--dsw-alias-label-secondary',
      '--dsw-alias-state-error-primary',
      '--dsw-alias-state-idle-primary',
      '--dsw-alias-state-success-primary',
      '--dsw-alias-state-warn-primary',
    ]

    function tokenRank(name) {
      for (let index = 0; index < TOKEN_PRIORITY.length; index += 1) {
        if (name.indexOf(TOKEN_PRIORITY[index]) !== -1) return index
      }
      return TOKEN_PRIORITY.length
    }

    /**
     * Every alias token the page currently defines, most useful first.
     *
     * The palettes live in the base stylesheets rather than in the built-in theme
     * definitions, so enumerating the live custom properties on `:root` is what
     * actually finds them; a third-party theme that registers its own token map is
     * unioned in on top.
     */
    function tokenNames() {
      const names = []
      const seen = {}
      try {
        const cs = window.getComputedStyle(document.documentElement)
        const total = typeof cs.length === 'number' ? cs.length : 0
        for (let index = 0; index < total; index += 1) {
          const name = cs.item(index)
          if (typeof name !== 'string' || TOKEN_RE.test(name) !== true) continue
          if (seen[name] === true) continue
          seen[name] = true
          names.push(name)
        }
      } catch (error) {
        /* fall through to the theme map and the documented list */
      }
      const snap = themeSnapshot()
      const active = snap && snap.active
      if (active && active.tokens) {
        for (const name of Object.keys(active.tokens)) {
          if (TOKEN_RE.test(name) !== true || seen[name] === true) continue
          seen[name] = true
          names.push(name)
        }
      }
      if (names.length === 0) {
        for (const name of FALLBACK_TOKENS) {
          if (seen[name] === true) continue
          seen[name] = true
          names.push(name)
        }
      }
      names.sort((a, b) => tokenRank(a) - tokenRank(b))
      return names.slice(0, MAX_TOKENS)
    }

    /**
     * Find which semantic tokens resolve to the colors an element actually uses.
     *
     * A probe inside our own container is set to `var(--token)` and read back, so
     * `oklch()`, `light-dark()` and `color-mix()` all come out as the same `rgb()`
     * the element itself computes — which is what makes the comparison meaningful.
     *
     * Both properties are set before either is read, so one style recalculation
     * serves both comparisons; the loop stops as soon as both are matched. This
     * runs once per pick, never on a timer.
     */
    function matchTokens(background, foreground) {
      const found = {}
      if (probeHost === null || !probeHost.isConnected) return found
      let wantBackground = background !== null
      let wantForeground = foreground !== null
      if (!wantBackground && !wantForeground) return found
      const backgroundKey = wantBackground ? colorKey(background) : ''
      const foregroundKey = wantForeground ? colorKey(foreground) : ''
      if (probe === null) {
        probe = document.createElement('div')
        probe.setAttribute(MARK, 'probe')
        probe.style.cssText =
          'position:absolute;left:-100000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
      }
      if (probe.parentNode !== probeHost) probeHost.appendChild(probe)
      // Baseline first: a name that is not a valid color for the property leaves the
      // probe at its inherited value, which must never be reported as a match.
      probe.style.removeProperty('background-color')
      probe.style.removeProperty('color')
      let baselineBackground = ''
      let baselineForeground = ''
      try {
        const base = window.getComputedStyle(probe)
        baselineBackground = colorKey(parseColor(base.backgroundColor))
        baselineForeground = colorKey(parseColor(base.color))
      } catch (error) {
        baselineBackground = ''
        baselineForeground = ''
      }
      const names = tokenNames()
      for (let index = 0; index < names.length; index += 1) {
        if (!wantBackground && !wantForeground) break
        const name = names[index]
        probe.style.setProperty('background-color', 'var(' + name + ')')
        probe.style.setProperty('color', 'var(' + name + ')')
        let computed = null
        try {
          computed = window.getComputedStyle(probe)
        } catch (error) {
          computed = null
        }
        if (computed !== null) {
          if (wantBackground && backgroundKey !== baselineBackground &&
            colorKey(parseColor(computed.backgroundColor)) === backgroundKey) {
            found['background-color'] = name
            wantBackground = false
          }
          if (wantForeground && foregroundKey !== baselineForeground &&
            colorKey(parseColor(computed.color)) === foregroundKey) {
            found.color = name
            wantForeground = false
          }
        }
        probe.style.removeProperty('background-color')
        probe.style.removeProperty('color')
      }
      return found
    }

    /** The original value each registered theme carries for a token. */
    function originalTokenModes(token) {
      const out = {}
      const snap = themeSnapshot()
      const themes = snap && Array.isArray(snap.themes) ? snap.themes : []
      for (const definition of themes) {
        if (definition && definition.tokens && typeof definition.tokens[token] === 'string') {
          out[definition.colorScheme] = definition.tokens[token]
        }
      }
      return out
    }

    function activeScheme() {
      const snap = themeSnapshot()
      const preference = snap && typeof snap.preference === 'string' ? snap.preference : 'system'
      if (preference === 'light' || preference === 'dark') return preference
      try {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
      } catch (error) {
        /* treat as light */
      }
      return 'light'
    }

    function setTokenColor(token, value, both) {
      const existing = store.tokens[token] || {}
      const original = originalTokenModes(token)
      const next = {
        light: typeof existing.light === 'string' ? existing.light : original.light || value,
        dark: typeof existing.dark === 'string' ? existing.dark : original.dark || value,
      }
      if (both === true) {
        next.light = value
        next.dark = value
      } else if (activeScheme() === 'dark') {
        next.dark = value
      } else {
        next.light = value
      }
      store.tokens[token] = next
      applyTokens()
      persistSoon(400)
      emit()
    }

    /** Write exactly one mode of a token override — the settings card does this. */
    function setTokenMode(token, mode, value) {
      const existing = store.tokens[token] || {}
      const original = originalTokenModes(token)
      const next = {
        light: typeof existing.light === 'string' ? existing.light : original.light || value,
        dark: typeof existing.dark === 'string' ? existing.dark : original.dark || value,
      }
      if (mode === 'dark') next.dark = value
      else next.light = value
      store.tokens[token] = next
      applyTokens()
      persistSoon(400)
      emit()
    }

    function removeToken(token) {
      if (!Object.prototype.hasOwnProperty.call(store.tokens, token)) return
      delete store.tokens[token]
      applyTokens()
      persistSoon(400)
      emit()
    }

    /** Put a token override back exactly as the editor found it (or drop it). */
    function restoreToken(token, modes) {
      if (modes === null || modes === undefined) {
        removeToken(token)
        return
      }
      store.tokens[token] = { light: modes.light, dark: modes.dark }
      applyTokens()
      persistSoon(400)
      emit()
    }

    function clearTokens() {
      if (Object.keys(store.tokens).length === 0) return
      store.tokens = {}
      applyTokens()
      persistSoon(400)
      emit()
    }

    /* ------------------------------------------------------------ inspection */

    const PROP_KIND = {
      'background-color': 'background',
      color: 'text',
      'border-color': 'border',
      fill: 'fill',
      stroke: 'stroke',
    }

    function kindOf(prop) {
      if (PROP_KIND[prop]) return PROP_KIND[prop]
      if (prop.indexOf('border-') === 0) return 'border'
      return 'text'
    }

    /**
     * Colour properties of one style target (an element or one of its pseudo-elements).
     *
     * A background-image paints over the background colour, which is the single most
     * common reason "the background colour does not apply" even though the declaration
     * is there — so the entry records it and the rule writes `background-image: none`.
     */
    function collectColorProps(cs, target) {
      const props = []
      const image = typeof cs.backgroundImage === 'string' && cs.backgroundImage !== 'none'
      const background = parseColor(cs.backgroundColor)
      if ((background !== null && background.a > 0) || image) {
        props.push({
          prop: 'background-color',
          value: background !== null && background.a > 0 ? cs.backgroundColor : 'rgba(0, 0, 0, 0)',
          target,
          clearImage: image,
        })
      }
      const foreground = parseColor(cs.color)
      if (foreground !== null && foreground.a > 0) props.push({ prop: 'color', value: cs.color, target })

      const widths = SIDES.map((side) => parseFloat(cs['border' + cap(side) + 'Width']) || 0)
      const colors = SIDES.map((side) => cs['border' + cap(side) + 'Color'])
      const live = SIDES.map((side, index) => widths[index] > 0 && (parseColor(colors[index]) || { a: 0 }).a > 0)
      const liveCount = live.filter(Boolean).length
      if (liveCount === 4 && colors.every((value) => value === colors[0])) {
        props.push({ prop: 'border-color', value: colors[0], target })
      } else {
        for (let index = 0; index < SIDES.length; index += 1) {
          if (live[index]) props.push({ prop: 'border-' + SIDES[index] + '-color', value: colors[index], target })
        }
      }
      return props
    }

    /** The nearest ancestor that actually paints a background. */
    function ancestorBackground(el, baseSelector) {
      let node = el.parentElement
      let guard = 0
      // 12 层：DSH 的会话视图 + 插件包装夹出来常常是 8～10 层，6 层会够不到画背景的那一层
      // （够不到时面板就没有「背景 · 祖先」行，用户只能看到本元素那一行）。
      while (node && node.nodeType === 1 && guard < 12) {
        guard += 1
        if (String(node.tagName || '').toLowerCase() === 'html') break
        const cs = window.getComputedStyle(node)
        const image = typeof cs.backgroundImage === 'string' && cs.backgroundImage !== 'none'
        const background = parseColor(cs.backgroundColor)
        const visible = (background !== null && background.a > 0) || image
        if (visible) {
          const selector = buildSelector(node)
          if (selector !== '' && selector !== baseSelector) {
            return {
              selector,
              label: describe(node),
              value: background !== null && background.a > 0 ? cs.backgroundColor : 'rgba(0, 0, 0, 0)',
              clearImage: image,
            }
          }
        }
        node = node.parentElement
      }
      return null
    }

    /**
     * The direct child that owns the visible fill of a container.
     *
     * Scroll areas and cards often have a transparent box while one full-size child paints
     * the background — changing the container's own background then changes nothing.
     */
    function coveringChildBackground(el, baseSelector) {
      const box = el.getBoundingClientRect()
      const area = box.width * box.height
      if (area < 200) return null
      const limit = Math.min(el.children.length, 20)
      for (let index = 0; index < limit; index += 1) {
        const child = el.children[index]
        if (!child || child.nodeType !== 1) continue
        const cs = window.getComputedStyle(child)
        const image = typeof cs.backgroundImage === 'string' && cs.backgroundImage !== 'none'
        const background = parseColor(cs.backgroundColor)
        const visible = (background !== null && background.a > 0) || image
        if (visible !== true) continue
        const rect = child.getBoundingClientRect()
        if ((rect.width * rect.height) / area < 0.85) continue
        const selector = buildSelector(child)
        if (selector === '' || selector === baseSelector) continue
        return {
          selector,
          label: describe(child),
          value: background !== null && background.a > 0 ? cs.backgroundColor : 'rgba(0, 0, 0, 0)',
          clearImage: image,
        }
      }
      return null
    }

    function inspectElement(el) {
      const base = buildSelector(el)
      const cs = window.getComputedStyle(el)
      const self = { selector: base, label: null, scope: 'self' }
      const props = collectColorProps(cs, self)

      const tag = String(el.tagName || '').toLowerCase()
      const svgTags = ['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'use', 'ellipse']
      if (svgTags.indexOf(tag) !== -1) {
        const fill = parseColor(cs.fill)
        if (fill !== null && fill.a > 0) props.push({ prop: 'fill', value: cs.fill, target: self })
        const stroke = parseColor(cs.stroke)
        if (stroke !== null && stroke.a > 0 && (parseFloat(cs.strokeWidth) || 0) > 0) {
          props.push({ prop: 'stroke', value: cs.stroke, target: self })
        }
      }

      // Glass headers and cards paint their fill with a pseudo-element, and many elements
      // are transparent while an ancestor owns the visible band. Offer both as own rows.
      for (const pseudo of ['::before', '::after']) {
        let pseudoStyle = null
        try {
          pseudoStyle = window.getComputedStyle(el, pseudo)
        } catch (error) {
          pseudoStyle = null
        }
        if (pseudoStyle === null) continue
        const content = pseudoStyle.content
        if (typeof content === 'string' && (content === 'none' || content === 'normal')) continue
        for (const entry of collectColorProps(pseudoStyle, { selector: base + pseudo, label: pseudo, scope: 'pseudo' })) {
          if (entry.prop === 'background-color') props.push(entry)
        }
      }
      const selfHasBackground = props.some((entry) => entry.prop === 'background-color')
      const child = coveringChildBackground(el, base)
      const ancestor = child !== null || selfHasBackground === true ? null : ancestorBackground(el, base)
      if (ancestor !== null) {
        props.unshift({
          prop: 'background-color',
          value: ancestor.value,
          target: { selector: ancestor.selector, label: ancestor.label, scope: 'ancestor' },
          clearImage: ancestor.clearImage,
        })
      }
      /**
       * Element 自己透明时**也要给一行背景**。
       *
       * 曾经只在「发现某个祖先/子元素在画背景」时才给背景行，于是在层级更深的 DOM 里
       * （祖先超出探测范围、又没有铺满的直接子元素）面板会**一行背景都没有** —— 用户想改
       * 背景却无从下手，只能反复反馈「背景还是改不了」。面板是唯一入口，不能靠猜。
       *
       * 透明元素自己上背景色是可见的（画在祖先之上），所以这一行不是摆设。
       */
      if (selfHasBackground !== true) {
        props.splice(ancestor === null ? 0 : 1, 0, {
          prop: 'background-color',
          value: typeof cs.backgroundColor === 'string' && cs.backgroundColor !== '' ? cs.backgroundColor : 'rgba(0, 0, 0, 0)',
          target: self,
          transparentSelf: true,
        })
      }
      if (child !== null) {
        props.push({
          prop: 'background-color',
          value: child.value,
          target: { selector: child.selector, label: child.label, scope: 'child' },
          clearImage: child.clearImage,
        })
      }

      let background = null
      let foreground = null
      for (const entry of props) {
        if (entry.prop === 'background-color' && background === null) background = parseColor(entry.value)
        else if (entry.prop === 'color' && foreground === null) foreground = parseColor(entry.value)
      }
      if (background !== null && background.a === 0) background = null
      if (foreground !== null && foreground.a === 0) foreground = null
      return { props, tokenMatch: matchTokens(background, foreground) }
    }

    function selectElement(el) {
      const selector = buildSelector(el)
      const info = inspectElement(el)
      let matches = 0
      try {
        matches = selector === '' ? 0 : document.querySelectorAll(selector).length
      } catch (error) {
        matches = 0
      }
      store.selected = {
        el,
        selector,
        label: describe(el),
        props: info.props,
        tokenMatch: info.tokenMatch,
        matches,
      }
      store.picking = false
      emit()
    }

    function clearSelection() {
      store.selected = null
      store.picking = false
      emit()
    }

    function setPicking(value) {
      store.picking = value === true
      if (store.picking) store.selected = null
      emit()
    }

    /* ------------------------------------------------------------ shortcuts */

    let shortcuts = null

    /** Catalog rows + config revision for our one command, or null. */
    function shortcutState() {
      if (shortcuts === null) return null
      const rows = shortcuts.catalog && typeof shortcuts.catalog.getSnapshot === 'function'
        ? shortcuts.catalog.getSnapshot()
        : null
      const config = shortcuts.config && typeof shortcuts.config.getSnapshot === 'function'
        ? shortcuts.config.getSnapshot()
        : null
      const row = Array.isArray(rows) ? rows.find((entry) => entry.id === COMMAND_ID) || null : null
      return {
        rows: Array.isArray(rows) ? rows : [],
        row,
        keys: row && Array.isArray(row.keys) ? row.keys : [],
        modified: row ? row.modified === true : false,
        issue: row ? row.issue : null,
        conflicts: row && Array.isArray(row.conflicts) ? row.conflicts : [],
        revision: config ? config.revision : null,
        status: config ? config.status : 'loading',
      }
    }

    function labelOfCommand(id, state) {
      if (state && Array.isArray(state.rows)) {
        for (const entry of state.rows) {
          if (entry.id === id) return entry.label || id
        }
      }
      return id
    }

    function issueText(key) {
      if (key === 'reserved') return t('issueReserved')
      if (key === 'unsupported-browser') return t('issueUnsupportedBrowser')
      if (key === 'modifier-required') return t('issueModifierRequired')
      if (key === 'unsupported-key') return t('issueUnsupportedKey')
      return String(key)
    }

    /* ---------------------------------------------------------------- styles */

    const HOST_STYLE = {
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: Z_LAYER,
      pointerEvents: 'none',
      // Resets for the UA popover block: the host is shown through showPopover so it
      // paints in the top layer, above the settings dialog's own stacking context.
      margin: 0,
      padding: 0,
      border: 0,
      width: 'auto',
      height: 'auto',
      maxWidth: 'none',
      maxHeight: 'none',
      overflow: 'visible',
      background: 'transparent',
      color: 'inherit',
    }

    const VEIL_STYLE = {
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      // Deliberately transparent to the pointer: the pick loop reads `event.target`
      // instead of hit-testing, and a pointer-events:none veil is what lets the real
      // element be the target. Clicks are still intercepted at window capture.
      pointerEvents: 'none',
    }

    const HIDDEN = { display: 'none' }
    /**
     * Stable object identities matter: the box, the chip and the panel are moved
     * by mutating their inline style directly, and React only leaves a manually
     * changed style alone while the `style` prop keeps the same reference.
     */
    const PANEL_STYLE = { left: '-9999px', top: '-9999px' }

    const PANEL_CSS = [
      /* pick-mode veil, outline and hint */
      'html.dscz-picking, html.dscz-picking * { cursor: crosshair !important; }',
      '.dscz-veil { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #6b8afd) 6%, transparent); }',
      '.dscz-box { position: fixed; left: 0; top: 0; pointer-events: none; will-change: transform;',
      '  border: 1px solid var(--dsw-alias-brand-primary, #6b8afd); border-radius: 3px; }',
      '.dscz-chip { position: fixed; left: 0; top: 0; pointer-events: none; will-change: transform;',
      '  max-width: 60vw; overflow: hidden; text-overflow: ellipsis;',
      '  white-space: nowrap; padding: 1px 6px; border-radius: 4px;',
      '  font: 500 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;',
      '  background: var(--dsw-alias-brand-primary, #6b8afd); color: var(--dsw-alias-bg-base, #fff); }',
      '.dscz-hint { position: fixed; left: 50%; transform: translateX(-50%); bottom: 22px; pointer-events: none;',
      '  padding: 5px 12px; border-radius: 999px; font-size: 12px; background: var(--dsw-alias-bg-overlay, #1b1d21);',
      '  color: var(--dsw-alias-label-primary, #eceff3);',
      '  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.18)); box-shadow: 0 8px 24px rgba(0,0,0,.3); }',
      /* the floating panel */
      '.dscz-panel { position: fixed; z-index: ' + (Z_LAYER + 1) + '; width: 324px; max-height: 74vh; overflow: auto;',
      '  pointer-events: auto; box-sizing: border-box; padding: 10px 12px 12px;',
      '  border-radius: var(--dsw-radius-lg, 10px); font-size: 12px; line-height: 1.5; font-family: inherit;',
      '  background: var(--dsw-alias-bg-overlay, #1b1d21); color: var(--dsw-alias-label-primary, #eceff3);',
      '  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.18)); box-shadow: 0 14px 40px rgba(0,0,0,.38); }',
      '.dscz-panel * { box-sizing: border-box; }',
      '.dscz-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }',
      '.dscz-title { font-weight: 600; font-size: 12.5px; flex: 1; }',
      '.dscz-sec { margin-top: 10px; padding-top: 8px;',
      '  border-top: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.1)); }',
      '.dscz-sec-label { font-size: 11px; letter-spacing: .04em; text-transform: uppercase;',
      '  color: var(--dsw-alias-label-secondary, #98a0ab); margin-bottom: 6px; }',
      '.dscz-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }',
      '.dscz-row-label { width: 62px; flex: none; color: var(--dsw-alias-label-secondary, #98a0ab); }',
      '.dscz-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }',
      '.dscz-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }',
      '.dscz-muted { color: var(--dsw-alias-label-secondary, #98a0ab); }',
      /* controls, shaped after the host's own settings rows */
      '.dscz-swatch { box-sizing: border-box; appearance: none; width: 30px; height: 22px; padding: 0; flex: none;',
      '  cursor: pointer; border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.18));',
      '  border-radius: var(--dsw-radius-sm, 5px); }',
      '.dscz-swatch-active { outline: 2px solid var(--dsw-alias-brand-primary, #6b8afd); outline-offset: 1px; }',
      '.dscz-editor { margin: 6px 0 8px; padding: 8px; border-radius: var(--dsw-radius-md, 6px);',
      '  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.06));',
      '  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.14)); }',
      '.dscz-editor * { box-sizing: border-box; }',
      '.dscz-presets { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; margin-bottom: 8px; }',
      '.dscz-scopes { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }',
      '.dscz-scope { appearance: none; box-sizing: border-box; height: 24px; padding: 0 9px; cursor: pointer;',
      '  border-radius: 999px; font-size: 11px; font-family: inherit; color: inherit; background: transparent;',
      '  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.2)); }',
      '.dscz-scope-active { background: var(--dsw-alias-brand-primary, #6b8afd); border-color: transparent;',
      '  color: var(--dsw-alias-bg-base, #fff); }',
      '.dscz-tabs { display: flex; gap: 2px; margin-bottom: 8px; padding: 2px; border-radius: 8px;',
      '  background: var(--dsw-alias-bg-base, rgba(0,0,0,.25)); }',
      '.dscz-tab { appearance: none; flex: 1; height: 24px; padding: 0 8px; cursor: pointer; border: 0;',
      '  border-radius: 6px; font-size: 11px; font-family: inherit; color: var(--dsw-alias-label-secondary, #98a0ab);',
      '  background: transparent; }',
      '.dscz-tab-active { background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.1));',
      '  color: var(--dsw-alias-label-primary, #eceff3); }',
      '.dscz-native-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px;',
      '  font-size: 11px; }',
      '.dscz-native { box-sizing: border-box; width: 56px; height: 34px; flex: none; padding: 0; cursor: pointer;',
      '  background: transparent; border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.2));',
      '  border-radius: var(--dsw-radius-sm, 5px); }',
      '.dscz-version { margin-left: 6px; font-size: 10px; font-weight: 400;',
      '  color: var(--dsw-alias-label-tertiary, #7c848f); }',
      '.dscz-preset { appearance: none; width: 100%; height: 18px; padding: 0; cursor: pointer; border-radius: 4px;',
      '  border: 1px solid rgba(0, 0, 0, .3); }',
      '.dscz-preset:hover { outline: 1px solid var(--dsw-alias-border-l4, rgba(255,255,255,.4)); }',
      '.dscz-slider { display: flex; align-items: center; gap: 6px; padding: 1px 0; font-size: 11px; }',
      '.dscz-slider input[type="range"] { flex: 1; min-width: 0; height: 16px; margin: 0;',
      '  accent-color: var(--dsw-alias-brand-primary, #6b8afd); }',
      '.dscz-slider-label { width: 12px; flex: none; color: var(--dsw-alias-label-secondary, #98a0ab); }',
      '.dscz-slider-value { width: 36px; flex: none; text-align: right; font-variant-numeric: tabular-nums;',
      '  color: var(--dsw-alias-label-secondary, #98a0ab); }',
      '.dscz-hex, .dscz-a { flex: none; padding: 2px 5px; color: inherit;',
      '  border-radius: var(--dsw-radius-sm, 5px); background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.06));',
      '  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.14)); }',
      '.dscz-hex { width: 82px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }',
      '.dscz-a { width: 56px; }',
      '.dscz-btn { appearance: none; box-sizing: border-box; height: 32px; padding: 0 12px; font-family: inherit;',
      '  border: .5px solid var(--dsw-alias-border-l2, rgba(255,255,255,.2));',
      '  border-radius: var(--dsw-radius-md, 6px); background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.06));',
      '  color: var(--dsw-alias-label-primary, #eceff3); font-size: 13px; cursor: pointer; white-space: nowrap; }',
      '.dscz-btn:hover { border-color: var(--dsw-alias-border-l4, rgba(255,255,255,.34)); }',
      '.dscz-btn:disabled { opacity: .45; cursor: default; }',
      '.dscz-btn-sm { height: 26px; padding: 0 8px; font-size: 12px; }',
      '.dscz-primary { background: var(--dsw-alias-brand-primary, #6b8afd); border-color: transparent;',
      '  color: var(--dsw-alias-bg-base, #fff); }',
      '.dscz-icon { width: 26px; padding: 0; display: grid; place-items: center; }',
      '.dscz-token { margin-bottom: 6px; padding: 7px 8px;',
      '  border: 1px solid var(--dsw-alias-brand-primary, #6b8afd); border-radius: var(--dsw-radius-md, 6px);',
      '  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #6b8afd) 10%, transparent); }',
      '.dscz-token-line { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }',
      '.dscz-check { display: flex; align-items: center; gap: 4px;',
      '  color: var(--dsw-alias-label-secondary, #98a0ab); }',
      '.dscz-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; padding-top: 8px;',
      '  border-top: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.1)); }',
      '.dscz-ta { width: 100%; height: 84px; margin-top: 6px; resize: vertical; padding: 5px;',
      '  border-radius: var(--dsw-radius-md, 6px); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;',
      '  font-size: 10.5px; color: inherit; background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.06));',
      '  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.14)); }',
      /* 设置 → 常规 row: the host's own row recipe (16px vertical, .5px divider) */
      '.dscz-setting { display: flex; align-items: center; justify-content: space-between; gap: 24px;',
      '  padding: 16px 0; border-bottom: .5px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16)); }',
      '.dscz-setting-main { min-width: 0; }',
      '.dscz-setting-title { color: var(--dsw-alias-label-primary, #eceff3); font-size: 14px; line-height: 20px; }',
      '.dscz-setting-desc { color: var(--dsw-alias-label-secondary, #98a0ab); margin-top: 4px;',
      '  font-size: 12px; line-height: 18px; }',
      '.dscz-setting-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px;',
      '  margin-left: auto; flex: none; }',
      /* the plugin's own page */
      '.dscz-card { display: flex; flex-direction: column; gap: 2px;',
      '  color: var(--dsw-alias-label-primary, #eceff3); font-size: 13px; }',
      '.dscz-card-title { margin: 0 0 4px; font-size: 14px; font-weight: 600; line-height: 22px; }',
      '.dscz-card-desc { margin: 0 0 10px; color: var(--dsw-alias-label-secondary, #98a0ab);',
      '  font-size: 12px; line-height: 18px; }',
      '.dscz-card-sec { margin-top: 14px; padding-top: 12px;',
      '  border-top: .5px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16)); }',
      '.dscz-card-sec-label { font-size: 13px; font-weight: 600; margin-bottom: 6px; }',
      '.dscz-line { display: flex; align-items: center; gap: 8px; padding: 5px 0; min-width: 0; }',
      '.dscz-line-main { flex: 1; min-width: 0; }',
      '.dscz-line-sub { color: var(--dsw-alias-label-tertiary, #7c848f); font-size: 11px; }',
      '.dscz-key { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px;',
      '  padding: 0 5px; border-radius: var(--dsw-radius-xs, 4px);',
      '  border: .5px solid var(--dsw-alias-border-l2, rgba(255,255,255,.2));',
      '  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.06));',
      '  color: var(--dsw-alias-label-primary, #eceff3);',
      '  font: 500 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }',
      '.dscz-keys { display: inline-flex; align-items: center; gap: 4px; }',
      '.dscz-warn { color: var(--dsw-alias-state-warn-primary, #e0a33e); font-size: 11px; }',
      '.dscz-ok { color: var(--dsw-alias-state-success-primary, #3fa46a); font-size: 11px; }',
    ].join('\n')

    /* ----------------------------------------------------------- React bits */

    function Button(props) {
      const className = 'dscz-btn' +
        (props.small === true ? ' dscz-btn-sm' : '') +
        (props.primary === true ? ' dscz-primary' : '') +
        (props.icon === true ? ' dscz-icon' : '') +
        (props.className ? ' ' + props.className : '')
      return h('button', {
        type: 'button',
        className,
        title: props.title,
        disabled: props.disabled === true,
        onClick: props.onClick,
        style: props.style,
      }, props.children)
    }

    /** The catalog's `keys` is a display sequence that includes '+' separators. */
    function capKeys(keys) {
      if (!Array.isArray(keys)) return []
      return keys.filter((key) => typeof key === 'string' && key !== '' && key !== '+')
    }

    function keyText(keys) {
      return capKeys(keys).join(' + ')
    }

    function Keycaps({ keys, empty }) {
      const caps = capKeys(keys)
      if (caps.length === 0) {
        return h('span', { className: 'dscz-muted' }, empty)
      }
      return h('span', { className: 'dscz-keys' }, caps.map((key, index) =>
        h('kbd', { className: 'dscz-key', key: String(key) + '#' + index }, key)))
    }

    /** One-click colours: neutral ramp plus one per hue, so most edits need no picker. */
    const PRESET_COLORS = [
      '#000000', '#3a3f46', '#7a828c', '#c9ced6', '#ffffff',
      '#e5484d', '#f0762b', '#f5c542', '#3fa46a', '#22a2b8',
      '#3b82f6', '#8b5cf6', '#d946ef', '#f472b6', '#7c5c3e',
    ]

    /** The colour chip that opens the editor for one property. */
    function ColorChip({ value, title, active, onClick }) {
      const color = parseColor(value)
      return h('button', {
        type: 'button',
        className: 'dscz-swatch' + (active === true ? ' dscz-swatch-active' : ''),
        title,
        style: { background: color === null ? 'transparent' : toCss(color) },
        onClick,
      })
    }

    /**
     * Inline HEX field: type or paste `#rgb`, `#rrggbb` — or `#rrggbbaa` to set the alpha
     * from the hex itself — and confirm with Enter (or by leaving the field). It keeps its
     * own text while focused so partial input is not rewritten, and re-syncs whenever the
     * colour changes somewhere else (editor, presets, another surface).
     * `alpha` is carried separately so editing the hex never resets the opacity, and the
     * field is *shown* with the alpha byte (`toHexAlpha`) so a translucent colour does not
     * look opaque in the row.
     */
    function HexField({ value, alpha, title, onCommit }) {
      const [text, setText] = React.useState(value)
      const focused = React.useRef(false)
      React.useEffect(() => {
        if (focused.current !== true) setText(value)
      }, [value])
      const commit = (raw) => {
        const parsed = parseColor(raw)
        if (parsed === null) {
          setText(value)
          return
        }
        // 输入里写了 alpha 就以它为准；否则沿用行内当前不透明度（但 0% 视为空位，见 alphaForEdit）。
        const kept = alphaForEdit(parsed, alpha, raw)
        onCommit({ r: parsed.r, g: parsed.g, b: parsed.b, a: kept })
      }
      return h('input', {
        className: 'dscz-hex',
        value: text,
        spellCheck: false,
        title: title || 'HEX',
        onFocus: () => {
          focused.current = true
        },
        onChange: (event) => setText(event.target.value),
        onBlur: () => {
          focused.current = false
          commit(text)
        },
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            setText(value)
            event.currentTarget.blur()
          }
        },
      })
    }

    /** Inline opacity percentage; commits as you type and normalises on blur. */
    function AlphaField({ value, onCommit }) {
      const [text, setText] = React.useState(String(value))
      const focused = React.useRef(false)
      React.useEffect(() => {
        if (focused.current !== true) setText(String(value))
      }, [value])
      const clamp = (percent) => Math.max(0, Math.min(100, Math.round(percent)))
      return h('input', {
        className: 'dscz-a',
        type: 'number',
        min: 0,
        max: 100,
        step: 5,
        value: text,
        title: t('alpha') + ' %',
        onFocus: () => {
          focused.current = true
        },
        onChange: (event) => {
          setText(event.target.value)
          const parsed = parseFloat(event.target.value)
          if (Number.isFinite(parsed)) onCommit(clamp(parsed))
        },
        onBlur: () => {
          focused.current = false
          const parsed = parseFloat(text)
          setText(String(Number.isFinite(parsed) ? clamp(parsed) : value))
        },
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
        },
      })
    }

    function Slider({ label, min, max, value, onChange, suffix, title }) {
      return h('label', { className: 'dscz-slider', title },
        h('span', { className: 'dscz-slider-label' }, label),
        h('input', {
          type: 'range',
          min,
          max,
          step: 1,
          value,
          onChange: (event) => onChange(parseFloat(event.target.value)),
        }),
        h('span', { className: 'dscz-slider-value' }, String(value) + (suffix === undefined ? '' : suffix)))
    }

    /**
     * The colour editor, with two interchangeable ways to choose.
     *
     * 「调色盘」keeps the system colour dialog (wheel + screen eyedropper) plus the preset
     * swatches; 「混合器」is the in-panel R/G/B/A sliders + hex field. Both share one draft
     * and one 应用 / 取消 footer, so the confirm action always lives inside the panel —
     * which is exactly what the raw `<input type="color">` could not provide.
     */
    function ColorEditor({ from, onLive, onConfirm, onCancel, scopes, scopeId, onScope }) {
      // 从「空位」（全透明）打开时按 100% 起手：否则拖 R/G/B 会写 rgba(r,g,b,0)，
      // 用户看到的就是「颜色改了没反应」。
      const start = opaqueIfEmpty(parseColor(from)) || { r: 0, g: 0, b: 0, a: 1 }
      const [draft, setDraft] = React.useState(start)
      const [text, setText] = React.useState(toHexAlpha(start))
      const [mode, setMode] = React.useState('mixer')
      /**
       * The CSS this editor wrote last. A `from` that differs came from somewhere else — the
       * row's own hex / opacity field, the other surface — and is adopted into the draft.
       *
       * Without this, an editor left open while the row field changed kept a stale draft, so
       * the next slider drag wrote the *old* opacity back: the transparency the user had just
       * set looked like it was thrown away.
       */
      const written = React.useRef(toCss(start))
      React.useEffect(() => {
        if (written.current === from) return
        const next = parseColor(from) || { r: 0, g: 0, b: 0, a: 1 }
        written.current = from
        setDraft(next)
        setText(toHexAlpha(next))
      }, [from])
      const paint = (next) => {
        const css = toCss(next)
        written.current = css
        setDraft(next)
        setText(toHexAlpha(next))
        onLive(css)
      }
      /**
       * Fold a colour picked elsewhere (preset, OS picker, typed hex) into the draft.
       * The picked alpha only wins when the source actually carries one — otherwise a
       * preset or a six-digit hex would silently reset the opacity to 100 %.
       */
      const mergePick = (raw, picked) => Object.assign({}, picked, {
        a: carriesAlpha(raw) ? picked.a : draft.a,
      })
      const channel = (name, value) => paint(Object.assign({}, draft, { [name]: value }))
      const tabs = [['palette', t('modePalette')], ['mixer', t('modeMixer')]]
      return h('div', { className: 'dscz-editor', [MARK]: 'editor' },
        Array.isArray(scopes) && scopes.length > 1
          ? h('div', { className: 'dscz-scopes' }, scopes.map((option) =>
              h('button', {
                key: option.id,
                type: 'button',
                className: 'dscz-scope' + (option.id === scopeId ? ' dscz-scope-active' : ''),
                title: option.selector,
                onClick: () => onScope(option.id),
              }, t('scope' + cap(option.id)) + ' · ' + option.count)))
          : null,
        h('div', { className: 'dscz-tabs' }, tabs.map((tab) =>
          h('button', {
            key: tab[0],
            type: 'button',
            className: 'dscz-tab' + (mode === tab[0] ? ' dscz-tab-active' : ''),
            onClick: () => setMode(tab[0]),
          }, tab[1]))),
        mode === 'palette'
          ? h('div', null,
              h('div', { className: 'dscz-native-row' },
                h('input', {
                  className: 'dscz-native',
                  type: 'color',
                  value: toHex(draft),
                  title: t('modePalette'),
                  onChange: (event) => {
                    const raw = event.target.value
                    const picked = parseColor(raw)
                    if (picked !== null) paint(mergePick(raw, picked))
                  },
                }),
                h('span', { className: 'dscz-muted' }, t('paletteHint'))),
              h('div', { className: 'dscz-presets' }, PRESET_COLORS.map((preset) =>
                h('button', {
                  key: preset,
                  type: 'button',
                  className: 'dscz-preset',
                  title: preset,
                  style: { background: preset },
                  onClick: () => {
                    const picked = parseColor(preset)
                    if (picked !== null) paint(mergePick(preset, picked))
                  },
                }))))
          : h('div', null,
              h(Slider, { label: 'R', min: 0, max: 255, value: draft.r, onChange: (value) => channel('r', value) }),
              h(Slider, { label: 'G', min: 0, max: 255, value: draft.g, onChange: (value) => channel('g', value) }),
              h(Slider, { label: 'B', min: 0, max: 255, value: draft.b, onChange: (value) => channel('b', value) }),
              h(Slider, {
                label: 'A',
                min: 0,
                max: 100,
                suffix: '%',
                title: t('alpha'),
                value: Math.round(draft.a * 100),
                onChange: (value) => channel('a', Math.max(0, Math.min(1, value / 100))),
              })),
        h('div', { className: 'dscz-row' },
          h('input', {
            className: 'dscz-hex',
            value: text,
            spellCheck: false,
            title: 'HEX',
            onChange: (event) => {
              const next = event.target.value
              setText(next)
              const parsed = parseColor(next)
              if (parsed === null) return
              const merged = mergePick(next, parsed)
              setDraft(merged)
              onLive(toCss(merged))
            },
          }),
          h(Button, { small: true, primary: true, onClick: () => onConfirm() }, t('confirm')),
          h(Button, { small: true, onClick: () => onCancel() }, t('cancel')),
        ),
      )
    }

    /**
     * One subscription for every surface: our own store plus, when present, the
     * shortcut catalog and config, so a rebind made in DSH's own dialog shows up
     * here immediately. The counter (not the cached snapshot) is what re-renders.
     */
    function useColorize() {
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        const offStore = subscribe(() => bump((value) => value + 1))
        const offs = []
        if (shortcuts !== null) {
          if (shortcuts.catalog && typeof shortcuts.catalog.subscribe === 'function') {
            offs.push(shortcuts.catalog.subscribe(() => bump((value) => value + 1)))
          }
          if (shortcuts.config && typeof shortcuts.config.subscribe === 'function') {
            offs.push(shortcuts.config.subscribe(() => bump((value) => value + 1)))
          }
        }
        return () => {
          offStore()
          for (const off of offs) {
            try {
              off()
            } catch (error) {
              /* already gone */
            }
          }
        }
      }, [])
      return { state: current(), shortcut: shortcutState() }
    }

    /* ------------------------------------------------------ the pick surface */

    function ColorizerOverlay() {
      const { state, shortcut } = useColorize()
      const [bothModes, setBothModes] = React.useState(true)
      /** Which colour row's editor is open, and what to restore if the user cancels. */
      const [editing, setEditing] = React.useState(null)
      /** Which range each row will edit: self / same-class group / self + descendants. */
      const [scopes, setScopes] = React.useState({})
      const origin = React.useRef(null)
      const closeEditor = () => {
        setEditing(null)
        origin.current = null
      }
      const revertEditor = () => {
        const saved = origin.current
        if (saved !== null) {
          if (saved.kind === 'rule') {
            if (saved.had === true) {
              upsertRule(saved.selector, saved.prop, saved.value, saved.label, saved.extra)
            } else {
              removeRule(ruleId(saved.prop, saved.selector))
            }
          } else if (saved.kind === 'token') {
            restoreToken(saved.token, saved.modes)
          }
        }
        closeEditor()
      }

      const hostRef = React.useRef(null)
      const boxRef = React.useRef(null)
      const chipRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const lastBox = React.useRef(null)
      const lastChip = React.useRef(null)

      React.useEffect(() => {
        probeHost = hostRef.current
        return () => {
          probeHost = null
          probe = null
        }
      }, [])

      /**
       * Promote the host into the browser's top layer.
       *
       * DSH's settings dialog is a plain div under `body` with z-index 1000 — a sibling
       * stacking context of the app frame (z-index 20) — so no z-index inside the frame
       * can ever paint over it. A manual popover can, and it stays non-modal on purpose:
       * no backdrop, no focus trap, host still pointer-events:none.
       */
      React.useEffect(() => {
        const el = hostRef.current
        if (el === null) return undefined
        let opened = false
        if (typeof el.showPopover === 'function') {
          try {
            el.setAttribute('popover', 'manual')
            el.showPopover()
            opened = true
          } catch (error) {
            el.removeAttribute('popover')
            opened = false
          }
        }
        return () => {
          if (opened !== true) return
          try {
            if (el.matches(':popover-open')) el.hidePopover()
          } catch (error) {
            /* already closed */
          }
          el.removeAttribute('popover')
        }
      }, [])

      /* --- highlight geometry, shared by pick mode and the open panel --- */

      const paintBox = React.useCallback((el) => {
        const box = boxRef.current
        const chip = chipRef.current
        if (box === null) return
        if (el === null || !el.isConnected) {
          box.style.display = 'none'
          if (chip !== null) chip.style.display = 'none'
          lastBox.current = null
          lastChip.current = null
          return
        }
        // One layout read per frame, and only style writes after it. Position travels
        // through `transform` (compositor-only), so moving the outline never forces the
        // app to lay out or repaint; width/height still change the box's own layout.
        const rect = el.getBoundingClientRect()
        const boxKey = rect.left + ',' + rect.top + ',' + rect.width + ',' + rect.height
        if (lastBox.current !== boxKey) {
          lastBox.current = boxKey
          box.style.display = 'block'
          box.style.width = Math.max(0, rect.width) + 'px'
          box.style.height = Math.max(0, rect.height) + 'px'
          box.style.transform = 'translate3d(' + rect.left + 'px,' + rect.top + 'px,0)'
        }
        if (chip !== null) {
          const label = describe(el)
          if (lastChip.current !== label) {
            lastChip.current = label
            chip.textContent = label
          }
          chip.style.display = 'block'
          chip.style.transform = 'translate3d(' +
            Math.max(2, Math.min(rect.left, window.innerWidth - 120)) + 'px,' +
            Math.max(2, rect.top - 20) + 'px,0)'
        }
      }, [])

      const placePanel = React.useCallback(() => {
        const panel = panelRef.current
        const selected = store.selected
        if (panel === null || selected === null || !selected.el.isConnected) return
        const rect = selected.el.getBoundingClientRect()
        const width = panel.offsetWidth || 324
        const height = panel.offsetHeight || 260
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
        let top = rect.bottom + 10
        if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 10)
        panel.style.left = left + 'px'
        panel.style.top = top + 'px'
        paintBox(selected.el)
      }, [paintBox])

      /* --- pick mode: four listeners, added and removed with the mode --- */

      React.useEffect(() => {
        if (state.picking !== true) return undefined
        let frame = 0
        let hover = null

        // The veil is pointer-events:none, so `event.target` is already the element
        // under the pointer: no hit test, no forced layout, one rect read per frame.
        const usable = (el) => {
          if (!el || el.nodeType !== 1 || !el.tagName) return null
          if (typeof el.hasAttribute === 'function' && el.hasAttribute(MARK)) return null
          if (String(el.tagName).toLowerCase() === 'html') return null
          return el
        }

        const paint = () => {
          frame = 0
          paintBox(hover)
        }

        const onMove = (event) => {
          hover = usable(event.target)
          if (frame === 0) frame = window.requestAnimationFrame(paint)
        }
        // Mouse state is swallowed before the app sees it, so picking never focuses an
        // input, starts a drag, opens a context menu or selects text.
        const swallow = (event) => {
          event.preventDefault()
          event.stopPropagation()
        }
        const onPointerDown = (event) => {
          // stopPropagation only: cancelling pointerdown is what suppresses the
          // compatibility click in some engines, and the click is how we select.
          event.stopPropagation()
        }
        const onClick = (event) => {
          swallow(event)
          const el = usable(event.target)
          if (el === null) setPicking(false)
          else selectElement(el)
        }
        // Escape is the only key this plugin listens for on its own, and only while
        // picking. The activation shortcut goes through the application registry.
        const onKey = (event) => {
          if (event.key !== 'Escape' || event.repeat === true) return
          if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
          event.preventDefault()
          event.stopPropagation()
          setPicking(false)
        }

        document.documentElement.classList.add('dscz-picking')
        window.addEventListener('pointermove', onMove, true)
        window.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('mousedown', swallow, true)
        window.addEventListener('mouseup', swallow, true)
        window.addEventListener('dblclick', swallow, true)
        window.addEventListener('contextmenu', swallow, true)
        window.addEventListener('click', onClick, true)
        window.addEventListener('keydown', onKey, true)
        return () => {
          document.documentElement.classList.remove('dscz-picking')
          if (frame !== 0) window.cancelAnimationFrame(frame)
          window.removeEventListener('pointermove', onMove, true)
          window.removeEventListener('pointerdown', onPointerDown, true)
          window.removeEventListener('mousedown', swallow, true)
          window.removeEventListener('mouseup', swallow, true)
          window.removeEventListener('dblclick', swallow, true)
          window.removeEventListener('contextmenu', swallow, true)
          window.removeEventListener('click', onClick, true)
          window.removeEventListener('keydown', onKey, true)
        }
      }, [state.picking, paintBox])

      /* --- an open panel follows its element on scroll and resize --- */

      /**
       * Nothing is being picked and nothing is selected: the outline and the tag chip
       * must disappear. They are moved by direct style writes, so React never removes
       * them on its own — without this they freeze on screen at their last position,
       * which reads as "the window never closes".
       */
      React.useEffect(() => {
        if (state.picking === true || state.selected !== null) return undefined
        const box = boxRef.current
        const chip = chipRef.current
        if (box !== null) box.style.display = 'none'
        if (chip !== null) chip.style.display = 'none'
        lastBox.current = null
        lastChip.current = null
        return undefined
      }, [state.picking, state.selected])

      React.useEffect(() => {
        if (state.selected === null || state.picking === true) return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape' || event.repeat === true) return
          if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
          event.preventDefault()
          event.stopPropagation()
          clearSelection()
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, [state.selected, state.picking])

      React.useEffect(() => {
        if (state.selected === null) return undefined
        let frame = 0
        const schedule = () => {
          if (frame !== 0) return
          frame = window.requestAnimationFrame(() => {
            frame = 0
            placePanel()
          })
        }
        window.addEventListener('scroll', schedule, true)
        window.addEventListener('resize', schedule, true)
        schedule()
        return () => {
          if (frame !== 0) window.cancelAnimationFrame(frame)
          window.removeEventListener('scroll', schedule, true)
          window.removeEventListener('resize', schedule, true)
        }
      }, [state.selected, placePanel])

      const readComputedColor = (el, prop) => {
        try {
          if (el === null || el.isConnected !== true) return null
          const cs = window.getComputedStyle(el)
          return parseColor(prop === 'color' ? cs.color : cs.backgroundColor)
        } catch (error) {
          return null
        }
      }

      /* --- property rows for the picked element --- */

      /**
       * Which elements one edit will touch: just this one, every element sharing the
       * same stable selector (a whole message list), or the element plus all of its
       * descendants (all text inside one container).
       */
      const scopeOptions = (entry, selected) => {
        const base = (entry.target && entry.target.selector) || selected.selector
        const count = (selector) => {
          try {
            return document.querySelectorAll(selector).length
          } catch (error) {
            return 0
          }
        }
        const selfCount = count(base)
        const out = [{ id: 'self', selector: base, count: selfCount }]
        const group = base.replace(/:nth-of-type\(\d+\)/g, '')
        if (group !== base) {
          const groupCount = count(group)
          if (groupCount > 1) out.push({ id: 'group', selector: group, count: groupCount })
        }
        const inside = count(base + ' *')
        if (inside > 0) out.push({ id: 'descendants', selector: base + ', ' + base + ' *', count: selfCount + inside })
        return out
      }

      /** The colour a rule actually achieved, for the "something overrides it" hint. */
      const effectiveColor = (selected, entry, target) => {
        if (entry.prop !== 'background-color' && entry.prop !== 'color') return null
        try {
          const el = (target.scope === 'ancestor' || target.scope === 'child')
            ? document.querySelector(target.selector)
            : selected.el
          if (el === null) return null
          const cs = target.scope === 'pseudo'
            ? window.getComputedStyle(el, target.label)
            : window.getComputedStyle(el)
          return entry.prop === 'background-color' ? cs.backgroundColor : cs.color
        } catch (error) {
          return null
        }
      }

      const propertyRow = (selected, entry) => {
        const target = entry.target || { selector: selected.selector, label: null, scope: 'self' }
        const options = scopeOptions(entry, selected)
        const rowKey = entry.prop + '@' + target.selector
        const scopeId = scopes[rowKey] || 'self'
        const chosen = options.find((option) => option.id === scopeId) || options[0]
        const selector = chosen.selector
        const rule = ruleFor(entry.prop, selector)
        const color = parseColor(rule === null ? entry.value : rule.value) || { r: 0, g: 0, b: 0, a: 1 }
        const extra = entry.clearImage === true ? 'background-image: none !important;' : undefined
        const ruleLabel = selected.label + ' · ' + entry.prop +
          (target.scope === 'self' ? '' : ' · ' + target.label)
        const label = t(kindOf(entry.prop)) +
          (entry.prop.indexOf('border-') === 0 && entry.prop !== 'border-color'
            ? ' ' + entry.prop.slice(7, -6)
            : '') +
          (target.scope === 'pseudo' ? ' ' + target.label : '') +
          (target.scope === 'child' ? ' · ' + t('childPaint') + ' ' + target.label : '') +
          (target.scope === 'ancestor' ? ' · ' + t('ancestorPaint') + ' ' + target.label : '') +
          (entry.clearImage === true ? ' · ' + t('withImage') : '') +
          (entry.transparentSelf === true ? ' · ' + t('transparentRow') : '')
        const active = editing === rowKey
        const achieved = rule === null ? null : effectiveColor(selected, entry, target)
        const overridden = rule !== null && achieved !== null &&
          colorKey(parseColor(achieved)) !== colorKey(parseColor(rule.value))
        return h(
          'div',
          { key: rowKey },
          h(
            'div',
            { className: 'dscz-row' },
            h('span', { className: 'dscz-row-label dscz-ellipsis', title: label }, label),
            h(ColorChip, {
              value: toCss(color),
              active,
              title: t('pickCustom') + ' · ' + entry.prop,
              onClick: () => {
                if (active) {
                  closeEditor()
                  return
                }
                origin.current = {
                  kind: 'rule',
                  selector,
                  prop: entry.prop,
                  label: ruleLabel,
                  extra,
                  had: rule !== null,
                  value: rule === null ? null : rule.value,
                }
                setEditing(rowKey)
              },
            }),
            h(HexField, {
              value: toHexAlpha(color),
              alpha: color.a,
              onCommit: (next) => upsertRule(selector, entry.prop, toCss(next), ruleLabel, extra),
            }),
            h(AlphaField, {
              value: Math.round(color.a * 100),
              onCommit: (percent) => upsertRule(selector, entry.prop,
                toCss({ r: color.r, g: color.g, b: color.b, a: percent / 100 }), ruleLabel, extra),
            }),
            rule === null ? null : h(Button, {
              small: true,
              onClick: () => {
                removeRule(rule.id)
                if (active) closeEditor()
              },
            }, t('reset')),
          ),
          overridden === true ? h('div', { className: 'dscz-warn' }, t('overriddenByRule')) : null,
          active
            ? h(ColorEditor, {
                key: rowKey + ':editor',
                from: toCss(color),
                scopes: options,
                scopeId,
                onScope: (nextId) => {
                  const next = options.find((option) => option.id === nextId)
                  if (next === undefined) return
                  const existing = ruleFor(entry.prop, selector)
                  setScopes(Object.assign({}, scopes, { [rowKey]: nextId }))
                  if (existing !== null) {
                    removeRule(existing.id)
                    upsertRule(next.selector, entry.prop, existing.value, ruleLabel, extra)
                  }
                },
                onLive: (css) => upsertRule(selector, entry.prop, css, ruleLabel, extra),
                onConfirm: () => {
                  closeEditor()
                  // "应用" is the finish action: leave the colour mode entirely.
                  clearSelection()
                },
                onCancel: revertEditor,
              })
            : null,
        )
      }

      const tokenBlock = (selected) => {
        const entries = Object.keys(selected.tokenMatch).map((prop) => ({
          prop,
          token: selected.tokenMatch[prop],
        }))
        if (entries.length === 0) return null
        return h(
          'div',
          { className: 'dscz-sec' },
          h('div', { className: 'dscz-sec-label' }, t('tokenSection')),
          entries.map((entry) => {
            const overridden = Object.prototype.hasOwnProperty.call(state.tokens, entry.token)
            const stored = overridden ? state.tokens[entry.token][activeScheme()] : ''
            const base = parseColor(stored) || readComputedColor(selected.el, entry.prop) || { r: 0, g: 0, b: 0, a: 1 }
            const tokenKey = entry.token + '#' + entry.prop
            return h(
              'div',
              { className: 'dscz-token', key: entry.token },
              h(
                'div',
                { className: 'dscz-token-line' },
                h('span', {
                  className: 'dscz-mono dscz-ellipsis',
                  title: t('tokenHit').replace('{token}', entry.token),
                }, entry.token),
                overridden ? h('span', { className: 'dscz-muted' }, '•') : null,
              ),
              h(
                'div',
                { className: 'dscz-row' },
                h(ColorChip, {
                  value: toCss(base),
                  active: editing === tokenKey,
                  title: entry.token,
                  onClick: () => {
                    if (editing === tokenKey) {
                      closeEditor()
                      return
                    }
                    origin.current = {
                      kind: 'token',
                      token: entry.token,
                      had: overridden,
                      modes: overridden
                        ? { light: state.tokens[entry.token].light, dark: state.tokens[entry.token].dark }
                        : null,
                    }
                    setEditing(tokenKey)
                  },
                }),
                h(HexField, {
                  value: toHexAlpha(base),
                  alpha: base.a,
                  onCommit: (next) => setTokenColor(entry.token, toCss(next), bothModes),
                }),
                h(AlphaField, {
                  value: Math.round(base.a * 100),
                  onCommit: (percent) => setTokenColor(entry.token,
                    toCss({ r: base.r, g: base.g, b: base.b, a: percent / 100 }), bothModes),
                }),
                h(
                  'label',
                  { className: 'dscz-check', title: t('tokenSection') },
                  h('input', {
                    type: 'checkbox',
                    checked: bothModes,
                    onChange: (event) => setBothModes(event.target.checked),
                  }),
                  t('light') + ' / ' + t('dark'),
                ),
                overridden
                  ? h(Button, { small: true, onClick: () => removeToken(entry.token) }, t('reset'))
                  : null,
              ),
              editing === tokenKey
                ? h(ColorEditor, {
                    key: tokenKey + ':editor',
                    from: toCss(base),
                    onLive: (css) => setTokenColor(entry.token, css, bothModes),
                    onConfirm: () => {
                      closeEditor()
                      clearSelection()
                    },
                    onCancel: revertEditor,
                  })
                : null,
            )
          }),
        )
      }

      const panel = () => {
        const selected = state.selected
        const keys = shortcut && shortcut.keys.length > 0 ? shortcut.keys : null
        return h(
          'div',
          { className: 'dscz-panel', ref: panelRef, [MARK]: 'panel', style: PANEL_STYLE },
          h(
            'div',
            { className: 'dscz-head' },
            h('span', { className: 'dscz-title' }, t('title'),
              h('span', { className: 'dscz-version' }, 'v' + VERSION)),
            h(Button, { small: true, onClick: () => setPicking(true) }, t('repick')),
            h(Button, { small: true, icon: true, title: t('close'), onClick: clearSelection }, '✕'),
          ),
          h(
            'div',
            { className: 'dscz-row' },
            h('span', { className: 'dscz-row-label' }, t('target')),
            h('span', { className: 'dscz-mono dscz-ellipsis', title: selected.selector },
              selected.selector || t('noTarget')),
            h('span', { className: 'dscz-muted' }, t('matches').replace('{n}', String(selected.matches))),
          ),
          selected.props.length === 0
            ? h('div', { className: 'dscz-muted' }, t('noColors'))
            : h(
                'div',
                { className: 'dscz-sec' },
                h('div', { className: 'dscz-sec-label' }, t('colorsOnTarget')),
                selected.props.map((entry) => propertyRow(selected, entry)),
              ),
          tokenBlock(selected),
          h(
            'div',
            { className: 'dscz-foot' },
            h(Button, {
              small: true,
              primary: true,
              onClick: () => {
                closeEditor()
                clearSelection()
              },
            }, t('done')),
            h(Button, { small: true, disabled: state.rules.length === 0, onClick: undoRule }, t('undo')),
            h(Button, { small: true, disabled: state.rules.length === 0, onClick: clearRules }, t('clearAll')),
            h('span', { className: 'dscz-muted' }, keys === null ? '' : keyText(keys)),
          ),
        )
      }

      let body = null
      try {
        body = h(
          'div',
          { ref: hostRef, [MARK]: 'host', style: HOST_STYLE },
          h('style', null, PANEL_CSS),
          state.picking === true ? h('div', { [MARK]: 'veil', className: 'dscz-veil', style: VEIL_STYLE }) : null,
          h('div', { [MARK]: 'box', className: 'dscz-box', ref: boxRef, style: HIDDEN }),
          h('div', { [MARK]: 'chip', className: 'dscz-chip', ref: chipRef, style: HIDDEN }),
          state.picking === true ? h('div', { [MARK]: 'hint', className: 'dscz-hint' }, t('pickOn')) : null,
          state.picking !== true && state.selected !== null ? panel() : null,
        )
      } catch (error) {
        body = h('div', { style: HIDDEN, [MARK]: 'error' },
          t('crash').replace('{message}', String(error && error.message)))
        console.error('[dsh-colorize] panel render failed', error)
      }
      return body
    }

    /* --------------------------------------------------- the 常规 settings row */

    function GeneralRow() {
      const { state, shortcut } = useColorize()
      const keys = shortcut && shortcut.keys.length > 0 ? shortcut.keys : null
      return h(
        'div',
        { className: 'dscz-setting', [MARK]: 'setting' },
        h(
          'div',
          { className: 'dscz-setting-main' },
          h('div', { className: 'dscz-setting-title' }, t('rowLabel')),
          h('div', { className: 'dscz-setting-desc' },
            t('rowDesc') + (keys === null ? '' : ' · ' + keyText(keys))),
        ),
        h(
          'div',
          { className: 'dscz-setting-actions' },
          h(
            Button,
            { primary: state.picking !== true, onClick: () => setPicking(state.picking !== true) },
            state.picking === true ? t('stopPick') : t('startPick'),
          ),
        ),
      )
    }

    /* ------------------------------------------------- the plugin's own page */

    /**
     * One changed colour with its palette. Editing rewrites the CSS rule in place,
     * so the floating panel and the page never disagree.
     */
    function RuleLine({ rule }) {
      const color = parseColor(rule.value) || { r: 0, g: 0, b: 0, a: 1 }
      const [open, setOpen] = React.useState(false)
      const origin = React.useRef(rule.value)
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'dscz-line' },
          h(ColorChip, {
            value: toCss(color),
            active: open,
            title: t('pickCustom'),
            onClick: () => {
              if (open !== true) origin.current = rule.value
              setOpen(open !== true)
            },
          }),
          h(HexField, {
            value: toHexAlpha(color),
            alpha: color.a,
            onCommit: (next) => setRuleValue(rule.id, toCss(next)),
          }),
          h(AlphaField, {
            value: Math.round(color.a * 100),
            onCommit: (percent) => setRuleValue(rule.id,
              toCss({ r: color.r, g: color.g, b: color.b, a: percent / 100 })),
          }),
          h(
            'div',
            { className: 'dscz-line-main' },
            h('div', { className: 'dscz-ellipsis' }, rule.label + ' · ' + rule.prop),
            h('div', { className: 'dscz-line-sub dscz-ellipsis', title: rule.selector + ' { ' + rule.prop + ' }' },
              rule.selector),
          ),
          h(Button, { small: true, icon: true, title: t('reset'), onClick: () => removeRule(rule.id) }, '✕'),
        ),
        open
          ? h(ColorEditor, {
              key: rule.id + ':editor',
              from: rule.value,
              onLive: (css) => setRuleValue(rule.id, css),
              onConfirm: () => setOpen(false),
              onCancel: () => {
                setRuleValue(rule.id, origin.current)
                setOpen(false)
              },
            })
          : null,
      )
    }

    function SettingsCard() {
      const { state, shortcut } = useColorize()
      const [recording, setRecording] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [noticeOk, setNoticeOk] = React.useState(false)
      /** Key of the open inline editor on this page, plus the value 取消 restores. */
      const [editing, setEditing] = React.useState(null)
      const origin = React.useRef(null)
      const jsonRef = React.useRef(null)

      const say = React.useCallback((message, ok) => {
        setNotice(message)
        setNoticeOk(ok === true)
      }, [])

      /* --- shortcut recording, through the shortcuts service --- */
      React.useEffect(() => {
        if (recording !== true) return undefined
        let alive = true
        let nativeHeld = false
        const releaseNative = () => {
          if (nativeHeld !== true) return
          nativeHeld = false
          try {
            const result = shortcuts.recording(false)
            if (result && typeof result.catch === 'function') result.catch(() => {})
          } catch (error) {
            /* nothing to release */
          }
        }
        if (shortcuts && typeof shortcuts.recording === 'function') {
          try {
            const result = shortcuts.recording(true)
            if (result && typeof result.catch === 'function') {
              result.catch(() => {})
              nativeHeld = true
            } else {
              nativeHeld = true
            }
          } catch (error) {
            nativeHeld = false
          }
        }
        const finish = () => {
          releaseNative()
          setRecording(false)
        }
        const onKey = (event) => {
          if (typeof event.getModifierState === 'function' && event.getModifierState('AltGraph')) return
          if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault()
            event.stopPropagation()
            if (event.repeat !== true) finish()
            return
          }
          if (event.key === 'Dead') return
          const code = typeof event.code === 'string' && event.code !== '' ? event.code : ''
          if (code === '' || MODIFIER_CODES.test(code)) return
          event.preventDefault()
          event.stopPropagation()
          if (event.repeat === true) return
          const modifiers = ['control', 'alt', 'shift', 'meta'].filter((name) => ({
            control: event.ctrlKey,
            alt: event.altKey,
            shift: event.shiftKey,
            meta: event.metaKey,
          })[name])
          if (modifiers.length === 0) {
            say(t('hotkeyNeedModifier'), false)
            return
          }
          let described = null
          try {
            described = shortcuts && typeof shortcuts.describeBinding === 'function'
              ? shortcuts.describeBinding({ code, modifiers })
              : null
          } catch (error) {
            say(String(error && error.message ? error.message : error), false)
            return
          }
          if (described === null) {
            say(t('hotkeyNotReady'), false)
            return
          }
          if (described.issue !== null && described.issue !== undefined) {
            say(issueText(described.issue), false)
            return
          }
          const live = shortcutState()
          const conflicts = (described.conflicts || []).filter((id) => id !== COMMAND_ID)
          if (conflicts.length > 0) {
            say(t('hotkeyConflict').replace('{command}', labelOfCommand(conflicts[0], live)), false)
            return
          }
          if (live === null || live.revision === null) {
            say(t('hotkeyNotReady'), false)
            return
          }
          finish()
          Promise.resolve(shortcuts.edit(
            { type: 'set', id: COMMAND_ID, binding: { code, modifiers } },
            live.revision,
          )).then((result) => {
            if (alive !== true) return
            if (result && result.status === 'saved') say(t('hotkeySaved'), true)
            else say(t('hotkeyFailed').replace('{status}', result ? String(result.status) : '?'), false)
          }, (error) => {
            if (alive !== true) return
            say(t('hotkeyFailed').replace('{status}', String(error && error.message ? error.message : error)), false)
          })
        }
        window.addEventListener('keydown', onKey, true)
        return () => {
          alive = false
          window.removeEventListener('keydown', onKey, true)
          releaseNative()
        }
      }, [recording, say])

      const resetBinding = React.useCallback(() => {
        const live = shortcutState()
        if (shortcuts === null || live === null || live.revision === null) {
          say(t('hotkeyNotReady'), false)
          return
        }
        Promise.resolve(shortcuts.edit({ type: 'reset', id: COMMAND_ID }, live.revision)).then((result) => {
          if (result && result.status === 'saved') say(t('hotkeySaved'), true)
          else say(t('hotkeyFailed').replace('{status}', result ? String(result.status) : '?'), false)
        }, (error) => {
          say(t('hotkeyFailed').replace('{status}', String(error && error.message ? error.message : error)), false)
        })
      }, [say])

      const names = Object.keys(state.tokens)
      const hotkeyKeys = shortcut && shortcut.keys.length > 0 ? shortcut.keys : null
      const conflicts = shortcut && shortcut.conflicts ? shortcut.conflicts.filter((id) => id !== COMMAND_ID) : []

      return h(
        'div',
        { className: 'dscz-card', [MARK]: 'settings' },
        h('h3', { className: 'dscz-card-title' }, t('settingsTitle')),
        h('p', { className: 'dscz-card-desc' }, t('settingsDesc')),

        h(
          'div',
          { className: 'dscz-card-sec' },
          h('div', { className: 'dscz-card-sec-label' }, t('hotkeySection')),
          h(
            'div',
            { className: 'dscz-line' },
            h(
              'div',
              { className: 'dscz-line-main' },
              h(Keycaps, { keys: hotkeyKeys, empty: t('hotkeyUnbound') }),
              h('div', { className: 'dscz-line-sub' }, t('hotkeyCaption')),
              shortcut && shortcut.issue !== null && shortcut.issue !== undefined
                ? h('div', { className: 'dscz-warn' }, issueText(shortcut.issue))
                : null,
              conflicts.length > 0
                ? h('div', { className: 'dscz-warn' },
                    t('hotkeyConflict').replace('{command}', labelOfCommand(conflicts[0], shortcut)))
                : null,
            ),
            h(
              Button,
              {
                small: true,
                primary: recording === true,
                onClick: () => {
                  say('', false)
                  setRecording(recording !== true)
                },
              },
              recording === true ? t('hotkeyRecording') : t('hotkeyChange'),
            ),
            h(Button, {
              small: true,
              disabled: shortcut === null || shortcut.modified !== true,
              onClick: resetBinding,
            }, t('hotkeyReset')),
          ),
          notice === '' ? null : h('div', { className: noticeOk ? 'dscz-ok' : 'dscz-warn' }, notice),
          h(Button, {
            small: true,
            primary: state.picking !== true,
            style: { marginTop: '8px' },
            onClick: () => setPicking(state.picking !== true),
          }, state.picking === true ? t('stopPick') : t('startPick')),
        ),

        h(
          'div',
          { className: 'dscz-card-sec' },
          h('div', { className: 'dscz-card-sec-label' }, t('colorsSection') + ' · ' + state.rules.length),
          state.rules.length === 0
            ? h('div', { className: 'dscz-muted' }, t('colorsEmpty'))
            : state.rules
                .slice()
                .reverse()
                .map((rule) => h(RuleLine, { rule, key: rule.id })),
        ),

        h(
          'div',
          { className: 'dscz-card-sec' },
          h('div', { className: 'dscz-card-sec-label' }, t('tokensSection') + ' · ' + names.length),
          names.length === 0
            ? h('div', { className: 'dscz-muted' }, t('tokensEmpty'))
            : names.map((token) => {
                const rowKey = 'token:' + token
                const open = editing === rowKey
                return h(
                  'div',
                  { key: token },
                  h(
                    'div',
                    { className: 'dscz-line' },
                    h('div', { className: 'dscz-line-main' },
                      h('div', { className: 'dscz-mono dscz-ellipsis', title: token }, token)),
                    h('span', { className: 'dscz-muted' }, t('light')),
                    h(ColorChip, {
                      value: state.tokens[token].light,
                      active: open === true && editing === rowKey + ':light',
                      title: token + ' · light',
                      onClick: () => {
                        origin.current = { token, mode: 'light', value: state.tokens[token].light }
                        setEditing(editing === rowKey + ':light' ? null : rowKey + ':light')
                      },
                    }),
                    h('span', { className: 'dscz-muted' }, t('dark')),
                    h(ColorChip, {
                      value: state.tokens[token].dark,
                      active: editing === rowKey + ':dark',
                      title: token + ' · dark',
                      onClick: () => {
                        origin.current = { token, mode: 'dark', value: state.tokens[token].dark }
                        setEditing(editing === rowKey + ':dark' ? null : rowKey + ':dark')
                      },
                    }),
                    h(Button, { small: true, icon: true, title: t('reset'), onClick: () => removeToken(token) }, '✕'),
                  ),
                  editing === rowKey + ':light' || editing === rowKey + ':dark'
                    ? h(ColorEditor, {
                        key: editing,
                        from: editing === rowKey + ':light'
                          ? state.tokens[token].light
                          : state.tokens[token].dark,
                        onLive: (css) => setTokenMode(
                          token,
                          editing === rowKey + ':light' ? 'light' : 'dark',
                          css,
                        ),
                        onConfirm: () => setEditing(null),
                        onCancel: () => {
                          const saved = origin.current
                          if (saved !== null) setTokenMode(saved.token, saved.mode, saved.value)
                          setEditing(null)
                        },
                      })
                    : null,
                )
              }),
        ),

        h(
          'div',
          { className: 'dscz-card-sec' },
          h(
            'div',
            { className: 'dscz-line' },
            h(Button, {
              small: true,
              disabled: state.rules.length === 0 && names.length === 0,
              onClick: () => {
                clearRules()
                clearTokens()
                say('', false)
              },
            }, t('clearAll')),
            h(Button, { small: true, disabled: state.rules.length === 0, onClick: undoRule }, t('undo')),
          ),
          h(
            'details',
            { style: { marginTop: '6px' } },
            h('summary', { className: 'dscz-muted', style: { cursor: 'pointer', fontSize: '12px' } }, t('data')),
            h('textarea', {
              className: 'dscz-ta',
              ref: jsonRef,
              spellCheck: false,
              defaultValue: JSON.stringify({ version: 1, rules: store.rules, tokens: store.tokens }, null, 1),
            }),
            h(
              'div',
              { className: 'dscz-line' },
              h(Button, {
                small: true,
                title: t('data'),
                onClick: () => {
                  const node = jsonRef.current
                  if (node !== null) {
                    node.value = JSON.stringify({ version: 1, rules: store.rules, tokens: store.tokens }, null, 1)
                  }
                },
              }, '⟲'),
              h(Button, {
                small: true,
                onClick: () => {
                  const node = jsonRef.current
                  if (node === null) return
                  let parsed = null
                  try {
                    parsed = JSON.parse(node.value)
                  } catch (error) {
                    say(t('badJson'), false)
                    return
                  }
                  if (!parsed || typeof parsed !== 'object') return
                  try {
                    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
                  } catch (error) {
                    /* ignore */
                  }
                  window.location.reload()
                },
              }, t('apply')),
            ),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------ entry point */

    /** Dictionary lookup, resolved once the locale service has answered. */
    let t = (key) => (DICT_ZH[key] === undefined ? key : DICT_ZH[key])

    function serviceAt(ctx, name) {
      try {
        if (ctx && typeof ctx.get === 'function') {
          const value = ctx.get(name)
          if (value !== undefined && value !== null) return value
        }
      } catch (error) {
        /* fall through to the property form */
      }
      try {
        return ctx ? ctx[name] : undefined
      } catch (error) {
        return undefined
      }
    }

    exports.name = PACKAGE_ID
    exports.apply = function apply(ctx) {
      try {
        restore()

        const locale = serviceAt(ctx, 'locale')
        if (locale && typeof locale.register === 'function') {
          ctx.effect(() => locale.register(NS, { zh: DICT_ZH, en: DICT_EN }), 'dsh-colorize: dictionaries')
        }
        if (locale && typeof locale.bind === 'function') {
          try {
            t = locale.bind(NS)
          } catch (error) {
            t = (key) => (DICT_ZH[key] === undefined ? key : DICT_ZH[key])
          }
        }

        theme = serviceAt(ctx, 'theme') || null

        // One package-owned stylesheet carries every element rule.
        ctx.effect(
          () => {
            styleTag = document.createElement('style')
            styleTag.id = PACKAGE_ID + '-overrides'
            styleTag.setAttribute(MARK, 'style')
            document.head.appendChild(styleTag)
            return () => {
              styleTag = null
              const node = document.getElementById(PACKAGE_ID + '-overrides')
              if (node !== null) node.remove()
            }
          },
          'dsh-colorize: override stylesheet',
        )
        applyRules()

        // The token layer is written once at boot and rewritten on every edit.
        ctx.effect(
          () => {
            applyTokens()
            return () => {
              if (theme !== null && typeof theme.overrideTokens === 'function') {
                try {
                  theme.overrideTokens(PACKAGE_ID, {})
                } catch (error) {
                  /* the layer is gone with the runtime anyway */
                }
              }
            }
          },
          'dsh-colorize: theme token layer',
        )

        const slots = serviceAt(ctx, 'slots')

        // The activation shortcut is contributed through the application registry, so
        // it appears in 设置 → 常规 → 快捷键 and can be rebound there. A refusal here
        // is non-fatal: the 常规 row still arms pick mode with the mouse.
        const shortcutsService = serviceAt(ctx, 'shortcuts')
        if (shortcutsService && typeof shortcutsService.register === 'function') {
          shortcuts = shortcutsService
          ctx.effect(
            () => {
              const defaults = {}
              for (const profile of PROFILES) defaults[profile] = DEFAULT_BINDING
              try {
                return shortcutsService.register({
                  id: COMMAND_ID,
                  label: () => t('entryLabel'),
                  aliases: ['colorize', 'color', 'recolor'],
                  defaults,
                  regions: ['page', 'editable'],
                  modals: ['settings'],
                  resolve: (context) => {
                    const modal = context && context.modal ? context.modal : null
                    if (modal !== null && modal !== 'settings') {
                      return { status: 'blocked', reason: 'modal' }
                    }
                    return { status: 'handled', run: () => setPicking(store.picking !== true) }
                  },
                })
              } catch (error) {
                console.warn('[dsh-colorize] shortcut command was refused', error)
                return () => {}
              }
            },
            'dsh-colorize: shortcut command',
          )
        } else {
          console.warn('[dsh-colorize] shortcuts service is unavailable; use the settings button')
        }

        // Registration is idempotent on purpose: a duplicate entry id lands inside
        // the slot ledger's notification, where it can leave a mounted card dead
        // instead of merely logging, so a re-entry must not register twice.
        const regs = []
        const contribute = (key, options, component) => {
          try {
            regs.push(slots.inject(key, () => slots.register(options, component)))
          } catch (error) {
            console.warn('[dsh-colorize] could not register into ' + key, error)
          }
        }

        if (slots && typeof slots.inject === 'function' && typeof slots.register === 'function') {
          contribute('shell.overlay', {
            name: 'shell.overlay',
            id: PACKAGE_ID,
            order: 900,
            label: () => t('entryLabel'),
          }, ColorizerOverlay)
          contribute('settings.general.item', {
            name: 'settings.general.item',
            id: PACKAGE_ID,
            order: 14,
            label: () => t('rowLabel'),
          }, GeneralRow)
          contribute('plugins.bundle.config', {
            name: 'plugins.bundle.config',
            key: PACKAGE_ID,
            label: () => t('settingsTitle'),
          }, SettingsCard)
          ctx.effect(
            () => () => {
              for (const registration of regs) {
                try {
                  registration()
                } catch (error) {
                  /* already gone */
                }
              }
              regs.length = 0
            },
            'dsh-colorize: slot registrations',
          )
        } else {
          console.warn('[dsh-colorize] slots service is unavailable, no UI registered')
        }

        // Console escape hatch: useful when a browser, an IME or the OS owns the key.
        ctx.effect(
          () => {
            window.__dshColorize = {
              open: () => setPicking(true),
              close: () => setPicking(false),
              toggle: () => setPicking(store.picking !== true),
              state: () => {
                const live = shortcutState()
                return {
                  version: VERSION,
                  picking: store.picking,
                  selected: store.selected === null
                    ? null
                    : { selector: store.selected.selector, matches: store.selected.matches },
                  rules: store.rules.length,
                  tokens: Object.keys(store.tokens),
                  keys: live === null ? [] : capKeys(live.keys),
                  commandRegistered: live !== null && live.row !== null,
                  bindingIssue: live === null ? null : live.issue,
                  conflicts: live === null ? [] : live.conflicts,
                  modules: globalThis.__dshColorizeModules,
                }
              },
              clear: () => {
                clearRules()
                clearTokens()
              },
            }
            return () => {
              delete window.__dshColorize
            }
          },
          'dsh-colorize: console control',
        )
      } catch (error) {
        console.error('[dsh-colorize] apply failed', error)
      }
    }

    /**
     * Test-only hook.
     *
     * `tests/color.test.mjs` evaluates this file in a fresh `node:vm` context with
     * `globalThis.__DSH_COLORIZE_TEST__ = true` and reads these pure functions back out.
     * A browser never sets that flag, so nothing reaches the page — but the colour maths is
     * exactly where the alpha bugs lived (hex edit resetting opacity, the OS picker
     * flattening an alpha, a slider writing back a stale draft), and it is the only part of
     * this file that can be tested without a DOM.
     */
    if (globalThis.__DSH_COLORIZE_TEST__ === true) {
      exports.__internals = { parseColor, toHex, toHexAlpha, toCss, carriesAlpha, colorKey, ruleId, alphaForEdit, opaqueIfEmpty }
    }

    exports.inject = ['slots', 'theme', 'locale']
    return exports
  },
})
