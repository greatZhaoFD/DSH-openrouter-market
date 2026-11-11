/**
 * dsh-openrouter-market — Host half.
 *
 * Fetches the live OpenRouter catalog (official JSON API, no HTML scraping),
 * caches it under $DSH_HOME/storages/openrouter-models, serves it to the
 * browser half over local loopback HTTP routes, and merges chosen models into
 * `llm-pi-ai.providers.openrouter.models` through the configEditor service
 * (schema-validated, lock-serialized, atomic, rollback on failure).
 *
 * It also owns the OpenRouter routing strategies (P2): a per-model policy
 * store under the same storage directory plus a defensive `globalThis.fetch`
 * wrapper that injects the top-level `provider` routing object into chat /
 * messages request bodies addressed to the configured OpenRouter host. The
 * wrapper never rewrites a request it does not recognise and always falls
 * back to the original fetch on any error, so it cannot break a conversation.
 *
 * Deliberately dependency-free and defensive: every handler answers a JSON
 * envelope instead of throwing, so a broken upstream can never take the page
 * down. Disabling this plugin leaves the profile tree untouched.
 */

import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'

export const name = 'openrouter-models'
export const inject = []

const PREFIX = '/api/openrouter-models'
const ROUTE_COUNT = 12
const VERSION = '0.2.1'
const DSH_INPUT_MODALITIES = new Set(['text', 'image'])
const INPUT_MODALITIES = new Set(['text', 'image', 'file', 'audio', 'video'])
const DAY = 24 * 60 * 60 * 1000

const ROUTING_VERSION = 1
const ROUTING_LIST_LIMIT = 100
const ROUTING_MODES = ['auto', 'sort', 'custom']
const ROUTING_SORTS = ['price', 'throughput', 'latency']
const ROUTING_FILE = 'routing.json'

const DEFAULTS = {
  apiBaseUrl: 'https://openrouter.ai/api/v1',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  modelsTtlMs: 6 * 60 * 60 * 1000,
  endpointsTtlMs: 15 * 60 * 1000,
  timeoutMs: 25000,
  enableRouting: true,
}

/**
 * The DSH home directory: an explicit $DSH_HOME wins (the Desktop app and
 * relocated runtimes set it), then the default ~/.dsh.
 */
function dshHomeDir() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
}

function resolveConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const num = (value, fallback, min) => {
    const n = Number(value)
    return Number.isFinite(n) && n >= min ? n : fallback
  }
  return {
    apiBaseUrl: typeof src.apiBaseUrl === 'string' && src.apiBaseUrl.trim() !== ''
      ? src.apiBaseUrl.trim().replace(/\/+$/, '')
      : DEFAULTS.apiBaseUrl,
    apiKeyEnv: typeof src.apiKeyEnv === 'string' && src.apiKeyEnv.trim() !== ''
      ? src.apiKeyEnv.trim()
      : DEFAULTS.apiKeyEnv,
    modelsTtlMs: num(src.modelsTtlMs, DEFAULTS.modelsTtlMs, 60 * 1000),
    endpointsTtlMs: num(src.endpointsTtlMs, DEFAULTS.endpointsTtlMs, 60 * 1000),
    timeoutMs: num(src.timeoutMs, DEFAULTS.timeoutMs, 1000),
    enableRouting: src.enableRouting === undefined ? DEFAULTS.enableRouting : src.enableRouting !== false,
  }
}

// ---------------------------------------------------------------- utilities

const numberOrNull = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Provider latency/throughput arrive as percentile objects when the request is
 * authenticated (`{ p50, p75, p90, p99 }`, milliseconds / tokens per second)
 * and as `null` when anonymous. Prefer p50 and fall back to the other rungs so
 * the table shows the same number the OpenRouter website shows.
 */
const percentileOrNull = (value) => {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') {
    for (const key of ['p50', 'p75', 'p90', 'p99', 'mean']) {
      const n = Number(value[key])
      if (Number.isFinite(n) && n > 0) return n
    }
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Latency is reported in milliseconds; the UI speaks seconds. */
const latencySecondsOrNull = (value) => {
  const n = percentileOrNull(value)
  if (n === null) return null
  return Number((n > 100 ? n / 1000 : n).toPrecision(4))
}

const PRICING_SCHEMA = 3

function priceNumber(value) {
  if ((typeof value !== 'string' || value.trim() === '') && typeof value !== 'number') return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

function normalizePricing(pricing, modelId) {
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) return null
  const perMillion = (value) => {
    const amount = priceNumber(value)
    const scaled = amount === null ? null : amount * 1e6
    return Number.isFinite(scaled) ? Number(scaled.toPrecision(6)) : null
  }
  // OpenRouter exposes this transcription model's USD/second rate as prompt.
  const baseModel = modelId?.split(':')[0]
  const audioByTime = baseModel === 'meta/muse-voice-transcribe-1.0'
  const prompt = audioByTime ? null : perMillion(pricing.prompt)
  const completion = perMillion(pricing.completion)
  const cacheRead = audioByTime ? null : perMillion(pricing.input_cache_read ?? pricing.prompt)
  const rawDiscount = priceNumber(pricing.discount)
  const discount = rawDiscount > 0 && rawDiscount < 1 ? Math.round(rawDiscount * 100) : 0
  const priceFields = Object.keys(pricing).filter((key) => key !== 'discount' && key !== 'overrides')
  const rawPrices = Object.fromEntries(priceFields
    .filter((key) => priceNumber(pricing[key]) !== null)
    .map((key) => [key, pricing[key]]))
  const hasConditionalCharges = Array.isArray(pricing.overrides) && pricing.overrides.length > 0
  return {
    prompt,
    completion,
    cacheRead,
    perRequest: priceNumber(pricing.request),
    perImage: priceNumber(pricing.image),
    rawPrices,
    isFree: !hasConditionalCharges && priceFields.length > 0 && priceFields.every((key) => priceNumber(pricing[key]) === 0),
    discount,
  }
}

function cleanDescription(text) {
  if (typeof text !== 'string') return ''
  const plain = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > 400 ? plain.slice(0, 400) + '…' : plain
}

function modalList(value, fallback) {
  if (!Array.isArray(value)) return fallback
  const out = value.filter((item) => typeof item === 'string' && INPUT_MODALITIES.has(item))
  return out.length > 0 ? out : fallback
}

// ------------------------------------------------------- routing strategies

/** An empty on-disk routing document. Corrupt files resolve to this shape. */
function emptyRouting() {
  return { version: ROUTING_VERSION, updatedAt: null, strategies: {} }
}

/**
 * Normalise one string list from the strategy body: trim, drop empties, drop
 * duplicates. Returns null when a member is not a string, and the caller
 * rejects arrays longer than {@link ROUTING_LIST_LIMIT} before this runs so a
 * too-long list is an error rather than a silent truncation.
 */
function normalizeRoutingList(value) {
  const out = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    const trimmed = item.trim()
    if (trimmed === '' || out.includes(trimmed)) continue
    out.push(trimmed)
  }
  return out
}

/**
 * Validate and canonicalise one stored strategy. Every field is optional
 * except `mode` semantics: an unknown mode/sort, a non-string list member, a
 * list over the cap, or a negative max price is rejected with a message the
 * route returns as `BAD_REQUEST`; unknown fields are dropped, never stored.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function normalizeRoutingStrategy(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const mode = src.mode === undefined || src.mode === null ? 'auto' : src.mode
  if (typeof mode !== 'string' || !ROUTING_MODES.includes(mode)) {
    return { ok: false, error: `mode must be one of ${ROUTING_MODES.join(', ')}` }
  }
  let sort
  if (src.sort !== undefined && src.sort !== null) {
    if (typeof src.sort !== 'string' || !ROUTING_SORTS.includes(src.sort)) {
      return { ok: false, error: `sort must be one of ${ROUTING_SORTS.join(', ')}` }
    }
    sort = src.sort
  }
  // Only `mode: 'sort'` consumes a strategy sort; canonicalise so a stored
  // document never claims a sort the injector would silently drop.
  sort = mode === 'sort' ? (sort === undefined ? 'price' : sort) : undefined
  const lists = {}
  for (const key of ['order', 'only', 'ignore', 'quantizations']) {
    const value = src[key]
    if (value === undefined || value === null) {
      lists[key] = []
      continue
    }
    if (!Array.isArray(value)) return { ok: false, error: `${key} must be an array of strings` }
    if (value.length > ROUTING_LIST_LIMIT) {
      return { ok: false, error: `${key} accepts at most ${ROUTING_LIST_LIMIT} entries` }
    }
    const normalized = normalizeRoutingList(value)
    if (normalized === null) return { ok: false, error: `${key} must contain only strings` }
    lists[key] = normalized
  }
  const maxPrice = { prompt: null, completion: null, request: null, image: null }
  if (src.maxPrice !== undefined && src.maxPrice !== null) {
    if (typeof src.maxPrice !== 'object' || Array.isArray(src.maxPrice)) {
      return { ok: false, error: 'maxPrice must be an object with prompt/completion/request/image numbers' }
    }
    for (const key of ['prompt', 'completion', 'request', 'image']) {
      const value = src.maxPrice[key]
      if (value === undefined || value === null || (src.routingVersion !== 2 && Number(value) === 0)) continue
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, error: `maxPrice.${key} must be a non-negative number` }
      }
      maxPrice[key] = n
    }
  }
  const controls = {}
  for (const key of ['requireParameters', 'zdr', 'enforceDistillableText']) {
    if (src[key] !== undefined && typeof src[key] !== 'boolean') return { ok: false, error: key + ' must be a boolean' }
    controls[key] = src[key] === true
  }
  if (src.dataCollection !== undefined && !['allow', 'deny'].includes(src.dataCollection)) {
    return { ok: false, error: 'dataCollection must be allow or deny' }
  }
  controls.dataCollection = src.dataCollection ?? 'allow'
  for (const key of ['preferredMinThroughput', 'preferredMaxLatency']) {
    const value = src[key] ?? null
    if (value !== null && (!Number.isFinite(value) || value < 0)) return { ok: false, error: key + ' must be a non-negative number' }
    controls[key] = value
  }
  const allowFallbacks = src.allowFallbacks === undefined ? true : src.allowFallbacks
  if (typeof allowFallbacks !== 'boolean') return { ok: false, error: 'allowFallbacks must be a boolean' }
  const enabled = src.enabled === undefined ? true : src.enabled
  if (typeof enabled !== 'boolean') return { ok: false, error: 'enabled must be a boolean' }
  return {
    ok: true,
    value: {
      routingVersion: 2,
      ...controls,
      mode,
      ...sort === undefined ? {} : { sort },
      order: lists.order,
      only: lists.only,
      ignore: lists.ignore,
      allowFallbacks,
      quantizations: lists.quantizations,
      maxPrice,
      enabled: enabled && (src.routingVersion === 2 || mode !== 'auto'),
    },
  }
}

/** Translate a saved strategy into OpenRouter provider preferences. */
function providerPatchFor(strategy) {
  if (!strategy || strategy.enabled === false) return null
  const patch = {}
  if (strategy.mode === 'sort') patch.sort = strategy.sort
  if (strategy.mode === 'custom' && strategy.order.length > 0) patch.order = [...strategy.order]
  for (const key of ['only', 'ignore', 'quantizations']) {
    if (strategy[key].length > 0) patch[key] = [...strategy[key]]
  }
  if (strategy.requireParameters) patch.require_parameters = true
  if (strategy.dataCollection === 'deny') patch.data_collection = 'deny'
  if (strategy.zdr) patch.zdr = true
  if (strategy.enforceDistillableText) patch.enforce_distillable_text = true
  if (strategy.allowFallbacks === false) patch.allow_fallbacks = false
  if (strategy.mode !== 'custom') {
    if (strategy.preferredMinThroughput !== null) patch.preferred_min_throughput = strategy.preferredMinThroughput
    if (strategy.preferredMaxLatency !== null) patch.preferred_max_latency = strategy.preferredMaxLatency
  }
  const maxPrice = {}
  for (const key of ['prompt', 'completion', 'request', 'image']) {
    if (strategy.maxPrice[key] !== null) maxPrice[key] = strategy.maxPrice[key]
  }
  if (Object.keys(maxPrice).length > 0) patch.max_price = maxPrice
  return Object.keys(patch).length > 0 ? patch : null
}

/**
 * Merge a strategy patch under the caller's own `provider` object. The
 * caller's explicit choices win for every key except `sort`, where a strategy
 * conflict is reported and resolved in favour of the strategy (a sort the
 * user set in the plugin is the newer, more explicit decision).
 */
function mergeProviderPatch(payload, patch, log, modelId) {
  const existing = payload.provider && typeof payload.provider === 'object' && !Array.isArray(payload.provider)
    ? payload.provider
    : {}
  const merged = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'sort' && merged.sort !== undefined && merged.sort !== value) {
      log.warn(`routing: strategy sort "${value}" overrides caller sort "${String(merged.sort)}" for ${modelId}`)
      merged.sort = value
      continue
    }
    if (merged[key] === undefined) merged[key] = value
  }
  payload.provider = merged
  return merged
}

/** Rebuild a request header set with a content length matching the new body. */
function withContentLength(headers, length) {
  const out = new Headers(headers)
  out.set('content-length', String(length))
  return out
}

/** Whether a value is a fetch `Request` (duck-typed; no DOM types assumed). */
const isRequest = (value) => {
  try {
    return typeof Request !== 'undefined' && value instanceof Request
  } catch {
    return false
  }
}

/** Decode a non-stream body we can safely inspect. Returns null otherwise. */
function bodyTextOf(body) {
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8')
  if (typeof SharedArrayBuffer !== 'undefined' && body instanceof SharedArrayBuffer) return null
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf8')
  return null
}

/** Host of the configured OpenRouter base URL; empty string when unparsable. */
function hostOf(apiBaseUrl) {
  try {
    return new URL(apiBaseUrl).host
  } catch {
    return ''
  }
}

/**
 * Decide what to do with one fetch call. Never throws for a call it does not
 * own; a JSON parse failure on a body it does own throws so the wrapper counts
 * it as `failed` and falls back to the original fetch.
 * @returns {{ kind: 'pass' } | { kind: 'skip' } | { kind: 'inject', input, init }}
 */
async function prepareRoutingRequest(hub, config, baseHost, input, init, log) {
  const method = String((init && init.method) || (isRequest(input) ? input.method : 'GET')).toUpperCase()
  if (method !== 'POST') return { kind: 'pass' }
  const url = isRequest(input) ? input.url : String(input)
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { kind: 'pass' }
  }
  if (baseHost === '' || parsed.host !== baseHost) return { kind: 'pass' }
  const path = parsed.pathname
  if (!path.endsWith('/chat/completions') && !path.endsWith('/messages')) return { kind: 'pass' }

  let text = null
  let fromRequest = false
  if (init && init.body !== undefined) {
    text = bodyTextOf(init.body)
    if (text === null) return { kind: 'skip' } // stream / FormData / Blob: never touch
  } else if (isRequest(input)) {
    if (input.bodyUsed) return { kind: 'skip' }
    if (input.body === null) return { kind: 'skip' }
    if (init && String(init.duplex || '') === 'half') return { kind: 'skip' }
    const clone = input.clone()
    text = await clone.text()
    fromRequest = true
  } else {
    return { kind: 'pass' }
  }
  if (typeof text !== 'string' || text === '') return { kind: 'skip' }

  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('request body is not valid JSON')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { kind: 'skip' }
  const modelId = typeof payload.model === 'string' ? payload.model : ''
  if (modelId === '') return { kind: 'skip' }

  const store = await hub.loadRouting()
  const strategy = store.strategies[modelId]
  if (!strategy) return { kind: 'skip' }
  const patch = providerPatchFor(strategy)
  if (!patch) return { kind: 'skip' }
  mergeProviderPatch(payload, patch, log, modelId)

  const body = JSON.stringify(payload)
  if (fromRequest) {
    const headers = new Headers(input.headers)
    headers.delete('content-length')
    const nextInit = { ...(init || {}), headers, body }
    delete nextInit.duplex
    return { kind: 'inject', input: new Request(input, nextInit), init: undefined }
  }
  const nextInit = { ...(init || {}), body }
  if (init && init.headers !== undefined) nextInit.headers = withContentLength(init.headers, Buffer.byteLength(body))
  return { kind: 'inject', input, init: nextInit }
}

/**
 * Install the routing fetch wrapper and return its disposer.
 *
 * The wrapper only ever rewrites a POST to the configured OpenRouter host on
 * `/chat/completions` or `/messages`; everything else is forwarded untouched.
 * Preparation runs before the original fetch so a failure can never re-send a
 * request that already reached the network. The disposer restores
 * `globalThis.fetch` only when it still points at this wrapper, so a later
 * patch by another plugin is never clobbered.
 */
function installRoutingFetch({ hub, config, originalFetch, log }) {
  const counters = hub.injection
  const baseHost = hostOf(config.apiBaseUrl)
  const wrapper = async function openrouterModelsRoutingFetch(input, init) {
    if (!counters.enabled) return originalFetch(input, init)
    let outcome
    try {
      outcome = await prepareRoutingRequest(hub, config, baseHost, input, init, log)
    } catch (error) {
      counters.failed += 1
      log.warn(`routing: injection skipped, forwarding original request (${error instanceof Error ? error.message : String(error)})`)
      return originalFetch(input, init)
    }
    if (!outcome || outcome.kind === 'pass') return originalFetch(input, init)
    if (outcome.kind === 'skip') {
      counters.skipped += 1
      return originalFetch(input, init)
    }
    counters.injected += 1
    return originalFetch(outcome.input, outcome.init)
  }
  globalThis.fetch = wrapper
  counters.enabled = true
  return function restore() {
    counters.enabled = false
    if (globalThis.fetch === wrapper) globalThis.fetch = originalFetch
  }
}

function normalizeModel(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || raw.id === '') return null
  const architecture = raw.architecture && typeof raw.architecture === 'object' ? raw.architecture : {}
  const topProvider = raw.top_provider && typeof raw.top_provider === 'object' ? raw.top_provider : null
  const pricing = normalizePricing(raw.pricing, raw.id)
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : raw.id,
    author: raw.id.split('/')[0] || '',
    canonicalSlug: typeof raw.canonical_slug === 'string' && raw.canonical_slug !== '' ? raw.canonical_slug : raw.id,
    created: Number(raw.created) || 0,
    contextWindow: Number(raw.context_length) || 0,
    maxTokens: topProvider ? numberOrNull(topProvider.max_completion_tokens) : null,
    input: modalList(architecture.input_modalities, ['text']),
    output: Array.isArray(architecture.output_modalities)
      ? architecture.output_modalities.filter((item) => typeof item === 'string')
      : ['text'],
    pricing,
    supportedParameters: Array.isArray(raw.supported_parameters)
      ? raw.supported_parameters.filter((item) => typeof item === 'string')
      : [],
    description: cleanDescription(raw.description),
    topProvider: topProvider
      ? {
        name: typeof topProvider.name === 'string' ? topProvider.name : null,
        contextWindow: numberOrNull(topProvider.context_length),
        maxCompletionTokens: numberOrNull(topProvider.max_completion_tokens),
      }
      : null,
    isFree: pricing?.isFree === true,
    expirationDate: typeof raw.expiration_date === 'string' ? raw.expiration_date : null,
    knowledgeCutoff: typeof raw.knowledge_cutoff === 'string' ? raw.knowledge_cutoff : null,
    moderated: topProvider !== null && topProvider.is_moderated === true,
    distillableText: typeof raw.enforce_distillable_text === 'boolean' ? raw.enforce_distillable_text
      : typeof raw.is_distillable_text === 'boolean' ? raw.is_distillable_text : null,
    benchmark: (() => {
      const analysis = raw.benchmarks && raw.benchmarks.artificial_analysis
      if (!analysis || typeof analysis !== 'object') return null
      const pick = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
      const intelligence = pick(analysis.intelligence_index)
      if (intelligence === null) return null
      return {
        intelligence,
        coding: pick(analysis.coding_index),
        agentic: pick(analysis.agentic_index),
      }
    })(),
  }
}

function normalizeEndpoint(raw, modelId) {
  if (!raw || typeof raw !== 'object') return null
  const providerName = typeof raw.provider_name === 'string' && raw.provider_name !== ''
    ? raw.provider_name
    : (typeof raw.name === 'string' ? raw.name.split('|')[0].trim() : 'unknown')
  return {
    providerName,
    name: typeof raw.name === 'string' ? raw.name : providerName,
    tag: typeof raw.tag === 'string' ? raw.tag : null,
    quantization: typeof raw.quantization === 'string' ? raw.quantization : null,
    zdr: typeof raw.zdr === 'boolean' ? raw.zdr : null,
    dataCollection: ['allow', 'deny'].includes(raw.data_collection) ? raw.data_collection : null,
    serviceTier: typeof raw.service_tier === 'string' ? raw.service_tier : null,
    contextLength: numberOrNull(raw.context_length),
    maxCompletionTokens: numberOrNull(raw.max_completion_tokens),
    pricing: normalizePricing(raw.pricing, modelId),
    uptimeLast30m: numberOrNull(raw.uptime_last_30m),
    uptimeLast5m: numberOrNull(raw.uptime_last_5m),
    uptimeLast1d: numberOrNull(raw.uptime_last_1d),
    latencyLast30m: latencySecondsOrNull(raw.latency_last_30m),
    throughputLast30m: percentileOrNull(raw.throughput_last_30m),
    throughputP50: percentileOrNull(raw.throughput_last_30m?.p50 ?? (typeof raw.throughput_last_30m === 'number' ? raw.throughput_last_30m : null)),
    latencyP50: latencySecondsOrNull(raw.latency_last_30m?.p50 ?? (typeof raw.latency_last_30m === 'number' ? raw.latency_last_30m : null)),
    status: numberOrNull(raw.status),
    supportsImplicitCaching: raw.supports_implicit_caching === true,
  }
}

function safeSlug(slug) {
  return String(slug).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)
}

const isLoopback = (req) => {
  const address = req && req.socket ? req.socket.remoteAddress : ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** VSCode executable on Windows, when installed (PATH, LOCALAPPDATA or Program Files). */
function findWindowsEditor() {
  const candidates = []
  try {
    for (const dir of String(process.env.PATH || '').split(';')) {
      const trimmed = dir.trim()
      if (trimmed === '') continue
      candidates.push(join(trimmed, 'Code.exe'))
      candidates.push(join(trimmed, '..', 'Code.exe'))
    }
  } catch { /* PATH lookup is best effort */ }
  for (const root of [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (typeof root === 'string' && root !== '') {
      candidates.push(join(root, 'Programs', 'Microsoft VS Code', 'Code.exe'))
      candidates.push(join(root, 'Microsoft VS Code', 'Code.exe'))
    }
  }
  for (const candidate of candidates) {
    try { if (existsSync(candidate)) return candidate } catch { /* keep looking */ }
  }
  return null
}

/** Electron child processes inherit ELECTRON_RUN_AS_NODE; strip it so an editor GUI starts normally. */
function editorEnvironment() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  return env
}

/**
 * Open a local file. On Windows this prefers the editor over the file association:
 * .yml/.json usually have no default handler, and ELECTRON_RUN_AS_NODE inherited
 * from the host process would make Code.exe run as Node instead of the GUI.
 */
function openLocalFile(target) {
  const platform = process.platform
  let command = ''
  let args = []
  let opener = 'default'
  if (platform === 'win32') {
    const editor = findWindowsEditor()
    if (editor !== null) {
      command = editor
      args = [target]
      opener = 'vscode'
    } else {
      command = 'cmd.exe'
      args = ['/d', '/c', 'start', '', target]
      opener = 'shell'
    }
  } else if (platform === 'darwin') {
    command = 'open'
    args = [target]
  } else {
    command = 'xdg-open'
    args = [target]
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    let child = null
    try {
      child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, env: editorEnvironment() })
    } catch (error) {
      finish({ ok: false, message: error instanceof Error ? error.message : String(error) })
      return
    }
    child.once('error', (error) => finish({ ok: false, message: error instanceof Error ? error.message : String(error) }))
    child.once('spawn', () => {
      try { child.unref() } catch { /* detached already */ }
      finish({ ok: true, opener })
    })
    setTimeout(() => finish({ ok: true, opener }), 1500)
  })
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

const ok = (res, value) => sendJson(res, 200, { ok: true, value })
const fail = (res, code, message) => sendJson(res, 200, { ok: false, error: { code, message: String(message || '') } })

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// ------------------------------------------------------------------ service

function createHub(ctx, config) {
  const log = (() => {
    try {
      const logger = typeof ctx.logger === 'function' ? ctx.logger('openrouter-models') : undefined
      return {
        info: (message) => { try { logger?.info?.(message) } catch { /* logging never throws */ } },
        warn: (message) => { try { logger?.warn?.(message) } catch { /* logging never throws */ } },
      }
    } catch {
      return { info() {}, warn() {} }
    }
  })()

  const dir = (() => {
    try {
      if (typeof ctx.dshHomePath === 'function') {
        const resolved = ctx.dshHomePath('storages', 'openrouter-models')
        if (typeof resolved === 'string' && resolved !== '') return resolved
      }
    } catch { /* fall through */ }
    return join(dshHomeDir(), 'storages', 'openrouter-models')
  })()

  let modelsCache = null // { fetchedAt, models }
  let lastError = null
  const endpointCache = new Map() // slug -> { fetchedAt, value }
  const endpointInflight = new Map() // slug -> Promise
  const state = { get: () => modelsCache }

  // Routing policy store (routing.json) and request-injection diagnostics.
  let routingStore = null
  let routingWrites = Promise.resolve()
  const injection = { enabled: false, injected: 0, skipped: 0, failed: 0 }

  async function loadRouting() {
    if (routingStore !== null) return routingStore
    const path = join(dir, ROUTING_FILE)
    // Read the text as well as the value: an earlier version of this plugin
    // stored routing.json minified, which is painful to inspect by hand. If the
    // on-disk document has no newline, rewrite it once in the readable form
    // (see writeJsonFile's `pretty` option) before returning.
    let text = null
    try { text = await readFile(path, 'utf8') } catch { text = null }
    let raw = null
    if (typeof text === 'string' && text !== '') {
      try { raw = JSON.parse(text) } catch { raw = null }
    }
    const store = emptyRouting()
    if (raw && raw.strategies && typeof raw.strategies === 'object' && !Array.isArray(raw.strategies)) {
      for (const [modelId, strategy] of Object.entries(raw.strategies)) {
        if (typeof modelId !== 'string' || modelId === '') continue
        const normalized = normalizeRoutingStrategy(strategy)
        if (normalized.ok) store.strategies[modelId] = normalized.value
      }
      store.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null
    }
    routingStore = store
    if (typeof text === 'string' && !text.includes('\n')) {
      try {
        await writeJsonFile(path, {
          version: ROUTING_VERSION,
          updatedAt: store.updatedAt,
          strategies: store.strategies,
        }, { pretty: true })
      } catch { /* readability rewrite is best effort */ }
    }
    return store
  }

  async function saveRouting(store) {
    const snapshot = {
      version: ROUTING_VERSION,
      updatedAt: new Date().toISOString(),
      strategies: store.strategies,
    }
    const wrote = await writeJsonFile(join(dir, ROUTING_FILE), snapshot, { pretty: true })
    if (!wrote) throw new Error(`routing strategy file could not be written at ${join(dir, ROUTING_FILE)}`)
    routingStore = snapshot
    return snapshot
  }

  function updateRouting(update) {
    const write = routingWrites.then(async () => {
      const current = await loadRouting()
      const next = update(current)
      return next === current ? current : saveRouting(next)
    })
    routingWrites = write.catch(() => {})
    return write
  }

  async function ensureDir() {
    try { await mkdir(dir, { recursive: true }) } catch { /* best effort */ }
  }

  async function readJsonFile(path) {
    try {
      const text = await readFile(path, 'utf8')
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }

  async function writeJsonFile(path, value, options = {}) {
    await ensureDir()
    // Human-inspected documents (routing.json, host-alive.json) are written
    // pretty-printed with two-space indentation and a trailing newline; caches
    // stay minified so large model catalogues are not inflated.
    const text = options.pretty === true
      ? JSON.stringify(value, null, 2) + '\n'
      : JSON.stringify(value)
    const tmp = path + '.tmp'
    try {
      await writeFile(tmp, text, 'utf8')
      try {
        const { rename } = await import('node:fs/promises')
        await rename(tmp, path)
      } catch {
        await writeFile(path, text, 'utf8')
      }
      return true
    } catch (error) {
      log.warn(`cache write failed for ${path}: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  async function resolveApiKey() {
    const ref = config.apiKeyEnv
    if (!ref) return null
    try {
      const credentials = ctx.get('credentials')
      if (credentials && typeof credentials.resolve === 'function') {
        const resolved = await credentials.resolve(ref)
        const value = resolved && (resolved.value ?? resolved.secret ?? resolved.key)
        if (typeof value === 'string' && value !== '') return value
      }
    } catch { /* fall back to the environment */ }
    const fromEnv = process.env[ref]
    return typeof fromEnv === 'string' && fromEnv !== '' ? fromEnv : null
  }

  async function fetchJson(url) {
    const headers = { accept: 'application/json', 'user-agent': `dsh-openrouter-market/${VERSION}` }
    const key = await resolveApiKey()
    if (key) headers.authorization = `Bearer ${key}`
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(config.timeoutMs) })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} from ${url}${detail ? ': ' + detail.slice(0, 300) : ''}`)
    }
    return response.json()
  }

  async function refreshModels() {
    const payload = await fetchJson(`${config.apiBaseUrl}/models?output_modalities=all`)
    const rows = Array.isArray(payload?.data) ? payload.data : []
    const models = rows.map(normalizeModel).filter((model) => model !== null)
    models.sort((a, b) => a.name.localeCompare(b.name))
    modelsCache = { fetchedAt: Date.now(), models }
    lastError = null
    await writeJsonFile(join(dir, 'models.json'), { pricingSchema: PRICING_SCHEMA, fetchedAt: modelsCache.fetchedAt, models })
    log.info(`catalog refreshed: ${models.length} models`)
    return modelsCache
  }

  async function loadModelsFromDisk() {
    const cached = await readJsonFile(join(dir, 'models.json'))
    if (cached?.pricingSchema === PRICING_SCHEMA && Array.isArray(cached.models) && cached.models.length > 0 && Number.isFinite(cached.fetchedAt)) {
      modelsCache = { fetchedAt: cached.fetchedAt, models: cached.models }
      return modelsCache
    }
    return null
  }

  async function getModels({ refresh = false } = {}) {
    if (!modelsCache) await loadModelsFromDisk()
    const now = Date.now()
    const fresh = modelsCache !== null && now - modelsCache.fetchedAt < config.modelsTtlMs
    if (!refresh && fresh) return { cache: modelsCache, source: 'cache', stale: false }
    try {
      const cache = await refreshModels()
      return { cache, source: 'live', stale: false }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastError = { code: 'UPSTREAM_FAILED', message }
      log.warn(`catalog refresh failed: ${message}`)
      if (modelsCache !== null) {
        return { cache: modelsCache, source: 'cache', stale: true, error: message }
      }
      throw error
    }
  }

  async function getEndpoints(slug, refresh = false) {
    const now = Date.now()
    const cached = endpointCache.get(slug)
    if (!refresh && cached && now - cached.fetchedAt < config.endpointsTtlMs) {
      return { value: cached.value, cachedAt: cached.fetchedAt, stale: false }
    }
    const onDisk = cached || await readJsonFile(join(dir, `endpoints-${safeSlug(slug)}.json`))
    if (onDisk?.pricingSchema === PRICING_SCHEMA && Number.isFinite(onDisk.fetchedAt) && onDisk.value) {
      endpointCache.set(slug, { fetchedAt: onDisk.fetchedAt, value: onDisk.value })
      if (!refresh && now - onDisk.fetchedAt < config.endpointsTtlMs) return { value: onDisk.value, cachedAt: onDisk.fetchedAt, stale: false }
    }
    const inflight = endpointInflight.get(slug)
    if (inflight) return inflight

    const promise = (async () => {
      const [author, ...rest] = slug.split('/')
      const path = rest.length > 0
        ? `${config.apiBaseUrl}/models/${encodeURIComponent(author)}/${encodeURIComponent(rest.join('/'))}/endpoints`
        : `${config.apiBaseUrl}/models/${encodeURIComponent(author)}/endpoints`
      const payload = await fetchJson(path)
      const data = payload && typeof payload === 'object' && payload.data ? payload.data : payload
      const endpoints = (Array.isArray(data?.endpoints) ? data.endpoints : [])
        .map((endpoint) => normalizeEndpoint(endpoint, slug))
        .filter((endpoint) => endpoint !== null)
      endpoints.sort((a, b) => {
        const left = a.pricing?.prompt ?? Number.POSITIVE_INFINITY
        const right = b.pricing?.prompt ?? Number.POSITIVE_INFINITY
        return left - right
      })
      let countries = new Map()
      try {
        countries = await loadProviderSites()
      } catch { countries = new Map() }
      for (const endpoint of endpoints) {
        const key = String(endpoint.providerName || '').trim().toLowerCase()
        const entry = countries.get(key)
        endpoint.country = entry && entry.country ? entry.country : null
        // OpenRouter's provider routing expects its own slug ("google-ai-studio"),
        // not a name-derived one, so the browser keys order/only by this value.
        endpoint.providerSlug = entry && entry.slug ? entry.slug : null
      }
      const value = {
        modelId: typeof data?.id === 'string' ? data.id : slug,
        modelName: typeof data?.name === 'string' ? data.name : slug,
        endpoints,
      }
      const fetchedAt = Date.now()
      const record = { pricingSchema: PRICING_SCHEMA, fetchedAt, value }
      endpointCache.set(slug, record)
      await writeJsonFile(join(dir, 'endpoints-' + safeSlug(slug) + '.json'), record)
      return { value, cachedAt: fetchedAt, stale: false }
    })().catch((error) => {
      const stale = endpointCache.get(slug)
      if (!stale) throw error
      return {
        value: stale.value, cachedAt: stale.fetchedAt, stale: true,
        error: error instanceof Error ? error.message : String(error),
      }
    })

    endpointInflight.set(slug, promise)
    try {
      return await promise
    } finally {
      endpointInflight.delete(slug)
    }
  }

  function findPiAiEntry() {
    const editor = ctx.get('configEditor')
    if (!editor || typeof editor.entries !== 'function') return { editor: null, entry: null }
    let entries = []
    try { entries = editor.entries() || [] } catch { entries = [] }
    const entry = entries.find((candidate) => {
      const options = candidate && candidate.options ? candidate.options : {}
      return options.id === 'llm-pi-ai' || options.name === '@deepseek-ai/dsh-llm-pi-ai'
    })
    return { editor, entry: entry || null }
  }

  function readOpenRouterRoute(entry) {
    try {
      const config = entry && entry.options && entry.options.config
      const providers = config && config.providers
      const route = providers && providers.openrouter
      return route && typeof route === 'object' ? route : null
    } catch {
      return null
    }
  }

  function describeInstalled(entry) {
    const route = readOpenRouterRoute(entry)
    if (route === null) return { route: 'openrouter', configured: false, apiKeyEnv: null, count: 0, models: [] }
    const models = (Array.isArray(route.models) ? route.models : [])
      .filter((model) => model && typeof model.id === 'string')
      .map((model) => ({
        id: model.id,
        name: typeof model.name === 'string' ? model.name : model.id,
        contextWindow: numberOrNull(model.contextWindow),
        maxTokens: numberOrNull(model.maxTokens),
        input: Array.isArray(model.input) ? model.input : [],
      }))
    return {
      route: 'openrouter',
      configured: true,
      apiKeyEnv: typeof route.apiKeyEnv === 'string' ? route.apiKeyEnv : null,
      count: models.length,
      models,
    }
  }

  let writeChain = Promise.resolve()
  function serialize(operation) {
    const run = writeChain.then(operation, operation)
    writeChain = run.then(() => undefined, () => undefined)
    return run
  }

  async function backupProfilePatch(editor) {
    try {
      const path = editor.documentPath
      if (typeof path !== 'string' || path === '' || !existsSync(path)) return null
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const target = join(dshHomeDir(), 'config_backups', 'openrouter-models', `${stamp}.yml`)
      await mkdir(join(dshHomeDir(), 'config_backups', 'openrouter-models'), { recursive: true })
      await copyFile(path, target)
      return target
    } catch {
      return null
    }
  }

  function toDshModel(incoming, catalogById) {
    const catalog = catalogById.get(incoming.id) || null
    const model = { id: incoming.id }
    const name = typeof incoming.name === 'string' && incoming.name !== ''
      ? incoming.name
      : (catalog ? catalog.name : incoming.id)
    model.name = name
    const contextWindow = Number(incoming.contextWindow) > 0
      ? Math.floor(Number(incoming.contextWindow))
      : (catalog && catalog.contextWindow > 0 ? catalog.contextWindow : 0)
    if (contextWindow > 0) model.contextWindow = contextWindow
    const maxTokens = Number(incoming.maxTokens) > 0
      ? Math.floor(Number(incoming.maxTokens))
      : (catalog && catalog.maxTokens ? catalog.maxTokens : 0)
    if (maxTokens > 0) model.maxTokens = maxTokens
    // The DSH route schema is narrower than OpenRouter's model catalog.
    const supported = (input) => Array.isArray(input) ? input.filter((item) => DSH_INPUT_MODALITIES.has(item)) : []
    const input = supported(incoming.input)
    const catalogInput = supported(catalog?.input)
    model.input = input.length ? input : catalogInput.length ? catalogInput : ['text']
    return model
  }

  async function importModels(incomingModels) {
    const { editor, entry } = findPiAiEntry()
    if (!editor || typeof editor.edit !== 'function') {
      return { ok: false, code: 'NO_EDITOR', message: 'configEditor service is unavailable in this profile; the model list cannot be saved' }
    }
    if (!entry) {
      return { ok: false, code: 'NO_ENTRY', message: 'llm-pi-ai entry was not found in the profile patch; add it before importing models' }
    }

    const catalogResult = await getModels({ refresh: false }).catch(() => null)
    const catalogById = new Map(catalogResult ? catalogResult.cache.models.map((model) => [model.id, model]) : [])

    const incoming = []
    const skipped = []
    const warnings = []
    for (const candidate of incomingModels) {
      if (!candidate || typeof candidate.id !== 'string' || candidate.id.trim() === '') {
        skipped.push({ id: null, reason: 'missing id' })
        continue
      }
      const id = candidate.id.trim()
      if (incoming.some((model) => model.id === id)) continue
      incoming.push({ ...candidate, id })
    }
    if (incoming.length === 0) return { ok: false, code: 'NO_MODELS', message: 'no valid models were provided' }

    const backupPath = await backupProfilePatch(editor)
    const added = []
    const updated = []

    function editModels(useChatCompletions = false) {
      return editor.edit(entry, (current) => {
        const next = current && typeof current === 'object' ? structuredClone(current) : {}
        const providers = next.providers && typeof next.providers === 'object' ? next.providers : {}
        const route = providers.openrouter && typeof providers.openrouter === 'object'
          ? providers.openrouter
          : { apiKeyEnv: config.apiKeyEnv }
        const existing = Array.isArray(route.models) ? route.models.slice() : []
        if (useChatCompletions && route.api == null) {
          // This is a route-wide override in DSH. Preserve existing Claude
          // models that may be using the catalog's native Messages protocol.
          if (existing.some((model) => model?.id?.startsWith('anthropic/'))) {
            throw new Error('OpenRouter includes existing Anthropic models. Set the route API explicitly before importing a model absent from the DSH catalog.')
          }
          route.api = 'openai-completions'
        }
        added.length = 0
        updated.length = 0
        for (const candidate of incoming) {
          const mapped = toDshModel(candidate, catalogById)
          const index = existing.findIndex((model) => model && model.id === mapped.id)
          if (index >= 0) {
            const previous = existing[index]
            existing[index] = { ...previous, ...mapped }
            updated.push(mapped.id)
          } else {
            existing.push(mapped)
            added.push(mapped.id)
          }
        }
        route.models = existing
        providers.openrouter = route
        next.providers = providers
        return JSON.parse(JSON.stringify(next))
      })
    }

    try {
      try {
        await editModels()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/^llm-pi-ai: provider "openrouter" model "[^"]+" needs an api;/.test(message)) throw error
        await editModels(true)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        code: 'WRITE_REJECTED',
        message,
        value: { added, updated, skipped, warnings, backupPath },
      }
    }

    const installed = describeInstalled(entry)
    return {
      ok: true,
      value: {
        added,
        updated,
        skipped,
        warnings,
        total: installed.count,
        cachedAt: modelsCache ? modelsCache.fetchedAt : null,
        backupPath,
      },
    }
  }

  async function removeModels(modelIds) {
    const { editor, entry } = findPiAiEntry()
    if (!editor || typeof editor.edit !== 'function') {
      return { ok: false, code: 'NO_EDITOR', message: 'configEditor service is unavailable in this profile; the model list cannot be changed' }
    }
    if (!entry) {
      return { ok: false, code: 'NO_ENTRY', message: 'llm-pi-ai entry was not found in the profile patch' }
    }
    const ids = [...new Set((Array.isArray(modelIds) ? modelIds : [])
      .filter((id) => typeof id === 'string' && id.trim() !== '')
      .map((id) => id.trim()))]
    if (ids.length === 0) return { ok: false, code: 'NO_MODELS', message: 'no model ids were provided' }

    const backupPath = await backupProfilePatch(editor)
    const removed = []
    const missing = []
    try {
      await editor.edit(entry, (current) => {
        const next = current && typeof current === 'object' ? structuredClone(current) : {}
        const providers = next.providers && typeof next.providers === 'object' ? next.providers : {}
        const route = providers.openrouter && typeof providers.openrouter === 'object' ? providers.openrouter : null
        const existing = route && Array.isArray(route.models) ? route.models.slice() : []
        const kept = []
        removed.length = 0
        for (const model of existing) {
          if (model && typeof model.id === 'string' && ids.includes(model.id)) {
            removed.push(model.id)
            continue
          }
          kept.push(model)
        }
        for (const id of ids) if (!removed.includes(id)) missing.push(id)
        if (route) {
          if (kept.length > 0) route.models = kept
          else delete route.models
          providers.openrouter = route
          next.providers = providers
        }
        return JSON.parse(JSON.stringify(next))
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, code: 'WRITE_REJECTED', message, value: { removed, missing, backupPath } }
    }
    const installed = describeInstalled(entry)
    return { ok: true, value: { removed, missing, total: installed.count, backupPath } }
  }

  // ------------------------------------------------------------------ routes

  // ------------------------------------------------------------- brand icons

  // OpenRouter ships CDN artwork for only part of its provider list
  // (MoonshotAI.png, DeepInfra.webp, Bedrock.svg) and falls back to a favicon
  // proxy for the rest (Sail Research, BaseTen, Together, ...). The plugin
  // resolves one brand per provider here — local cache, then CDN, then the
  // provider site favicon — and serves the bytes from a loopback route, so the
  // CDN/favicon service is contacted at most once per brand per installation.
  const CDN_EXTS = ['png', 'svg', 'webp']
  const FILE_EXTS = ['png', 'svg', 'webp', 'ico']
  const ICON_TYPES = { png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon' }
  const MAX_ICON_BYTES = 512 * 1024

  let providerSites = { at: 0, byName: new Map() }
  const iconInflight = new Map()

  // Icons shipped inside the package (assets/icons) are read first, so an
  // installation that already contains the downloaded artwork needs no network
  // at all. The per-user storage directory stays as the writable fallback for
  // brands that were not bundled.
  const packageRoot = (() => {
    try {
      return dirname(dirname(fileURLToPath(import.meta.url)))
    } catch {
      return null
    }
  })()
  const bundledIconDir = packageRoot === null ? null : join(packageRoot, 'assets', 'icons')
  const iconDir = () => join(dir, 'icons')

  /**
   * Provider routing in OpenRouter's `provider` object addresses providers by
   * their slug. The browser may send a display name ("Google AI Studio") or a
   * name-derived key, so translate through the provider directory before saving.
   */
  async function canonicalProviderSlugs(values) {
    if (!Array.isArray(values) || values.length === 0) return []
    let directory = new Map()
    try { directory = await loadProviderSites() } catch { directory = new Map() }
    const slugSet = new Set()
    for (const entry of directory.values()) {
      if (entry && typeof entry.slug === 'string' && entry.slug !== '') slugSet.add(entry.slug)
    }
    const out = []
    for (const raw of values) {
      if (typeof raw !== 'string') continue
      const value = raw.trim()
      if (value === '') continue
      const entry = directory.get(value.toLowerCase())
      let slug = entry && entry.slug ? entry.slug : null
      if (slug === null && /^[a-z0-9-]+(?:\/[a-z0-9-]+)+$/.test(value)) slug = value
      if (slug === null) {
        const derived = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        slug = slugSet.has(derived) ? derived : (derived !== '' ? derived : value)
      }
      if (!out.includes(slug)) out.push(slug)
    }
    return out.slice(0, 100)
  }

  function countryOfProvider(row) {
    const hq = row && row.headquarters
    if (typeof hq === 'string' && /^[A-Za-z]{2}$/.test(hq.trim())) return hq.trim().toUpperCase()
    return null
  }

  function siteOfProvider(row) {
    for (const key of ['privacy_policy_url', 'terms_of_service_url', 'status_page_url']) {
      const value = row[key]
      if (typeof value !== 'string') continue
      try {
        const url = new URL(value)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
        const host = url.hostname
          .replace(/^www\./, '')
          .replace(/^(docs|legal|platform|api|status|trust)\./, '')
        if (host.includes('.')) return host
      } catch { /* try the next url */ }
    }
    return null
  }

  async function loadProviderSites() {
    const fresh = Date.now() - providerSites.at < 24 * 60 * 60 * 1000
    if (fresh && providerSites.byName.size > 0) return providerSites.byName
    try {
      const payload = await fetchJson(`${config.apiBaseUrl}/providers`)
      const rows = Array.isArray(payload && payload.data) ? payload.data : []
      const byName = new Map(providerSites.byName)
      for (const row of rows) {
        if (!row || typeof row.name !== 'string') continue
        const site = siteOfProvider(row)
        const country = countryOfProvider(row)
        const slug = typeof row.slug === 'string' && row.slug !== '' ? row.slug : null
        if (site !== null || country !== null || slug !== null) {
          byName.set(row.name.trim().toLowerCase(), { site, country, slug })
        }
      }
      if (byName.size > 0) providerSites = { at: Date.now(), byName }
      return providerSites.byName
    } catch (error) {
      log.warn(`provider directory unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return providerSites.byName
    }
  }

  function iconKeyFrom(name, slug, brand) {
    const base = brand !== undefined && brand !== null && brand !== ''
      ? String(brand)
      : (slug !== undefined && slug !== null && String(slug).trim() !== ''
        ? String(slug)
        : String(name || ''))
    const key = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
    return key === '' ? 'unknown' : key
  }

  function iconCandidates(name, slug, brand) {
    const out = []
    const push = (value) => {
      const compact = String(value === undefined || value === null ? '' : value).replace(/[^A-Za-z0-9]/g, '')
      if (compact !== '' && !out.includes(compact)) out.push(compact)
    }
    if (brand !== undefined && brand !== null && brand !== '') {
      push(brand)
      return out
    }
    if (typeof name === 'string') {
      push(name.split(':')[0])
      push(name)
    }
    if (typeof slug === 'string') {
      push(slug)
      push(slug.replace(/[-_]/g, ''))
    }
    return out.slice(0, 4)
  }

  async function readIconFromDisk(key) {
    const roots = []
    if (bundledIconDir !== null) roots.push(bundledIconDir)
    roots.push(iconDir())
    for (const root of roots) {
      for (const ext of FILE_EXTS) {
        try {
          const buffer = await readFile(join(root, `${key}.${ext}`))
          if (buffer && buffer.length > 0) return { ext, buffer }
        } catch { /* next extension */ }
      }
    }
    return null
  }

  async function saveIconToDisk(key, ext, buffer) {
    try {
      await mkdir(iconDir(), { recursive: true })
      await writeFile(join(iconDir(), `${key}.${ext}`), buffer)
    } catch (error) {
      log.warn(`icon cache write failed for ${key}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function extensionFor(contentType, url) {
    const type = String(contentType || '').toLowerCase()
    if (type.includes('svg')) return 'svg'
    if (type.includes('webp')) return 'webp'
    if (type.includes('icon') || type.includes('ico')) return 'ico'
    if (type.includes('png')) return 'png'
    if (type.includes('jpeg') || type.includes('jpg')) return 'png'
    const lower = String(url || '').toLowerCase()
    for (const ext of FILE_EXTS) if (lower.includes(`.${ext}`)) return ext
    return null
  }

  async function fetchIconBytes(url, accept) {
    try {
      const response = await fetch(url, {
        headers: { accept, 'user-agent': `dsh-openrouter-market/${VERSION}` },
        signal: AbortSignal.timeout(config.timeoutMs),
        redirect: 'follow',
      })
      if (!response.ok) return null
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.startsWith('image/')) return null
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length === 0 || buffer.length > MAX_ICON_BYTES) return null
      const ext = extensionFor(contentType, url)
      if (ext === null) return null
      return { ext, buffer }
    } catch {
      return null
    }
  }

  async function resolveIcon(request) {
    const key = iconKeyFrom(request.name, request.slug, request.brand)
    const cached = await readIconFromDisk(key)
    if (cached !== null) return cached
    const inflight = iconInflight.get(key)
    if (inflight !== undefined) return inflight

    const promise = (async () => {
      // 1) the OpenRouter CDN, for brands that actually have artwork there
      for (const candidate of iconCandidates(request.name, request.slug, request.brand)) {
        for (const ext of CDN_EXTS) {
          const found = await fetchIconBytes(`https://openrouter.ai/images/icons/${encodeURIComponent(candidate)}.${ext}`, 'image/*')
          if (found !== null) {
            await saveIconToDisk(key, found.ext, found.buffer)
            return found
          }
        }
      }
      // 2) the provider site favicon, which is what the OpenRouter site itself
      //    shows for providers without CDN artwork
      if (request.brand === undefined || request.brand === null || request.brand === '') {
        const sites = await loadProviderSites()
        const entry = sites.get(String(request.name || '').trim().toLowerCase())
        const site = entry && entry.site ? entry.site : null
        if (site !== null) {
          const proxied = await fetchIconBytes(
            `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent('https://' + site)}&size=128`,
            'image/*',
          )
          if (proxied !== null) {
            await saveIconToDisk(key, proxied.ext, proxied.buffer)
            return proxied
          }
          const duck = await fetchIconBytes(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(site)}.ico`, 'image/*')
          if (duck !== null) {
            await saveIconToDisk(key, duck.ext, duck.buffer)
            return duck
          }
        }
      }
      return null
    })()

    iconInflight.set(key, promise)
    try {
      return await promise
    } finally {
      iconInflight.delete(key)
    }
  }

  function sendIcon(res, ext, buffer) {
    res.writeHead(200, {
      'content-type': ICON_TYPES[ext] || 'application/octet-stream',
      'cache-control': 'public, max-age=86400',
      'content-length': buffer.length,
    })
    res.end(buffer)
  }

  let mounted = false

  /**
   * Mount the loopback routes on the context that owns `webServer`. Called with
   * a scope from `ctx.inject`, and again from a short retry loop as a fallback,
   * so a plugin that activates before the web server service exists still
   * mounts instead of silently answering 404 to every browser request.
   * @param host - scope that can resolve `webServer`.
   * @param marker - optional boot-marker writer owned by `apply`.
   */
  function wire(host, marker = () => {}) {
    if (mounted) return []
    const owner = host && typeof host.get === 'function' ? host : ctx
    let webServer = null
    try { webServer = owner.get('webServer') } catch { webServer = null }
    if (!webServer && owner !== ctx) {
      try { webServer = ctx.get('webServer') } catch { webServer = null }
    }
    if (!webServer || typeof webServer.register !== 'function') {
      log.warn('webServer service is unavailable; OpenRouter model hub routes are not mounted yet')
      return []
    }

    const disposers = []
    const mount = (path, handler) => {
      const dispose = webServer.register({
        kind: 'exact',
        path: PREFIX + path,
        handler: async (req, res) => {
          if (!isLoopback(req)) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'loopback only' } })
          try {
            await handler(req, res)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            log.warn(`route ${path} failed: ${message}`)
            try { fail(res, 'INTERNAL', message) } catch { /* response already sent */ }
          }
        },
      })
      if (typeof dispose === 'function') disposers.push(dispose)
    }

    mount('/status', async (req, res) => {
      const now = Date.now()
      ok(res, {
        apiBaseUrl: config.apiBaseUrl,
        modelsCachedAt: modelsCache ? modelsCache.fetchedAt : null,
        modelsStale: modelsCache ? now - modelsCache.fetchedAt >= config.modelsTtlMs : true,
        modelsTtlMs: config.modelsTtlMs,
        endpointsTtlMs: config.endpointsTtlMs,
        modelCount: modelsCache ? modelsCache.models.length : 0,
        source: modelsCache ? 'cache' : 'none',
        lastError,
        version: VERSION,
      })
    })

    mount('/models', async (req, res) => {
      const url = new URL(req.url || '', 'http://127.0.0.1')
      const refresh = url.searchParams.get('refresh') === '1'
      try {
        const { cache, source, stale, error } = await getModels({ refresh })
        ok(res, {
          models: cache.models,
          cachedAt: cache.fetchedAt,
          stale: Boolean(stale),
          source,
          modelCount: cache.models.length,
          lastError: error || null,
        })
      } catch (error) {
        fail(res, 'UPSTREAM_FAILED', error instanceof Error ? error.message : String(error))
      }
    })

    mount('/endpoints', async (req, res) => {
      const url = new URL(req.url || '', 'http://127.0.0.1')
      const slug = url.searchParams.get('slug')
      if (typeof slug !== 'string' || slug.trim() === '' || !slug.includes('/')) {
        return fail(res, 'BAD_REQUEST', 'query parameter slug=<author/model> is required')
      }
      try {
        const { value, cachedAt, stale, error } = await getEndpoints(slug.trim(), url.searchParams.get('refresh') === '1')
        ok(res, {
          modelId: value.modelId,
          modelName: value.modelName,
          endpoints: value.endpoints,
          cachedAt,
          stale: Boolean(stale),
          lastError: error || null,
        })
      } catch (error) {
        fail(res, 'UPSTREAM_FAILED', error instanceof Error ? error.message : String(error))
      }
    })

    const handleRefresh = async (req, res) => {
      const started = Date.now()
      try {
        const cache = await refreshModels()
        ok(res, { cachedAt: cache.fetchedAt, modelCount: cache.models.length, ms: Date.now() - started })
      } catch (error) {
        fail(res, 'UPSTREAM_FAILED', error instanceof Error ? error.message : String(error))
      }
    }
    mount('/refresh', handleRefresh)

    mount('/icon', async (req, res) => {
      const url = new URL(req.url || '', 'http://127.0.0.1')
      const brand = (url.searchParams.get('brand') || '').trim()
      const name = (url.searchParams.get('name') || '').trim()
      const slug = (url.searchParams.get('slug') || '').trim()
      if (brand === '' && name === '' && slug === '') {
        return fail(res, 'BAD_REQUEST', 'one of brand, name or slug is required')
      }
      if (brand !== '' && !/^[A-Za-z0-9]{1,48}$/.test(brand)) {
        return fail(res, 'BAD_REQUEST', 'brand must be alphanumeric')
      }
      if (name.length > 120 || slug.length > 120) {
        return fail(res, 'BAD_REQUEST', 'name or slug is too long')
      }
      try {
        const icon = await resolveIcon({ brand: brand === '' ? undefined : brand, name, slug })
        if (icon === null) return sendJson(res, 404, { ok: false, error: { code: 'ICON_NOT_FOUND', message: brand || name } })
        sendIcon(res, icon.ext, icon.buffer)
      } catch (error) {
        sendJson(res, 500, { ok: false, error: { code: 'ICON_FAILED', message: error instanceof Error ? error.message : String(error) } })
      }
    })

    mount('/open', async (req, res) => {
      if (req.method !== 'GET') return fail(res, 'BAD_REQUEST', 'GET required')
      const url = new URL(req.url || '', 'http://127.0.0.1')
      const what = (url.searchParams.get('what') || '').trim()
      if (what !== 'config' && what !== 'routing') return fail(res, 'BAD_REQUEST', 'what must be config or routing')
      let target = ''
      if (what === 'routing') {
        target = join(dir, ROUTING_FILE)
      } else {
        const { editor } = findPiAiEntry()
        target = editor && typeof editor.documentPath === 'string' ? editor.documentPath : ''
        if (target === '') return fail(res, 'NO_CONFIG_PATH', 'the config editor did not expose a document path')
      }
      if (!existsSync(target)) return fail(res, 'NOT_FOUND', `${what === 'routing' ? 'routing.json' : 'config file'} does not exist yet: ${target}`)
      const opened = await openLocalFile(target)
      if (!opened.ok) return fail(res, 'OPEN_FAILED', opened.message)
      ok(res, { what, path: target, opener: opened.opener })
    })

    mount('/installed', async (req, res) => {
      const { editor, entry } = findPiAiEntry()
      if (!editor || typeof editor.entries !== 'function') {
        return ok(res, { route: 'openrouter', configured: false, apiKeyEnv: null, count: 0, models: [], editorAvailable: false })
      }
      if (!entry) {
        return ok(res, { route: 'openrouter', configured: false, apiKeyEnv: null, count: 0, models: [], entryAvailable: false })
      }
      const value = describeInstalled(entry)
      ok(res, { ...value, editorAvailable: true, entryAvailable: true })
    })

    mount('/import', async (req, res) => {
      if (req.method !== 'POST') return fail(res, 'BAD_REQUEST', 'POST required')
      let body
      try {
        body = JSON.parse(await readBody(req))
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: { code: 'BAD_BODY', message: error instanceof Error ? error.message : String(error) } })
      }
      const models = Array.isArray(body && body.models) ? body.models : null
      if (models === null) return fail(res, 'BAD_BODY', 'body must be { models: [...] }')

      const result = await serialize(() => importModels(models))
      if (result.ok) return ok(res, result.value)
      return sendJson(res, 200, { ok: false, error: { code: result.code, message: result.message }, value: result.value })
    })

    mount('/remove', async (req, res) => {
      if (req.method !== 'POST') return fail(res, 'BAD_REQUEST', 'POST required')
      let body
      try {
        body = JSON.parse(await readBody(req))
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: { code: 'BAD_BODY', message: error instanceof Error ? error.message : String(error) } })
      }
      const raw = body && (Array.isArray(body.modelIds) ? body.modelIds
        : typeof body.modelId === 'string' ? [body.modelId] : null)
      if (raw === null) return fail(res, 'BAD_BODY', 'body must be { modelIds: [...] }')

      const result = await serialize(() => removeModels(raw))
      if (result.ok) return ok(res, result.value)
      return sendJson(res, 200, { ok: false, error: { code: result.code, message: result.message }, value: result.value })
    })

    // -------------------------------------------------------- routing policy

    const readJsonBody = async (req, res) => {
      try {
        const parsed = JSON.parse(await readBody(req))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
        sendJson(res, 400, { ok: false, error: { code: 'BAD_BODY', message: 'body must be a JSON object' } })
        return undefined
      } catch (error) {
        sendJson(res, 400, { ok: false, error: { code: 'BAD_BODY', message: error instanceof Error ? error.message : String(error) } })
        return undefined
      }
    }

    mount('/routing', async (req, res) => {
      if (req.method !== 'GET') return fail(res, 'BAD_REQUEST', 'GET required')
      try {
        const store = await loadRouting()
        ok(res, {
          strategies: store.strategies,
          updatedAt: store.updatedAt,
          injection: {
            enabled: injection.enabled,
            injected: injection.injected,
            skipped: injection.skipped,
            failed: injection.failed,
          },
        })
      } catch (error) {
        fail(res, 'INTERNAL', error instanceof Error ? error.message : String(error))
      }
    })

    mount('/routing/save', async (req, res) => {
      if (req.method !== 'POST') return fail(res, 'BAD_REQUEST', 'POST required')
      const body = await readJsonBody(req, res)
      if (body === undefined) return
      const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : ''
      if (modelId === '') return fail(res, 'BAD_REQUEST', 'modelId is required')
      if (modelId.length > 200) return fail(res, 'BAD_REQUEST', 'modelId is too long')
      const normalized = normalizeRoutingStrategy(body.strategy)
      if (!normalized.ok) return fail(res, 'BAD_REQUEST', normalized.error)
      try {
        normalized.value.order = await canonicalProviderSlugs(normalized.value.order)
        normalized.value.only = await canonicalProviderSlugs(normalized.value.only)
        normalized.value.ignore = await canonicalProviderSlugs(normalized.value.ignore)
      } catch { /* keep the submitted values when the directory is unavailable */ }
      try {
        await updateRouting((store) => ({ ...store, strategies: { ...store.strategies, [modelId]: normalized.value } }))
        ok(res, { modelId, strategy: normalized.value })
      } catch (error) {
        fail(res, 'WRITE_FAILED', error instanceof Error ? error.message : String(error))
      }
    })

    mount('/routing/delete', async (req, res) => {
      if (req.method !== 'POST') return fail(res, 'BAD_REQUEST', 'POST required')
      const body = await readJsonBody(req, res)
      if (body === undefined) return
      const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : ''
      if (modelId === '') return fail(res, 'BAD_REQUEST', 'modelId is required')
      try {
        const store = await loadRouting()
        if (!Object.prototype.hasOwnProperty.call(store.strategies, modelId)) {
          return ok(res, { modelId, removed: false })
        }
        const rest = { ...store.strategies }
        delete rest[modelId]
        await saveRouting({ ...store, strategies: rest })
        ok(res, { modelId, removed: true })
      } catch (error) {
        fail(res, 'WRITE_FAILED', error instanceof Error ? error.message : String(error))
      }
    })

    mount('/routing/status', async (req, res) => {
      if (req.method !== 'GET') return fail(res, 'BAD_REQUEST', 'GET required')
      try {
        const store = await loadRouting()
        ok(res, {
          enabled: config.enableRouting && injection.enabled,
          configEnabled: config.enableRouting,
          injected: injection.injected,
          skipped: injection.skipped,
          failed: injection.failed,
          strategies: Object.keys(store.strategies).length,
        })
      } catch (error) {
        fail(res, 'INTERNAL', error instanceof Error ? error.message : String(error))
      }
    })

    // ---------------------------------------------------- routing diagnostics
    // A one-token, non-streaming probe: send the saved strategy explicitly and
    // report the provider OpenRouter actually used. This is the only reliable
    // way to confirm routing without opening OpenRouter's activity dashboard.
    mount('/probe', async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 'BAD_REQUEST', 'GET or POST required')
      const url = new URL(req.url || '', 'http://127.0.0.1')
      let modelId = (url.searchParams.get('model') || '').trim()
      if (modelId === '' && req.method === 'POST') {
        const body = await readJsonBody(req, res)
        if (body === undefined) return
        modelId = typeof body.model === 'string' ? body.model.trim() : ''
      }
      if (modelId === '') return fail(res, 'BAD_REQUEST', 'query parameter model=<openrouter-model-id> is required')
      if (modelId.length > 200) return fail(res, 'BAD_REQUEST', 'model is too long')

      const apiKey = await resolveApiKey()
      if (apiKey === null) {
        return fail(res, 'NO_CREDENTIAL', `no credential found for ${config.apiKeyEnv}; configure it in DSH credentials or the environment`)
      }
      const store = await loadRouting()
      const strategy = Object.prototype.hasOwnProperty.call(store.strategies, modelId) ? store.strategies[modelId] : null
      const appliedProvider = strategy === null ? null : providerPatchFor(strategy)
      const payload = {
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }
      // Passing the same object the wrapper would inject means the probe also
      // exercises the real request path (and its counters) when routing is on.
      if (appliedProvider !== null) payload.provider = appliedProvider
      try {
        const response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(config.timeoutMs),
        })
        const text = await response.text()
        let parsed = null
        try { parsed = JSON.parse(text) } catch { parsed = null }
        ok(res, {
          modelId,
          strategyFound: strategy !== null,
          appliedProvider,
          httpStatus: response.status,
          provider: parsed !== null && typeof parsed.provider === 'string' ? parsed.provider : null,
          servedModel: parsed !== null && typeof parsed.model === 'string' ? parsed.model : null,
          usage: parsed !== null && parsed.usage ? parsed.usage : null,
          error: response.ok
            ? null
            : (parsed && parsed.error && typeof parsed.error.message === 'string' ? parsed.error.message : `HTTP ${response.status}`),
        })
      } catch (error) {
        fail(res, 'UPSTREAM_FAILED', error instanceof Error ? error.message : String(error))
      }
    })

    if (disposers.length > 0) mounted = true
    log.info(`mounted ${disposers.length} route(s) under ${PREFIX}`)
    try { marker({ stage: 'mounted', mounted: true, routes: disposers.length }) } catch { /* diagnostics only */ }
    return disposers
  }

  return {
    wire,
    isMounted: () => mounted,
    warm: () => { getModels({ refresh: false }).catch(() => undefined) },
    stats: state,
    dir,
    log,
    injection,
    loadRouting,
    saveRouting,
  }
}

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const hub = createHub(ctx, config)

  const disposers = []

  // Boot self-check marker: the fastest way to tell "plugin never activated",
  // "activated but webServer was missing" and "routes mounted" apart without a
  // browser console. Rewritten on every activation.
  const writeBootMarker = (payload) => {
    ;(async () => {
      try {
        await mkdir(hub.dir, { recursive: true })
        await writeFile(join(hub.dir, 'host-alive.json'), JSON.stringify({
          version: VERSION,
          at: new Date().toISOString(),
          ...payload,
        }, null, 2) + '\n', 'utf8')
      } catch { /* diagnostics only */ }
    })()
  }

  // ---------------------------------------------------------- P2: injection
  // The only seam DSH leaves for routing parameters: wrap globalThis.fetch,
  // rewrite OpenRouter chat/messages bodies, and restore on dispose. Installed
  // only when the profile enables it; every failure inside the wrapper falls
  // back to the original fetch so a conversation can never be broken.
  if (config.enableRouting) {
    try {
      const originalFetch = globalThis.fetch
      if (typeof originalFetch === 'function') {
        disposers.push(installRoutingFetch({ hub, config, originalFetch, log: hub.log }))
        hub.log.info('routing request injection installed')
      } else {
        hub.log.warn('routing request injection skipped: globalThis.fetch is not a function')
      }
    } catch (error) {
      hub.log.warn(`routing request injection could not be installed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const mount = (host) => {
    if (hub.isMounted()) return
    try {
      for (const dispose of hub.wire(host, writeBootMarker)) disposers.push(dispose)
    } catch (error) {
      try {
        const logger = typeof ctx.logger === 'function' ? ctx.logger('openrouter-models') : undefined
        logger?.warn?.(`failed to mount routes: ${error instanceof Error ? error.message : String(error)}`)
      } catch { /* logging never throws */ }
    }
  }

  // Correct cordis form: depend on `webServer` instead of sampling it once.
  let injected = false
  if (typeof ctx.inject === 'function') {
    try {
      disposers.push(ctx.inject(['webServer'], (scoped) => {
        injected = true
        mount(scoped)
      }))
    } catch (error) {
      try {
        const logger = typeof ctx.logger === 'function' ? ctx.logger('openrouter-models') : undefined
        logger?.warn?.(`ctx.inject(webServer) failed, falling back to ctx.get: ${error instanceof Error ? error.message : String(error)}`)
      } catch { /* logging never throws */ }
    }
  }
  if (!injected) mount(ctx)
  writeBootMarker({ stage: injected ? 'injected' : 'direct', mounted: hub.isMounted(), routes: ROUTE_COUNT })

  // Safety net: if the inject path never fired (older loader, unusual scope),
  // try a few more times before giving up. Idempotent thanks to `mounted`.
  if (!hub.isMounted()) {
    let attempts = 0
    const retry = setInterval(() => {
      attempts += 1
      if (hub.isMounted()) { clearInterval(retry); return }
      mount(ctx)
      if (attempts >= 20) clearInterval(retry)
    }, 500)
    if (typeof retry.unref === 'function') retry.unref()
    disposers.push(() => clearInterval(retry))
  }

  // Warm the catalog in the background; never block activation on the network.
  try {
    const timer = setTimeout(() => hub.warm(), 1500)
    if (typeof timer.unref === 'function') timer.unref()
    disposers.push(() => clearTimeout(timer))
  } catch { /* ignore */ }

  // Light background refresh: only hits the network when the cache is stale.
  try {
    const interval = setInterval(() => hub.warm(), 10 * 60 * 1000)
    if (typeof interval.unref === 'function') interval.unref()
    disposers.push(() => clearInterval(interval))
  } catch { /* ignore */ }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const dispose of disposers.splice(0)) {
        try { dispose() } catch { /* ignore */ }
      }
    })
  }

  return () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose() } catch { /* ignore */ }
    }
  }
}
