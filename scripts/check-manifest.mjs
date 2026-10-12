#!/usr/bin/env node
/**
 * Static manifest checks for CI and local `npm run check:manifest`.
 *
 * Two of these guards are load-bearing in ways that are easy to forget:
 *
 * 1. **`client.js` 的 `VERSION` 必须等于 `package.json` 的 version** —— 面板标题显示的
 *    就是这个值，它是「页面里到底装的哪个构建」的唯一线索。发版时漏改一处，用户看到的
 *    版本号就是假的，排障会直接走错方向（CHANGELOG 0.5.x 里踩过）。
 * 2. **零轮询** —— 插件对外的承诺是「空闲时没有轮询 / 没有 MutationObserver」，只有一条
 *    常驻 `<style>`、一个快捷键命令和一个零尺寸挂载点。这两条正则看着朴素，但它们是唯一
 *    能自动拦住「顺手加个 setInterval 兜底」的东西。
 *
 * 其余是清单一致性：包名 / 版本 / 入口 / patch 行 / locale 元数据 / `files` 覆盖，
 * 以及 exports 指向的文件真的存在。
 *
 * @module dsh-colorize/scripts/check-manifest
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const problems = []
const notes = []

const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const readText = (path) => readFileSync(join(root, path), 'utf8')

const pkg = readJson('package.json')
const manifest = readJson('dsh.plugin.json')

/**
 * Whether a path ships in the packed tarball, judged from package.json `files`
 * (exact entries, directory prefixes, and simple `*` globs).
 */
function isPacked(path) {
  const target = path.replace(/^\.\//, '')
  for (const entry of pkg.files ?? []) {
    const clean = entry.replace(/\/$/, '').replace(/^\.\//, '')
    if (clean === target) return true
    if (target.startsWith(`${clean}/`)) return true
    if (entry.includes('*')) {
      const pattern = new RegExp(`^${entry.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`)
      if (pattern.test(target)) return true
    }
  }
  return false
}

// ---- package.json basics ---------------------------------------------------
if (pkg.type !== 'module') problems.push('package.json: type must be "module"')
if (pkg.license === undefined) problems.push('package.json: license is missing')
if (pkg.author === undefined) problems.push('package.json: author is missing')
if (typeof pkg.main !== 'string' || existsSync(join(root, pkg.main)) !== true) {
  problems.push(`package.json: main "${pkg.main}" does not exist`)
}
if (pkg.repository?.url?.includes(pkg.name) !== true) {
  problems.push(`package.json: repository.url must point at a repo named ${pkg.name}`)
}
if (Array.isArray(pkg.files) !== true || pkg.files.length === 0) {
  problems.push('package.json: files must list what ships')
}
if (pkg.dsh?.bundle?.patch === undefined) problems.push('package.json: dsh.bundle.patch is missing')
else if (existsSync(join(root, pkg.dsh.bundle.patch)) !== true) {
  problems.push(`package.json: patch file ${pkg.dsh.bundle.patch} does not exist`)
}

// ---- entry (host half) -----------------------------------------------------
const entry = readText(pkg.main)
if (/export (async )?function apply/.test(entry) !== true) {
  problems.push(`${pkg.main} must export apply()`)
}

// ---- client half -----------------------------------------------------------
if (pkg.dsh?.client === undefined) {
  problems.push('package.json: dsh.client is missing — this plugin is a browser-side plugin')
} else {
  const platform = pkg.dsh.client.platform
  if (platform !== 'web' && platform !== 'desktop') {
    problems.push(`dsh.client.platform "${platform}" is not a known platform`)
  }
  if (pkg.dsh.client.immediately !== undefined && typeof pkg.dsh.client.immediately !== 'boolean') {
    problems.push('dsh.client.immediately must be a boolean')
  }
  const clientPath = pkg.exports?.['./client']
  if (clientPath === undefined) problems.push('exports["./client"] is missing')
  else if (existsSync(join(root, clientPath)) !== true) {
    problems.push(`exports["./client"] points at a missing file: ${clientPath}`)
  } else {
    const source = readText(clientPath)
    if (source.includes('__ModuleLoader__.load') !== true) {
      problems.push(`${clientPath} must register through window.__ModuleLoader__.load`)
    }
    if (source.includes(`id: '${pkg.name}'`) !== true && source.includes(`id: "${pkg.name}"`) !== true) {
      problems.push(`${clientPath} must use the package name as its loader id`)
    }
    if (isPacked(clientPath) !== true) problems.push(`${clientPath} must be covered by package.json files`)

    // 面板标题 = VERSION；发版漏改一处，用户看到的版本号就是假的。
    const version = source.match(/const VERSION = '([^']+)'/)
    if (version === null) problems.push(`${clientPath}: could not find "const VERSION" (the panel title reads it)`)
    else if (version[1] !== pkg.version) {
      problems.push(`${clientPath}: VERSION ${version[1]} != package.json version ${pkg.version}`)
    }

    // 零轮询：空闲时只有一条 <style>、一个命令和一个零尺寸挂载点。
    if (/\bsetInterval\s*\(/.test(source)) problems.push(`${clientPath} must not poll: setInterval() found`)
    if (/new\s+MutationObserver\s*\(/.test(source)) {
      problems.push(`${clientPath} must not observe the DOM: new MutationObserver() found`)
    }
  }

  if (pkg.exports?.['./locale/*.json'] === undefined) {
    problems.push('the plugin list / settings needs locale metadata: export "./locale/*.json"')
  }
  if (existsSync(join(root, 'icon.svg')) !== true) problems.push('icon.svg is missing')
  else if (pkg.exports?.['./icon'] === undefined) problems.push('icon.svg exists but exports["./icon"] is missing')

  const locales = ['locale/zh.json', 'locale/en.json']
  const shapes = []
  for (const locale of locales) {
    if (existsSync(join(root, locale)) !== true) {
      problems.push(`${locale} is missing`)
      continue
    }
    const parsed = readJson(locale)
    if (typeof parsed?.meta?.title !== 'string' || parsed.meta.title === '') problems.push(`${locale} needs meta.title`)
    if (typeof parsed?.meta?.description !== 'string' || parsed.meta.description === '') {
      problems.push(`${locale} needs meta.description`)
    }
    shapes.push(Object.keys(parsed).sort().join(','))
  }
  // 两份 locale 的键必须一一对应，否则切语言会出现空洞。
  if (shapes.length === 2 && shapes[0] !== shapes[1]) {
    problems.push(`locale/zh.json and locale/en.json must expose the same keys (${shapes[0]} vs ${shapes[1]})`)
  }
}

// ---- bundle patch ----------------------------------------------------------
const patch = readText(pkg.dsh.bundle.patch)
if (/^\s*- insert:/m.test(patch) !== true) problems.push('cordis.patch.yml must contain an insert list')
if (patch.includes(`name: ${pkg.name}`) !== true && patch.includes(`name: '${pkg.name}'`) !== true) {
  problems.push(`cordis.patch.yml must reference the plugin by name: ${pkg.name}`)
}
if (/^\s*(?:-\s*)?id:\s*\S+/m.test(patch) !== true) problems.push('cordis.patch.yml must give the inserted row an id')

// ---- plugin manifest -------------------------------------------------------
if (manifest.id !== pkg.name) problems.push(`dsh.plugin.json id "${manifest.id}" must equal the package name "${pkg.name}"`)
if (manifest.version !== pkg.version) problems.push('dsh.plugin.json version must equal package.json version')
if (manifest.main !== pkg.main) problems.push('dsh.plugin.json main must equal package.json main')
const declaredClient = Array.isArray(manifest.contributes?.client) ? manifest.contributes.client[0] : null
if (declaredClient === null) problems.push('dsh.plugin.json contributes.client must describe the browser half')
else {
  if (declaredClient.platform !== pkg.dsh.client.platform) {
    problems.push('dsh.plugin.json contributes.client[0].platform must match package.json dsh.client.platform')
  }
  if (declaredClient.entry !== undefined && declaredClient.entry !== pkg.exports['./client']) {
    problems.push('dsh.plugin.json contributes.client[0].entry must match exports["./client"]')
  }
}

// ---- README ----------------------------------------------------------------
const readme = readText('README.md')
if (readme.length < 1000) problems.push('README.md looks empty')
const slug = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '').replace('https://github.com/', '')
if (readme.includes(slug) !== true) problems.push(`README.md must link this repo (${slug}) — the CI badge URL is a copy-paste trap`)
if (readme.includes('powered_by-dsh') !== true) problems.push('README.md must carry the official "powered by dsh" badge')

// ---- docs / release notes --------------------------------------------------
for (const doc of ['docs/internals.md', 'docs/verification.md', 'docs/troubleshooting.md']) {
  if (existsSync(join(root, doc)) !== true) problems.push(`${doc} is missing`)
  else if (isPacked(doc) !== true) problems.push(`${doc} must be covered by package.json files`)
}
const releaseNotesPath = join(root, 'docs', 'releases', `v${pkg.version}.md`)
if (existsSync(releaseNotesPath) !== true) {
  problems.push(`docs/releases/v${pkg.version}.md is missing (the release workflow reads it)`)
}

// ---- report ----------------------------------------------------------------
for (const note of notes) console.log(`note: ${note}`)
if (problems.length > 0) {
  for (const problem of problems) console.error(`error: ${problem}`)
  console.error(`\n${problems.length} manifest problem(s)`)
  process.exitCode = 1
} else {
  console.log(`manifest ok: ${pkg.name}@${pkg.version} (client ${pkg.dsh.client.platform}, locale zh/en, patch ${pkg.dsh.bundle.patch})`)
}
