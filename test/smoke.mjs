#!/usr/bin/env node
/**
 * Zero-dependency consistency checks for the dsh-openrouter-market bundle.
 *
 * The repository ships prebuilt artifacts (lib/index.js, lib/client.js), so the
 * checks focus on what a DSH installation reads before running anything:
 * the package manifest, the bundle patch, display metadata, the built files and
 * the optional plugin market index.
 *
 * Run with `npm test` (or `node test/smoke.mjs`).
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

let passed = 0
let failed = 0
function check(condition, message) {
  if (condition) {
    passed += 1
    console.log(`ok   ${message}`)
  } else {
    failed += 1
    console.error(`FAIL ${message}`)
  }
}
function checkEqual(actual, expected, message) {
  check(actual === expected, `${message} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

// ------------------------------------------------------------------ manifest
let pkg = {}
try {
  pkg = JSON.parse(read('package.json'))
  check(true, 'package.json parses as JSON')
} catch (error) {
  check(false, `package.json parses as JSON: ${error.message}`)
}
checkEqual(pkg.name, 'dsh-openrouter-market', 'package name')
check(SEMVER.test(String(pkg.version)), `package version is semver (${pkg.version})`)
check(pkg.private !== true, 'package is not private (installable / publishable)')
check(pkg.type === 'module', 'package is an ES module')
check(typeof pkg.description === 'string' && pkg.description.trim() !== '', 'package description is present')
check(pkg.license === 'MIT', 'package license is MIT')
check(pkg.repository?.url === 'git+https://github.com/greatZhaoFD/dsh-openrouter-market.git', 'repository URL')
check(typeof pkg.engines?.node === 'string' && pkg.engines.node !== '', 'engines.node is declared')

// ----------------------------------------------------------------- bundle info
checkEqual(pkg.dsh?.manifestVersion, 1, 'dsh.manifestVersion is 1')
checkEqual(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'dsh.bundle.patch points at the bundle patch')
checkEqual(pkg.dsh?.client?.platform, 'web', 'dsh.client.platform is web')

// ---------------------------------------------------------------------- files
const exportsMap = pkg.exports ?? {}
for (const key of ['.', './client', './package.json']) {
  const target = exportsMap[key]
  check(typeof target === 'string' && existsSync(join(root, target.replace(/^\.\//, ''))), `exports["${key}"] resolves to an existing file`)
}
check(existsSync(join(root, 'icon.svg')), 'icon.svg exists')
check(pkg.icon === './icon.svg', 'manifest icon points at ./icon.svg')

function expand(pattern) {
  const segments = pattern.split('/')
  let base = ''
  for (const segment of segments) {
    const directory = join(root, base)
    if (!existsSync(directory) || !statSync(directory).isDirectory()) return []
    const entries = readdirSync(directory, { withFileTypes: true })
    if (segment.includes('*')) {
      const regex = new RegExp(`^${segment.split('*').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
      const hits = entries.filter((entry) => regex.test(entry.name)).map((entry) => entry.name)
      if (hits.length === 0) return []
      // A glob may match files at the final segment; for intermediate segments
      // only the first match matters because the rest of the tree is shared.
      if (segment !== segments[segments.length - 1]) {
        base = base === '' ? hits[0] : `${base}/${hits[0]}`
      } else {
        return hits.map((hit) => (base === '' ? hit : `${base}/${hit}`))
      }
    } else {
      if (!entries.some((entry) => entry.name === segment)) return []
      base = base === '' ? segment : `${base}/${segment}`
    }
  }
  return [base]
}

const files = Array.isArray(pkg.files) ? pkg.files : []
for (const required of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'locale/*.json', 'icon.svg', 'assets/icons/*', 'LICENSE']) {
  check(files.includes(required), `files[] declares ${required}`)
}
for (const pattern of files) {
  check(expand(pattern).length > 0, `files entry packs at least one file: ${pattern}`)
}

// ---------------------------------------------------------------- bundle patch
let patch = ''
try {
  patch = read('cordis.patch.yml')
  check(true, 'cordis.patch.yml is readable')
} catch (error) {
  check(false, `cordis.patch.yml is readable: ${error.message}`)
}
check(!patch.includes('\t'), 'cordis.patch.yml contains no tab characters')
check(/^-\s*insert:\s*$/m.test(patch), 'cordis.patch.yml inserts a bundle row')
check(/^\s*-\s*id:\s*openrouter-models\s*$/m.test(patch), 'bundle row id is openrouter-models')
check(/^\s*name:\s*['"]?dsh-openrouter-market['"]?\s*$/m.test(patch), 'bundle row name matches the package name')

const configStart = patch.search(/^ {6}config:\s*$/m)
if (configStart === -1) {
  check(false, 'bundle row declares config')
} else {
  const configLines = patch.slice(configStart).split(/\r?\n/).slice(1)
  const config = {}
  for (const line of configLines) {
    const match = /^\s{6,}([A-Za-z][A-Za-z0-9]*):\s*(\S.*?)\s*$/.exec(line)
    if (match !== null) config[match[1]] = match[2]
    else if (line.trim() !== '' && !line.startsWith(' ') && !line.startsWith('#')) break
  }
  const expected = ['apiBaseUrl', 'apiKeyEnv', 'modelsTtlMs', 'endpointsTtlMs', 'timeoutMs', 'enableRouting']
  for (const key of expected) check(Object.hasOwn(config, key), `bundle config declares ${key}`)
  checkEqual(config.enableRouting, 'true', 'bundle config enables routing by default')
  checkEqual(config.apiKeyEnv, 'OPENROUTER_API_KEY', 'bundle config requests the OPENROUTER_API_KEY credential')
}

// ------------------------------------------------------------------- locales
for (const language of ['en', 'zh']) {
  try {
    const locale = JSON.parse(read(`locale/${language}.json`))
    check(typeof locale?.meta?.title === 'string' && locale.meta.title !== '', `locale/${language}.json has meta.title`)
    check(typeof locale?.meta?.description === 'string' && locale.meta.description !== '', `locale/${language}.json has meta.description`)
  } catch (error) {
    check(false, `locale/${language}.json parses: ${error.message}`)
  }
}

// ---------------------------------------------------------------- built files
// Import the Host half: its module top level only declares functions, so a
// successful import proves the artifact parses and evaluates.
try {
  const host = await import(pathToFileURL(join(root, 'lib/index.js')).href)
  check(typeof host.apply === 'function', 'Host half parses and exports apply(ctx, config)')
  check(typeof host.name === 'string' && host.name !== '', 'Host half exports a plugin name')
} catch (error) {
  check(false, `Host half parses and exports apply: ${error.message}`)
}

// The Client half registers itself into the page module table at load time;
// stub just enough of the browser for that registration.
let clientModule = null
const previousWindow = globalThis.window
globalThis.window = {
  __ModuleLoader__: {
    load(module) {
      clientModule = module
    },
  },
}
try {
  await import(pathToFileURL(join(root, 'lib/client.js')).href)
  check(clientModule !== null, 'Client half registers through window.__ModuleLoader__')
  check(clientModule?.id === pkg.name, 'Client module id equals the package name')
  check(typeof clientModule?.factory === 'function', 'Client half registers a factory')
} catch (error) {
  check(false, `Client half loads its registration: ${error.message}`)
} finally {
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
}

const hostSource = read('lib/index.js')
check(hostSource.includes('export function apply('), 'Host half exports apply(ctx, config)')
check(hostSource.includes("JSON.stringify(value, null, 2) + '\\n'"), 'JSON writer pretty-prints human-inspected files')
check(hostSource.includes("writeJsonFile(join(dir, ROUTING_FILE), snapshot, { pretty: true })"), 'routing.json is written pretty-printed')
check(hostSource.includes('enableRouting: true'), 'code default enables routing')
check(hostSource.includes(`const VERSION = '${pkg.version}'`), 'Host VERSION constant matches package version')
const specifiers = [...hostSource.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
check(specifiers.length > 0, 'Host half imports Node built-ins')
check(specifiers.every((specifier) => specifier.startsWith('node:')), `Host half imports only node: built-ins (${specifiers.join(', ')})`)

const clientSource = read('lib/client.js')
check(clientSource.includes('window.__ModuleLoader__.load('), 'Client half registers through window.__ModuleLoader__')
check(clientSource.includes(`id: '${pkg.name}'`), 'Client module id equals the package name')
check(clientSource.includes(`const PLUGIN_VERSION = '${pkg.version}'`), 'Client PLUGIN_VERSION constant matches package version')
check(!/\bfrom\s+['"]@deepseek-ai\//.test(clientSource) && !/require\(['"]@deepseek-ai\//.test(clientSource), 'Client half imports no Harness package')

// ------------------------------------------------------------- plugin index
const indexRel = 'index.json'
if (!existsSync(join(root, indexRel))) {
  console.log('info index.json not present — plugin market index checks skipped')
} else {
  let index = null
  try {
    index = JSON.parse(read(indexRel))
    check(true, 'index.json parses as JSON')
  } catch (error) {
    check(false, `index.json parses as JSON: ${error.message}`)
  }
  if (index !== null) {
    checkEqual(index.format, 1, 'index format is 1')
    const titled = (value) => typeof value === 'string' ? value.trim() !== '' : typeof value === 'object' && value !== null && typeof value.en === 'string' && value.en !== ''
    check(titled(index.title), 'index title is localized text with en')
    check(Array.isArray(index.plugins) && index.plugins.length > 0, 'index lists at least one plugin')
    const entry = Array.isArray(index.plugins) ? index.plugins.find((plugin) => plugin?.name === pkg.name) : undefined
    check(entry !== undefined, `index lists ${pkg.name}`)
    if (entry !== undefined) {
      check(PACKAGE_NAME.test(entry.name), 'index plugin name is a valid npm package name')
      check(Array.isArray(entry.versions) && entry.versions.length > 0, 'index plugin lists versions')
      const versions = Array.isArray(entry.versions) ? entry.versions : []
      const numeric = (version) => String(version).split('-')[0].split('.').map((part) => Number(part))
      const newerThanPackage = versions.some((version) => {
        const [aMajor, aMinor, aPatch] = numeric(version?.version)
        const [bMajor, bMinor, bPatch] = numeric(pkg.version)
        return aMajor > bMajor || (aMajor === bMajor && (aMinor > bMinor || (aMinor === bMinor && aPatch > bPatch)))
      })
      check(!newerThanPackage, 'index does not advertise a version newer than the package')
      if (!versions.some((version) => version?.version === pkg.version)) {
        console.log(`info index.json does not advertise ${pkg.version} yet — the follow-up release commit updates it`)
      }
      for (const version of versions) {
        check(SEMVER.test(String(version?.version)), `index version is exact semver (${version?.version})`)
        check(Number.isInteger(version?.publishTimestamp) && version.publishTimestamp >= 0, `index version ${version?.version} has a publishTimestamp`)
        const source = version?.source ?? {}
        check(source.type === 'git' || source.type === 'npm', `index version ${version?.version} source type is git or npm`)
        if (source.type === 'git') {
          check(/^https:\/\/[^/]+\/(?:[^/]+\/)+[^/]+$/u.test(String(source.url ?? '')), `index git source URL is a canonical https repository URL (${source.url})`)
          check(/^[0-9a-f]{40}$/u.test(String(source.commit ?? '')), `index git source is commit-pinned (${source.commit})`)
        }
        if (version?.engines?.dsh !== undefined) {
          check(typeof version.engines.dsh === 'string' && version.engines.dsh.trim() !== '', 'index engines.dsh is a non-empty range string')
        }
      }
    }
  }
}

// ------------------------------------------------------------------- summary
console.log('')
if (failed === 0) {
  console.log(`PASS ${passed} checks`)
} else {
  console.error(`FAILED ${failed} of ${passed + failed} checks`)
  process.exitCode = 1
}
