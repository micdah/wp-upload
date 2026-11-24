#!/usr/bin/env node
// Builds the companion plugin for distribution (plugin-api.md §9.1, D12, D30):
//
//   plugin/dist/wp-upload-companion/wp-upload-companion.php  one PHP file, every
//       class inlined in bracketed namespaces, no autoloader. Works as a
//       regular plugin and when dropped into mu-plugins.
//   plugin/dist/wp-upload-companion.zip   the folder above, for Plugins → Add New → Upload
//   plugin/dist/plugin.json               {version, api, features}
//   plugin/dist/changelog.json            plugin/CHANGELOG.md as [{version, date, changes}]
//
// Usage: node plugin/scripts/build.mjs
// No PHP is needed: `dev/run test plugin-static` lints the result separately.
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_DIR = join(PLUGIN_ROOT, 'wp-upload-companion')
const ENTRY_FILE = join(SOURCE_DIR, 'wp-upload-companion.php')
const CLASSES_DIR = join(SOURCE_DIR, 'src')
const CHANGELOG_FILE = join(PLUGIN_ROOT, 'CHANGELOG.md')
const DIST_DIR = join(PLUGIN_ROOT, 'dist')
const SLUG = 'wp-upload-companion'

// Zip entries get a fixed timestamp so the same source gives the same zip.
const ZIP_MTIME = new Date('2026-01-01T00:00:00Z')

// The entry file's development autoloader is dropped from the build. Explicit
// markers win; without them, the block from its comment to the closing `);`
// of spl_autoload_register() is removed.
const STRIP_START = '// @build-strip-start'
const STRIP_END = '// @build-strip-end'
const AUTOLOADER_BLOCK =
  /\/\/ Development autoloader[^\n]*\n(?:\/\/[^\n]*\n)*spl_autoload_register\([\s\S]*?\n\);\n/

function fail(message) {
  console.error(`build.mjs: ${message}`)
  process.exit(1)
}

function listPhpFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listPhpFiles(path))
    } else if (entry.name.endsWith('.php')) {
      files.push(path)
    }
  }
  return files.sort()
}

function stripOpeningTag(source, path) {
  const trimmed = source.replace(/^﻿/, '')
  if (!trimmed.startsWith('<?php')) {
    fail(`${path} must start with <?php`)
  }
  if (/\?>\s*$/.test(trimmed)) {
    fail(`${path} must not end with a closing ?> tag`)
  }
  return trimmed.slice('<?php'.length)
}

// One class file → its namespace, the class it declares, the names it
// extends/implements (resolved to fully qualified names), and its body.
function parseClassFile(path) {
  const source = stripOpeningTag(readFileSync(path, 'utf8'), path)
  const namespaceMatch = source.match(/^namespace\s+([A-Za-z0-9_\\]+)\s*;/m)
  if (!namespaceMatch) {
    fail(`${path} has no "namespace X;" declaration`)
  }
  const namespace = namespaceMatch[1]
  const body = source.slice(
    (namespaceMatch.index ?? 0) + namespaceMatch[0].length,
  )
  const preamble = source.slice(0, namespaceMatch.index)

  const imports = new Map()
  for (const match of body.matchAll(
    /^use\s+([A-Za-z0-9_\\]+)(?:\s+as\s+([A-Za-z0-9_]+))?\s*;/gm,
  )) {
    const fullName = match[1].replace(/^\\/, '')
    const alias = match[2] ?? fullName.split('\\').pop()
    imports.set(alias, fullName)
  }
  const resolve = (name) => {
    if (name.startsWith('\\')) {
      return name.slice(1)
    }
    const [first, ...rest] = name.split('\\')
    if (imports.has(first)) {
      return [imports.get(first), ...rest].join('\\')
    }
    return `${namespace}\\${name}`
  }

  const declaration = body.match(
    /^(?:final\s+|abstract\s+)?(class|interface|trait)\s+([A-Za-z0-9_]+)([^{]*)\{/m,
  )
  if (!declaration) {
    fail(`${path} declares no class, interface or trait`)
  }
  const heritage = declaration[3]
  const parents = []
  for (const clause of heritage.matchAll(
    /(extends|implements)\s+([A-Za-z0-9_\\,\s]+?)(?=\s+(?:extends|implements)\b|$)/g,
  )) {
    for (const name of clause[2].split(',')) {
      if (name.trim() !== '') {
        parents.push(resolve(name.trim()))
      }
    }
  }
  return {
    path,
    namespace,
    fullName: `${namespace}\\${declaration[2]}`,
    parents,
    preamble: preamble.trim(),
    body: body.trim(),
  }
}

// Parents (interfaces, base classes) must be declared before the classes that
// use them, because only dependency-free classes are hoisted by PHP.
function orderByDependencies(classFiles) {
  const byName = new Map(classFiles.map((file) => [file.fullName, file]))
  const ordered = []
  const state = new Map()
  const visit = (file) => {
    if (state.get(file.fullName) === 'done') {
      return
    }
    if (state.get(file.fullName) === 'visiting') {
      fail(`circular inheritance at ${file.fullName}`)
    }
    state.set(file.fullName, 'visiting')
    for (const parent of file.parents) {
      const parentFile = byName.get(parent)
      if (parentFile) {
        visit(parentFile)
      }
    }
    state.set(file.fullName, 'done')
    ordered.push(file)
  }
  for (const file of classFiles) {
    visit(file)
  }
  return ordered
}

function readConstant(source, name) {
  const match = source.match(new RegExp(`^const ${name} = '([^']+)';$`, 'm'))
  if (!match) {
    fail(`the entry file has no "const ${name} = '...';"`)
  }
  return match[1]
}

// The entry file → its plugin header comment and the code that follows it,
// without the development autoloader.
function parseEntryFile() {
  const source = stripOpeningTag(readFileSync(ENTRY_FILE, 'utf8'), ENTRY_FILE)
  const headerMatch = source.match(/^\s*(\/\*\*[\s\S]*?\*\/)/)
  if (!headerMatch?.[1].includes('Plugin Name:')) {
    fail('the entry file must start with the plugin header comment')
  }
  let code = source.slice(headerMatch[0].length)

  const startIndex = code.indexOf(STRIP_START)
  if (startIndex !== -1) {
    const endIndex = code.indexOf(STRIP_END, startIndex)
    if (endIndex === -1) {
      fail(`${STRIP_START} without ${STRIP_END} in the entry file`)
    }
    code = code.slice(0, startIndex) + code.slice(endIndex + STRIP_END.length)
  } else {
    if (!AUTOLOADER_BLOCK.test(code)) {
      fail(
        'could not find the development autoloader in the entry file; mark it with ' +
          `${STRIP_START} / ${STRIP_END}`,
      )
    }
    code = code.replace(AUTOLOADER_BLOCK, '')
  }
  if (code.includes('spl_autoload_register')) {
    fail('the built entry code still registers an autoloader')
  }
  return { header: headerMatch[1], code: code.trim(), source }
}

function checkVersions(entry) {
  const version = readConstant(entry.source, 'WPU_VERSION')
  const api = readConstant(entry.source, 'WPU_API')
  const headerVersion = entry.header.match(/^\s*\*\s*Version:\s*(\S+)/m)?.[1]
  if (headerVersion !== version) {
    fail(
      `header Version (${headerVersion}) and WPU_VERSION (${version}) differ`,
    )
  }
  return { version, api }
}

// Features come from Plugin::provide_feature('…') calls, in the order of
// Plugin::FEATURE_ORDER (PLUGIN_FEATURES in shared/library-api.ts).
function collectFeatures(classFiles) {
  const pluginFile = classFiles.find((file) =>
    file.fullName.endsWith('\\Companion\\Plugin'),
  )
  const orderBlock = pluginFile?.body.match(
    /const FEATURE_ORDER = array\(([\s\S]*?)\);/,
  )
  if (!orderBlock) {
    fail('Plugin.php has no FEATURE_ORDER array')
  }
  const order = [...orderBlock[1].matchAll(/'([a-z0-9-]+)'/g)].map(
    (match) => match[1],
  )
  const provided = new Set()
  for (const file of classFiles) {
    for (const match of file.body.matchAll(
      /provide_feature\(\s*'([a-z0-9-]+)'\s*\)/g,
    )) {
      provided.add(match[1])
    }
  }
  const known = order.filter((feature) => provided.has(feature))
  const unknown = [...provided].filter((feature) => !order.includes(feature))
  return [...known, ...unknown.sort()]
}

// "## 1.0.0 (2026-12-01)" or "## 1.0.0 - 2026-12-01" headings with "- " items.
// "## Unreleased" and anything without a date are skipped.
function parseChangelog() {
  const lines = readFileSync(CHANGELOG_FILE, 'utf8').split('\n')
  const entries = []
  let current = null
  for (const line of lines) {
    const heading = line.match(
      /^##\s+\[?v?([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\]?\s*(?:\(|[-–—]\s*)([0-9]{4}-[0-9]{2}-[0-9]{2})\)?\s*$/,
    )
    if (heading) {
      current = { version: heading[1], date: heading[2], changes: [] }
      entries.push(current)
      continue
    }
    if (line.startsWith('## ')) {
      current = null
      continue
    }
    if (!current) {
      continue
    }
    const item = line.match(/^[-*]\s+(.*)$/)
    if (item) {
      current.changes.push(item[1].trim())
    } else if (/^\s+\S/.test(line) && current.changes.length > 0) {
      const last = current.changes.length - 1
      current.changes[last] = `${current.changes[last]} ${line.trim()}`
    }
  }
  return entries
}

function buildSingleFile(entry, classFiles) {
  const blocks = classFiles.map((file) => {
    const source = relative(PLUGIN_ROOT, file.path)
    return `// ---- ${source}\nnamespace ${file.namespace} {\n\n${file.body}\n\n}`
  })
  return [
    '<?php',
    entry.header,
    '',
    '// Built by plugin/scripts/build.mjs from plugin/wp-upload-companion/. Do not edit.',
    '',
    '// No direct access; and when loaded twice (as a mu-plugin and as a regular',
    '// plugin), the first copy wins.',
    "namespace {\n\nif ( ! defined( 'ABSPATH' ) ) {\n\texit;\n}\nif ( defined( 'WPU_VERSION' ) ) {\n\treturn;\n}\n\n}",
    '',
    ...blocks.flatMap((block) => [block, '']),
    `// ---- ${relative(PLUGIN_ROOT, ENTRY_FILE)}\nnamespace {\n\n${entry.code}\n\n}`,
    '',
  ].join('\n')
}

function writeOutputs({ singleFile, version, api, features, changelog }) {
  rmSync(DIST_DIR, { recursive: true, force: true })
  mkdirSync(join(DIST_DIR, SLUG), { recursive: true })

  const phpPath = join(DIST_DIR, SLUG, `${SLUG}.php`)
  writeFileSync(phpPath, singleFile)

  const zip = zipSync(
    {
      [SLUG]: {
        [`${SLUG}.php`]: [
          new TextEncoder().encode(singleFile),
          { mtime: ZIP_MTIME },
        ],
      },
    },
    { level: 9, mtime: ZIP_MTIME },
  )
  writeFileSync(join(DIST_DIR, `${SLUG}.zip`), zip)

  writeFileSync(
    join(DIST_DIR, 'plugin.json'),
    `${JSON.stringify({ version, api, features }, null, 2)}\n`,
  )
  writeFileSync(
    join(DIST_DIR, 'changelog.json'),
    `${JSON.stringify(changelog, null, 2)}\n`,
  )
  return phpPath
}

function main() {
  const entry = parseEntryFile()
  const { version, api } = checkVersions(entry)
  const classFiles = orderByDependencies(
    listPhpFiles(CLASSES_DIR).map(parseClassFile),
  )
  for (const file of classFiles) {
    if (file.preamble.replace(/\/\*[\s\S]*?\*\//g, '').trim() !== '') {
      fail(`${file.path} has code before its namespace declaration`)
    }
  }
  const features = collectFeatures(classFiles)
  const changelog = parseChangelog()
  const singleFile = buildSingleFile(entry, classFiles)
  const phpPath = writeOutputs({
    singleFile,
    version,
    api,
    features,
    changelog,
  })
  console.log(
    `Built ${relative(process.cwd(), phpPath)} (${version}, API ${api}, ` +
      `${classFiles.length} classes, features: ${features.join(', ') || 'none'})`,
  )
}

main()
