/**
 * dsh-openrouter-market — Client half (P1: curated catalog + import panel)
 *
 * Slots (both registered inside apply(); apply returns a cleanup function):
 *   - settings.models.footer  id: openrouter-models.entry  order: 50 (entry row)
 *   - shell.overlay           id: openrouter-models.panel  order: 50 (floating panel)
 *
 * The entry row and the panel share the open/closed state through a
 * module-level pub/sub store. Every component render body is wrapped in
 * try/catch so exceptions never propagate into the slot tree (a throwing slot
 * component blanks the whole app). Styling uses only --dsw-alias-* theme
 * tokens with the `orm-` class prefix, emitted as an in-component <style>
 * element so it disappears on unmount. React (require('react')) is the only
 * dependency; no @deepseek-ai/* package is imported.
 */
window.__ModuleLoader__.load({
	id: 'dsh-openrouter-market',
	factory: (require) => {
		const React = require('react')
		const h = React.createElement
		const useState = React.useState
		const useEffect = React.useEffect
		const useMemo = React.useMemo
		const useRef = React.useRef
		const useCallback = React.useCallback

		const NS = 'openrouter-models'
		const PLUGIN_VERSION = '0.2.1'

		// ==================================================================
		// Module state
		// ==================================================================

		// --- open/closed pub/sub shared by Entry and Panel ---
		let panelOpen = false
		const panelListeners = new Set()

		function notifyPanel() {
			for (const listener of Array.from(panelListeners)) {
				try {
					listener()
				} catch (error) {
					// one broken listener must not block the others
				}
			}
		}

		function setPanelOpen(next) {
			const value = next === true
			if (panelOpen === value) return
			panelOpen = value
			notifyPanel()
		}

		function usePanelOpen() {
			const [open, setOpenLocal] = useState(panelOpen)
			useEffect(() => {
				const listener = () => setOpenLocal(panelOpen)
				panelListeners.add(listener)
				return () => {
					panelListeners.delete(listener)
				}
			}, [])
			return open
		}

		// --- React context handle set in apply(), used for locale lookup ---
		let ORM_CTX = null

		function currentLang() {
			try {
				const snap = ORM_CTX && ORM_CTX.locale ? ORM_CTX.locale.getLocale() : null
				const raw = snap && (snap.active || snap.id)
				const text = typeof raw === 'string' ? raw.toLowerCase() : ''
				return text.includes('zh') ? 'zh' : 'en'
			} catch (error) {
				return 'zh'
			}
		}

		// --- browser-memory model cache (Host owns all persistence) ---
		let memModels = { at: 0, payload: null }

		// ==================================================================
		// Bilingual inline dictionaries (zh default, en fallback)
		// ==================================================================

		const STRINGS = {
			zh: {
				entryButton: 'OpenRouter 模型库',
				entryDesc: '浏览 OpenRouter 全量模型列表，勾选后一键导入到 DSH 配置。',
			deprecating: '下架',
				panelTitle: 'OpenRouter 模型库',
				close: '关闭',
				refresh: '刷新',
				refreshing: '刷新中…',
				refreshDone: '刷新成功',
				refreshIncomplete: '部分数据刷新失败，已保留上次结果',
				dataTime: '数据时间',
				cachedData: '缓存数据',
				lastErrorNote: '最近一次请求失败：',
				searchPlaceholder: '搜索模型 id / 名称 / author…',
				filterAll: '全部',
				filterText: '文本',
				filterImage: '图像',
				filterFree: '免费',
				filterAdded: '已添加',
				sortName: '名称',
				sortInput: '输入价',
				sortOutput: '输出价',
				sortContext: '上下文窗口',
				sortAsc: '升序',
				sortDesc: '降序',
				colModel: '模型',
				colContext: '上下文',
				colInput: '输入价',
				colOutput: '输出价',
				colConfigured: '配置',
				colRouter: '路由',
				free: '免费',
				added: '已配置',
				badgeNotConfigured: '未配置',
				badgeRouted: '已路由',
				configuredReadOnly: '只读 · 按当前路由策略显示 Provider 顺序',
				configuredAllProviders: '未设置路由策略 · 显示全部 Provider（默认按输入价升序）',
				viewCatalog: '模型库',
				viewConfigured: '已配置',
				configuredEmpty: '还没有已配置的模型。先到「模型库」勾选模型并导入到 DSH 配置。',
				configuredNoRoute: '未设置路由 · 全部 Provider',
				configuredOrdered: '{n} 个 Provider · 手动顺序',
				configuredOnly: '{n} 个 Provider · Only 白名单',
				configuredDefaultOrder: '默认按输入价升序显示',
				configuredUnavailable: '无法读取已配置模型：',
				scrollMore: '继续向下滚动加载更多…',
				totalModels: '{n} 个模型',
				noMatch: '没有符合筛选条件的模型。',
				emptyCatalog: '暂无数据，请点击「刷新」重试。',
				loading: '正在加载模型目录…',
				loadFailed: '加载失败：',
				offlineHint: '无法连接 DSH 本地接口，请确认 harness 正在运行后再试。',
				retry: '重试',
				footSelected: '已选 {n} 个模型',
				selectAll: '全选',
				importBtn: '导入到 DSH 配置',
				importing: '导入中…',
				importSuccess: '已添加 {a} 个、更新 {u} 个，当前共 {t} 个',
				importSkipped: '（跳过 {s} 个）',
				importFailed: '导入失败：',
				provTitle: 'Provider 列表',
				provCount: '{n} 个 Provider',
				provLoading: '正在加载 Provider 数据…',
				provFailed: 'Provider 数据加载失败：',
				provEmpty: '该模型暂无 Provider 数据。',
				provColProvider: 'Provider',
				provColInput: '输入价',
				provColOutput: '输出价',
				provColCache: '缓存价',
				provColLatency: '延迟',
				provColThroughput: '吞吐',
				provColUptime: 'Uptime',
				provColQuant: '量化',
				provEmptyValue: '—',
				routeBadge: '路由',
				routeBadgeTitle: '该模型已配置 Provider 路由策略',
				routeHard: '硬性约束',
				routeStrategy: '选择策略',
				routePerformance: '性能偏好',
				routeFailover: '故障转移',
				routeLists: '编辑 Only / Ignore',
				routeOnly: 'Only（允许）',
				routeIgnore: 'Ignore（排除）',
				routeResetLists: '恢复全部服务商',
				routeRequire: '要求支持请求中的全部参数',
				routeData: '禁止可收集数据的端点',
				routeZdr: '仅零数据保留端点',
				routeDistill: '仅允许文本蒸馏的模型',
				routeRuntime: 'OpenRouter 在请求时核验参数、数据政策和蒸馏许可。预览仅筛除已知不符合的端点。',
				routeSort: '按指标排序',
				routeSortBy: '排序指标',
				routeMin: '最低吞吐 p50（tok/s）',
				routeMax: '最高延迟 p50（秒）',
				routePerfHint: '达标服务商优先。预览使用当前性能快照。',
				routePerfCustom: '插件在手动顺序模式下暂停性能偏好。切回自动或指标排序后恢复。',
				routeNoCandidates: '当前硬性约束下没有候选服务商。',
				routeOrderRequired: '至少为一个符合条件的服务商填写顺序。',
				routeSteps: '路由设置',
				routeModeAuto: '自动',

				routeModeCheapest: '最便宜',

				routeModeFastest: '最快',

				routeModeLatency: '最低延迟',

				routeModeCustom: '手动顺序',

				routeOrder: '顺序',
				routeOrderHint: '数字越小越优先；留空表示不参与顺序',
				routeSave: '保存',
				routeSaving: '保存中…',
				routeClear: '清除',
				routeSaved: '路由策略已保存',
				routeCleared: '路由策略已清除',
				routeSaveFailed: '保存失败：',
				routeProbe: '测试路由',
				routeProbing: '测试中…',
				routeProbeOk: '实际提供方：',
				routeProbeUnknown: '未返回提供方',
				routeProbeFailed: '测试失败：',
				routeInjectOn: '注入 已启用',
				routeInjectOff: '注入 已关闭',
				routeInjectOnHint: 'Host 会把路由策略注入 llm-pi-ai provider 配置',
				routeInjectOffHint: 'Host 配置 enableRouting:false，策略不会注入',
				routeInjectLoading: '注入 读取中…',
				routeInjectUnavailable: '注入 不可用',
				routeUnavailable: '路由服务不可用（Host 端 /routing 未就绪）',



				routeAdvanced: '高级选项',

				routeFallbacks: '允许回退',
				routeFallbacksHint: '首选 Provider 不可用时允许 OpenRouter 回退到其它 Provider',
				routeMaxPrice: '最大价格',
				routeMaxPriceUnit: '$/1M tokens',
				routeMaxPricePrompt: '输入上限（$/百万 token）',
				routeMaxPriceRequest: '单次请求上限（$）',
				routeMaxPriceImage: '单张图片上限（$）',
				routeMaxPriceCompletion: '输出上限（$/百万 token）',

				routeQuant: '量化',

			},
			en: {
				entryButton: 'OpenRouter Models',
				entryDesc: 'Browse the full OpenRouter model catalog and import selected models into the DSH config.',
				deprecating: 'retires',
				panelTitle: 'OpenRouter Models',
				close: 'Close',
				refresh: 'Refresh',
				refreshing: 'Refreshing…',
				refreshDone: 'Refresh complete',
				refreshIncomplete: 'Some data could not refresh. Previous results were kept.',
				dataTime: 'Data time',
				cachedData: 'Cached data',
				lastErrorNote: 'Last request failed: ',
				searchPlaceholder: 'Search model id / name / author…',
				filterAll: 'All',
				filterText: 'Text',
				filterImage: 'Image',
				filterFree: 'Free',
				filterAdded: 'Added',
				sortName: 'Name',
				sortInput: 'Input price',
				sortOutput: 'Output price',
				sortContext: 'Context window',
				sortAsc: 'Asc',
				sortDesc: 'Desc',
				colModel: 'Model',
				colContext: 'Context',
				colInput: 'Input',
				colOutput: 'Output',
				colConfigured: 'Config',
				colRouter: 'Routing',
				free: 'Free',
				added: 'Configured',
				badgeNotConfigured: 'Not configured',
				badgeRouted: 'Routed',
				configuredReadOnly: 'Read-only · providers in current routing order',
				configuredAllProviders: 'No routing strategy · all providers (input price ascending by default)',
				viewCatalog: 'Catalogue',
				viewConfigured: 'Configured',
				configuredEmpty: 'No configured models yet. Pick models in Catalogue and import them into the DSH config.',
				configuredNoRoute: 'No routing · all providers',
				configuredOrdered: '{n} providers · manual order',
				configuredOnly: '{n} providers · only allow-list',
				configuredDefaultOrder: 'Ordered by input price ascending',
				configuredUnavailable: 'Cannot read configured models: ',
				scrollMore: 'Scroll down to load more…',
				totalModels: '{n} models',
				noMatch: 'No model matches the current filters.',
				emptyCatalog: 'No data yet. Click Refresh and try again.',
				loading: 'Loading model catalog…',
				loadFailed: 'Load failed: ',
				offlineHint: 'Cannot reach the DSH local API. Make sure the harness is running and retry.',
				retry: 'Retry',
				footSelected: '{n} model(s) selected',
				selectAll: 'Select all',
				importBtn: 'Import to DSH config',
				importing: 'Importing…',
				importSuccess: 'Added {a}, updated {u}; {t} model(s) in total',
				importSkipped: ' ({s} skipped)',
				importFailed: 'Import failed: ',
				provTitle: 'Providers',
				provCount: '{n} provider(s)',
				provLoading: 'Loading provider data…',
				provFailed: 'Failed to load provider data: ',
				provEmpty: 'No provider data for this model.',
				provColProvider: 'Provider',
				provColInput: 'Input',
				provColOutput: 'Output',
				provColCache: 'Cache',
				provColLatency: 'Latency',
				provColThroughput: 'Throughput',
				provColUptime: 'Uptime',
				provColQuant: 'Quantization',
				provEmptyValue: '—',
				routeBadge: 'Routing',
				routeBadgeTitle: 'Provider routing is configured for this model',
				routeHard: 'Hard constraints',
				routeStrategy: 'Selection strategy',
				routePerformance: 'Performance preferences',
				routeFailover: 'Failover',
				routeLists: 'Edit Only / Ignore',
				routeOnly: 'Only (allow)',
				routeIgnore: 'Ignore (exclude)',
				routeResetLists: 'Allow all providers again',
				routeRequire: 'Require support for all request parameters',
				routeData: 'Exclude endpoints that may collect data',
				routeZdr: 'Require zero data retention',
				routeDistill: 'Require models that allow text distillation',
				routeRuntime: 'OpenRouter verifies request parameters, data policies and distillation permissions at request time. The preview removes known mismatches.',
				routeSort: 'Sort by metric',
				routeSortBy: 'Sort metric',
				routeMin: 'Minimum throughput p50 (tok/s)',
				routeMax: 'Maximum latency p50 (seconds)',
				routePerfHint: 'Matching providers come first. The preview uses the current snapshot.',
				routePerfCustom: 'The plugin pauses performance preferences in manual order mode. They resume in auto or metric sorting.',
				routeNoCandidates: 'No providers match the current constraints.',
				routeOrderRequired: 'Enter an order for at least one eligible provider.',
				routeSteps: 'Routing settings',
				routeModeAuto: 'Auto',

				routeModeCheapest: 'Cheapest',

				routeModeFastest: 'Fastest',

				routeModeLatency: 'Lowest latency',

				routeModeCustom: 'Manual order',

				routeOrder: 'Order',
				routeOrderHint: 'Lower numbers are tried first; leave empty to skip this provider',
				routeSave: 'Save',
				routeSaving: 'Saving…',
				routeClear: 'Clear',
				routeSaved: 'Routing strategy saved',
				routeCleared: 'Routing strategy cleared',
				routeSaveFailed: 'Save failed: ',
				routeProbe: 'Test route',
				routeProbing: 'Testing…',
				routeProbeOk: 'Served by: ',
				routeProbeUnknown: 'No provider returned',
				routeProbeFailed: 'Test failed: ',
				routeInjectOn: 'Injection on',
				routeInjectOff: 'Injection off',
				routeInjectOnHint: 'The Host injects routing into the llm-pi-ai provider config',
				routeInjectOffHint: 'Host config enableRouting:false — nothing is injected',
				routeInjectLoading: 'Injection …',
				routeInjectUnavailable: 'Injection n/a',
				routeUnavailable: 'Routing service unavailable (Host /routing is not ready)',



				routeAdvanced: 'Advanced',

				routeFallbacks: 'Allow fallbacks',
				routeFallbacksHint: 'Let OpenRouter fall back to another provider when the preferred one is unavailable',
				routeMaxPrice: 'Max price',
				routeMaxPriceUnit: '$/1M tokens',
				routeMaxPricePrompt: 'Input cap ($/M tokens)',
				routeMaxPriceRequest: 'Request cap ($/request)',
				routeMaxPriceImage: 'Image cap ($/image)',
				routeMaxPriceCompletion: 'Output cap ($/M tokens)',

				routeQuant: 'Quantizations',

			}
		}

		function makeTranslator(lang) {
			const dict = STRINGS[lang] || STRINGS.zh
			return (key, params) => {
				let text = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key
				if (params && typeof params === 'object') {
					for (const name of Object.keys(params)) {
						text = text.split(`{${name}}`).join(String(params[name]))
					}
				}
				return text
			}
		}

		// ==================================================================
		// HTTP helpers (Host envelope: { ok:true, value } | { ok:false, error })
		// ==================================================================

		async function fetchEnvelope(url, options) {
			let response
			try {
				response = await fetch(url, options)
				// A host served under a base path answers 404 for the rooted URL;
				// retry once relative to the current document before surfacing it.
				if (response.status === 404 && typeof url === 'string' && url.startsWith('/')) {
					try {
						const retry = await fetch(url.slice(1), options)
						if (retry.ok) response = retry
					} catch (retryError) {}
				}
			} catch (error) {
				throw new Error(`network error: ${error && error.message ? error.message : String(error)}`)
			}
			let body = null
			try {
				body = await response.json()
			} catch (error) {
				throw new Error(`HTTP ${response.status}: response is not JSON`)
			}
			if (body && body.ok === true) return body.value
			if (body && body.ok === false && body.error) {
				const err = new Error(body.error.message || body.error.code || `HTTP ${response.status}`)
				err.code = body.error.code
				throw err
			}
			throw new Error(`unexpected response (HTTP ${response.status})`)
		}

		function apiGet(path) {
			return fetchEnvelope(path, { method: 'GET' })
		}

		function apiPost(path, bodyText) {
			return fetchEnvelope(path, {
				method: 'POST',
				headers: { 'content-type': 'application/json; charset=utf-8' },
				body: bodyText
			})
		}

		// ==================================================================
		// Formatting helpers
		// ==================================================================

		function roundShort(n) {
			if (n >= 100) return String(Math.round(n))
			return n.toFixed(1)
		}

		// Brand icons: the OpenRouter CDN names files inconsistently (MoonshotAI.png,
		// DeepInfra.webp, Bedrock.svg), so the Host downloads a brand once, caches it in
		// the plugin storage and serves it from a loopback route. The browser keeps one
		// blob URL per brand: no cross-origin image loads, no repeated 404 storms.
		// Factory scope on purpose: a component declared inside a render body would get a
		// new identity on every render and remount itself (and its image) each time.
		const ICON_CACHE = new Map()
		const ICON_QUEUE = { active: 0, waiting: [] }

		// Render up to 150 rows at once; without a cap every visible row would open
		// its own icon request and starve the model list during the first paint.
		function scheduleIcon(task) {
			return new Promise((resolve) => {
				const run = () => {
					ICON_QUEUE.active += 1
					task().then(resolve, () => resolve(null)).finally(() => {
						ICON_QUEUE.active -= 1
						const next = ICON_QUEUE.waiting.shift()
						if (next) next()
					})
				}
				if (ICON_QUEUE.active < 8) run()
				else ICON_QUEUE.waiting.push(run)
			})
		}

		function loadIcon(name, slug) {
			const key = `${name}|${slug}`
			const existing = ICON_CACHE.get(key)
			if (existing !== undefined) return existing.promise
			const entry = { state: 'loading', url: null, promise: null }
			entry.promise = scheduleIcon(async () => {
				try {
					const params = new URLSearchParams()
					if (name) params.set('name', name)
					if (slug) params.set('slug', slug)
					const response = await fetch(`/api/openrouter-models/icon?${params.toString()}`)
					if (response && response.ok) {
						const blob = await response.blob()
						if (blob && blob.size > 0) {
							entry.url = URL.createObjectURL(blob)
							entry.state = 'ready'
							return entry
						}
					}
				} catch (error) {}
				entry.state = 'miss'
				return entry
			})
			ICON_CACHE.set(key, entry)
			return entry.promise
		}

		function modelBrand(model) {
			const name = model && typeof model.name === 'string' ? model.name.trim() : ''
			if (name !== '') {
				const head = name.split(':')[0].trim()
				if (head !== '') return head
			}
			return model && typeof model.author === 'string' ? model.author : (model && model.id ? String(model.id).split('/')[0] : '')
		}

		function initialsOf(name, slug) {
			const base = String(name || slug || '?')
			const parts = base.replace(/[^A-Za-z0-9\s\-_/]+/g, ' ').split(/[\s\-_/]+/).filter(Boolean)
			const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '?').slice(0, 2)
			return letters.toUpperCase()
		}

		function BrandIcon(props) {
			const name = props && typeof props.name === 'string' ? props.name : ''
			const slug = props && typeof props.slug === 'string' ? props.slug : ''
			const size = props && Number.isFinite(props.size) ? props.size : 18
			const [src, setSrc] = useState(null)
			useEffect(() => {
				let alive = true
				;(async () => {
					const entry = await loadIcon(name, slug)
					if (!alive) return
					if (entry && entry.state === 'ready' && entry.url) setSrc(entry.url)
				})()
				return () => { alive = false }
			}, [name, slug])
			if (src === null) {
				return h('span', {
					className: 'orm-avatar orm-avatar-fallback',
					style: { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.44)) },
					'aria-hidden': 'true'
				}, initialsOf(name, slug))
			}
			return h('img', {
				className: 'orm-avatar',
				src,
				alt: '',
				width: size,
				height: size,
				loading: 'lazy',
				decoding: 'async'
			})
		}

		function formatContext(value) {
			if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—'
			if (value >= 1e9) return `${roundShort(value / 1e9)}B`
			if (value >= 1e6) return `${roundShort(value / 1e6)}M`
			if (value >= 1e3) return `${roundShort(value / 1e3)}K`
			return String(Math.round(value))
		}

		function formatPrice(value, isFree, lang) {
			if (isFree === true) return lang === 'en' ? 'Free' : '免费'
			if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
			// USD per 1M tokens: keep up to 4 decimals, trim trailing zeros, never "$0.0000".
			let text = value.toFixed(4)
			if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '')
			if (text === '' || text === '-') text = '0'
			return `$${text}`
		}

		function formatUptime(value) {
			if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
			const pct = value <= 1 ? value * 100 : value
			return `${pct >= 100 ? '100' : pct.toFixed(1)}%`
		}

		// ---- uptime bar: official openrouter.ai rule -----------------------------
		// Verified against the live site bundle (module 142559 + the provider-table
		// uptime cell component):
		//   value null / NaN -> noData (--color-border, neutral gray)
		//   value >= 95      -> good   (--color-positive,  green)
		//   value >= 85      -> warning(--color-warning,   orange)
		//   value <  85      -> bad    (--color-negative,  red)
		// The site renders three 6x14px bars (h-3.5 w-1.5 gap-px), oldest first,
		// one per recent uptime bucket. The public API only exposes the 5m / 30m /
		// 1d windows, so those become the three bars, ordered widest-to-current.
		const UPTIME_GOOD_MIN = 95
		const UPTIME_WARNING_MIN = 85
		const UPTIME_BAR_COLORS = {
			good: 'var(--dsw-alias-state-success-primary,#2fb344)',
			warning: 'var(--dsw-alias-state-warn-primary,#e6a23c)',
			bad: 'var(--dsw-alias-state-error-primary,#e5484d)',
			noData: 'var(--dsw-alias-bg-layer-3,#d8dce2)'
		}

		function uptimeTone(value) {
			if (typeof value !== 'number' || !Number.isFinite(value)) return 'noData'
			return value >= UPTIME_GOOD_MIN ? 'good' : value >= UPTIME_WARNING_MIN ? 'warning' : 'bad'
		}

		// Factory scope on purpose: a component declared inside a render body gets a
		// fresh identity on every render (and remounts its own subtree each time).
		function UptimeBar(props) {
			try {
				const buckets = [
					{ key: '1d', label: '1d', value: props ? props.uptime1d : null },
					{ key: '30m', label: '30m', value: props ? props.uptime30m : null },
					{ key: '5m', label: '5m', value: props ? props.uptime5m : null }
				]
				const parts = buckets.map((bucket) => `${bucket.label} ${formatUptime(bucket.value)}`)
				const status = props ? props.status : null
				if (typeof status === 'number' && status !== 0) parts.push(`status ${status}`)
				const title = `Uptime · ${parts.join(' · ')}`
				return h('span', {
					className: 'orm-uptime-bar',
					title,
					'aria-label': title,
					role: 'img'
				}, buckets.map((bucket) => {
					const tone = uptimeTone(bucket.value)
					return h('span', {
						key: bucket.key,
						className: `orm-uptime-chip orm-uptime-${tone}`,
						style: { background: UPTIME_BAR_COLORS[tone] }
					})
				}))
			} catch (error) {
				return null
			}
		}

		function countryFlag(code) {
			if (typeof code !== 'string' || !/^[A-Za-z]{2}$/.test(code)) return ''
			const base = 127397
			const upper = code.toUpperCase()
			return String.fromCodePoint(base + upper.charCodeAt(0), base + upper.charCodeAt(1))
		}

		function formatShortDate(value) {
			if (typeof value !== 'string' || value === '') return ''
			const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
			return match ? `${match[2]}-${match[3]}` : value
		}

		function priceCell(value, beforeValue, isFree, lang, discount) {
			const label = formatPrice(value, isFree, lang)
			if (discount > 0 && typeof beforeValue === 'number' && Number.isFinite(beforeValue) && beforeValue > value) {
				return h('span', { className: 'orm-price-cell' },
					h('span', { className: 'orm-price-before' }, formatPrice(beforeValue, false, lang)),
					h('span', { className: 'orm-price-now' }, label))
			}
			return h('span', null, label)
		}

		function formatLatency(value) {
			if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
			return `${value < 1 ? value.toFixed(2) : value.toFixed(1)}s`
		}

		function formatThroughput(value) {
			if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
			return `${value >= 10 ? Math.round(value) : value.toFixed(1)} tok/s`
		}

		function formatClock(ms) {
			try {
				const date = typeof ms === 'number' ? new Date(ms) : new Date()
				const pad = (n) => String(n).padStart(2, '0')
				return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
			} catch (error) {
				return '--:--:--'
			}
		}

		function formatError(error) {
			if (error === null || error === undefined) return 'unknown error'
			if (typeof error === 'string') return error
			return error.message || error.code || String(error)
		}

		// ==================================================================
		// Sorting helpers
		// ==================================================================

		const SORT_KEYS = ['name', 'input', 'output', 'context']

		function compareModels(a, b, key) {
			try {
				if (key === 'input' || key === 'output') {
					const val = (m) => {
						const p = m && m.pricing
						if (p && typeof p[key] === 'number' && Number.isFinite(p[key])) return p[key]
						return Infinity
					}
					return val(a) - val(b)
				}
				if (key === 'context') {
					const val = (m) => (m && typeof m.contextWindow === 'number' && Number.isFinite(m.contextWindow) ? m.contextWindow : Infinity)
					return val(a) - val(b)
				}
				const aname = `${a && a.name ? a.name : ''}`.toLowerCase()
				const bname = `${b && b.name ? b.name : ''}`.toLowerCase()
				const aid = a && typeof a.id === 'string' ? a.id : ''
				const bid = b && typeof b.id === 'string' ? b.id : ''
				return aname.localeCompare(bname) || aid.localeCompare(bid)
			} catch (error) {
				return 0
			}
		}

		const ENDPOINT_COLUMNS = [
			{ key: 'provider', sortable: true },
			{ key: 'input', sortable: true, width: 90 },
			{ key: 'output', sortable: true, width: 90 },
			{ key: 'cache', sortable: true, width: 90 },
			{ key: 'latency', sortable: true, width: 60 },
			{ key: 'throughput', sortable: true, width: 96 },
			{ key: 'uptime', sortable: true, width: 78 },
			{ key: 'quantization', sortable: false, width: 82 }
		]

		function endpointNumeric(row, key) {
			try {
				const p = row && row.pricing
				if (key === 'input') {
					if (p && typeof p.prompt === 'number' && Number.isFinite(p.prompt)) return p.prompt
					return Infinity
				}
				if (key === 'output') {
					if (p && typeof p.completion === 'number' && Number.isFinite(p.completion)) return p.completion
					return Infinity
				}
				if (key === 'cache') {
					if (p && typeof p.cacheRead === 'number' && Number.isFinite(p.cacheRead)) return p.cacheRead
					if (p && typeof p.prompt === 'number' && Number.isFinite(p.prompt)) return p.prompt
					return Infinity
				}
				if (key === 'latency') {
					if (row && typeof row.latencyLast30m === 'number' && Number.isFinite(row.latencyLast30m)) return row.latencyLast30m
					return Infinity
				}
				if (key === 'throughput') {
					if (row && typeof row.throughputLast30m === 'number' && Number.isFinite(row.throughputLast30m)) return row.throughputLast30m
					return Infinity
				}
				if (key === 'uptime') {
					const candidates = [
						row && row.uptimeLast30m,
						row && row.uptimeLast5m,
						row && row.uptimeLast1d
					]
					for (const candidate of candidates) {
						if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
					}
					return Infinity
				}
				return Infinity
			} catch (error) {
				return Infinity
			}
		}

		function endpointProviderLabel(row) {
			const main = row && typeof row.providerName === 'string' && row.providerName !== ''
				? row.providerName
				: (row && typeof row.name === 'string' ? row.name : '')
			const tag = row && typeof row.tag === 'string' && row.tag !== '' ? row.tag : ''
			return `${main} ${tag}`.trim().toLowerCase()
		}

		function compareEndpoints(a, b, key, dir) {
			if (key === 'provider') {
				const order = endpointProviderLabel(a).localeCompare(endpointProviderLabel(b))
				return dir === 'desc' ? -order : order
			}
			const av = endpointNumeric(a, key)
			const bv = endpointNumeric(b, key)
			const aNull = typeof av !== 'number' || !Number.isFinite(av) || av === Infinity
			const bNull = typeof bv !== 'number' || !Number.isFinite(bv) || bv === Infinity
			// Unknown values sink to the bottom whichever direction the column sorts in.
			if (aNull && bNull) return 0
			if (aNull) return 1
			if (bNull) return -1
			return dir === 'desc' ? bv - av : av - bv
		}

		function endpointRowIsFree(p) {
			return p !== null && typeof p === 'object'
				&& Number(p.prompt) === 0 && Number(p.completion) === 0
		}

		// ==================================================================
		// Routing (P2) helpers — strategy model shared with the Host endpoints
		// ==================================================================

		const ROUTING_API = {
			read: '/api/openrouter-models/routing',
			status: '/api/openrouter-models/routing/status',
			save: '/api/openrouter-models/routing/save',
			remove: '/api/openrouter-models/routing/delete'
		}

		// OpenRouter routing identifies a provider by slug, while endpoint rows only
		// carry a display name. The UI therefore derives one canonical key per row
		// (lowercase, non-alphanumerics stripped) and stores it in `only`/`order`.
		// The Host must consume the same derivation when it injects the strategy.
		function providerKey(row) {
			try {
				// Prefer the official OpenRouter provider slug: `provider.order` and
				// `provider.only` address providers by slug, and a name-derived key
				// ("googleaistudio") does not match OpenRouter's ("google-ai-studio").
				const slug = row && typeof row.providerSlug === 'string' ? row.providerSlug.trim() : ''
				if (slug !== '') return slug
				const raw = row && typeof row.providerName === 'string' && row.providerName !== ''
					? row.providerName
					: (row && typeof row.name === 'string' ? row.name : '')
				return String(raw).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
			} catch (error) {
				return ''
			}
		}

		function defaultStrategy() {
			return {
				routingVersion: 2,
				requireParameters: false,
				zdr: false,
				enforceDistillableText: false,
				dataCollection: 'allow',
				preferredMinThroughput: null,
				preferredMaxLatency: null,
				mode: 'auto',
				sort: 'price',
				order: [],
				only: [],
				ignore: [],
				allowFallbacks: true,
				quantizations: [],
				maxPrice: { prompt: null, completion: null, request: null, image: null },
				enabled: false
			}
		}

		function normalizeStrategy(raw) {
			const base = defaultStrategy()
			if (!raw || typeof raw !== 'object') return base
			const mode = raw.mode === 'sort' || raw.mode === 'custom' ? raw.mode : 'auto'
			const sort = raw.sort === 'throughput' || raw.sort === 'latency' ? raw.sort : 'price'
			const maxPrice = raw.maxPrice && typeof raw.maxPrice === 'object' ? raw.maxPrice : {}
			const stringList = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item !== '') : [])
			const price = (key) => raw.routingVersion !== 2 && maxPrice[key] === 0 ? null : parsePriceLimit(maxPrice[key])
			return {
				...base,
				mode,
				sort,
				order: stringList(raw.order),
				only: stringList(raw.only),
				ignore: stringList(raw.ignore),
				requireParameters: raw.requireParameters === true,
				zdr: raw.zdr === true,
				enforceDistillableText: raw.enforceDistillableText === true,
				dataCollection: raw.dataCollection === 'deny' ? 'deny' : 'allow',
				preferredMinThroughput: parsePriceLimit(raw.preferredMinThroughput),
				preferredMaxLatency: parsePriceLimit(raw.preferredMaxLatency),
				allowFallbacks: raw.allowFallbacks !== false,
				quantizations: stringList(raw.quantizations),
				maxPrice: Object.fromEntries(Object.keys(base.maxPrice).map((key) => [key, price(key)])),
				enabled: raw.enabled !== false
			}
		}

		const QUANT_OPTIONS = ['int4', 'int8', 'fp4', 'mxfp4', 'nvfp4', 'fp6', 'fp8', 'mxfp8', 'fp16', 'bf16', 'fp32', 'unknown']

		function eligibleEndpoint(row, strategy, model, checkLists = true) {
			const key = providerKey(row)
			if (checkLists && strategy.only.length && !strategy.only.includes(key)) return false
			if (checkLists && strategy.ignore.includes(key)) return false
			if (strategy.zdr && row.zdr === false) return false
			if (strategy.dataCollection === 'deny' && row.dataCollection === 'allow') return false
			if (strategy.enforceDistillableText && model?.distillableText === false) return false
			const quant = row.quantization || 'unknown'
			if (strategy.quantizations.length && !strategy.quantizations.includes(quant)
				&& !(strategy.quantizations.includes('fp4') && ['mxfp4', 'nvfp4'].includes(quant))
				&& !(strategy.quantizations.includes('fp8') && quant === 'mxfp8')) return false
			return Object.keys(strategy.maxPrice).every((key) => {
				const limit = strategy.maxPrice[key]
				const priceKey = { request: 'perRequest', image: 'perImage' }[key] || key
				const price = row.pricing?.[priceKey]
				return limit === null || !Number.isFinite(price) || price <= limit
			})
		}

		function preferredEndpoint(row, strategy) {
			const { preferredMinThroughput: min, preferredMaxLatency: max } = strategy
			return (min === null || (Number.isFinite(row.throughputP50) && row.throughputP50 >= min))
				&& (max === null || (Number.isFinite(row.latencyP50) && row.latencyP50 <= max))
		}

		function orderIndex(row, strategy) {
			const index = strategy.order.indexOf(providerKey(row))
			return index < 0 ? Infinity : index
		}

		function toggleListValue(list, value) {
			const source = Array.isArray(list) ? list : []
			return source.includes(value) ? source.filter((item) => item !== value) : source.concat([value])
		}

		function toggleQuantization(strategy, quantization) {
			const next = normalizeStrategy(strategy)
			next.quantizations = toggleListValue(next.quantizations, quantization)
			return next
		}

		// Empty or invalid input means "no limit" (null); negative values are
		// rejected rather than silently becoming a $0 cap.
		function parsePriceLimit(raw) {
			if (raw === null || raw === undefined) return null
			const text = String(raw).trim()
			if (text === '') return null
			const value = Number(text)
			if (!Number.isFinite(value) || value < 0) return null
			return value
		}

		function formatPriceLimit(value) {
			if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return ''
			return String(value)
		}

		function setMaxPrice(strategy, field, raw) {
			const next = normalizeStrategy(strategy)
			const parsed = parsePriceLimit(raw)
			next.maxPrice[field] = parsed
			return next
		}

		function rowProviderKeys(rows) {
			const all = []
			for (const row of rows) {
				const key = providerKey(row)
				if (key !== '' && !all.includes(key)) all.push(key)
			}
			return all
		}

		function setOrderPosition(strategy, key, position) {
			const next = normalizeStrategy(strategy)
			const rest = next.order.filter((item) => item !== key)
			if (position === null) {
				// An empty number field means "not in the explicit order".
				next.order = rest
				return next
			}
			const parsed = typeof position === 'number' && Number.isFinite(position) ? Math.round(position) : null
			const index = parsed === null ? rest.length : Math.max(0, Math.min(rest.length, parsed - 1))
			rest.splice(index, 0, key)
			next.order = rest
			return next
		}

		// ==================================================================
		// Shared styles (orm- prefix, --dsw-alias-* tokens only)
		// ==================================================================

		const ORM_CSS = `
.orm-scope{ font-family:inherit; color:var(--dsw-alias-label-primary,#1f2328); box-sizing:border-box; }
.orm-scope *, .orm-scope *::before, .orm-scope *::after { box-sizing:border-box; }
.orm-badge{ display:inline-block; padding:1px 8px; border-radius:999px; border:1px solid var(--dsw-alias-state-success-primary,#2fb344); color:var(--dsw-alias-state-success-primary,#2fb344); font-size:11px; line-height:16px; white-space:nowrap; }
.orm-badge-off{ display:inline-block; padding:1px 8px; border-radius:999px; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,0.14)); color:var(--dsw-alias-label-tertiary,#80868f); font-size:11px; line-height:16px; white-space:nowrap; }
.orm-route-open{ display:inline-block; padding:1px 8px; border-radius:999px; border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,0.12)); background:transparent; color:var(--dsw-alias-label-secondary,#4d5560); font-size:11px; line-height:16px; white-space:nowrap; cursor:pointer; }
.orm-route-open:hover{ border-color:var(--dsw-alias-brand-primary,#4f8cff); color:var(--dsw-alias-brand-primary,#4f8cff); }
.orm-readonly-note{ font-size:11px; line-height:16px; color:var(--dsw-alias-label-tertiary,#80868f); }
.orm-error{ padding:10px 12px; border:1px solid var(--dsw-alias-state-warn-primary,#e6a23c); border-radius:8px; background:var(--dsw-alias-bg-layer-1,#f5f6f8); color:var(--dsw-alias-state-warn-primary,#e6a23c); font-size:12px; line-height:18px; word-break:break-word; }

/* entry row (settings.models.footer) */
.orm-entry{ display:flex; align-items:center; gap:12px; padding:8px 0; }
.orm-entry-btn{ display:inline-flex; align-items:center; gap:6px; padding:5px 14px; border-radius:8px; border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,0.12)); background:var(--dsw-alias-bg-layer-1,#f5f6f8); color:var(--dsw-alias-label-primary,#1f2328); font-size:13px; line-height:18px; cursor:pointer; }
.orm-entry-btn:hover{ border-color:var(--dsw-alias-brand-primary,#4f8cff); color:var(--dsw-alias-brand-primary,#4f8cff); }
.orm-entry-desc{ font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary,#4d5560); }

/* overlay panel (shell.overlay) */
.orm-dialog{ color:var(--dsw-alias-label-primary,#1f2328); }
.orm-dialog::backdrop{ background:var(--dsw-alias-bg-mask,rgba(0,0,0,0.45)); }
.orm-overlay{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }
.orm-card{ width:calc(100% - 32px); max-width:1680px; height:94vh; display:flex; flex-direction:column; overflow:hidden; border-radius:var(--dsw-radius-xl,14px); border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,0.12)); background:var(--dsw-alias-bg-layer-1,#ffffff); box-shadow:0 18px 48px var(--dsw-alias-bg-mask,rgba(0,0,0,0.35)); }
.orm-head{ position:relative; display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,0.08)); }
.orm-title{ font-size:15px; font-weight:600; line-height:20px; margin:0; }
.orm-views{ display:inline-flex; gap:2px; padding:2px; border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,0.12)); border-radius:8px; }
.orm-view-btn{ border:0; background:transparent; color:var(--dsw-alias-label-secondary,#4d5560); font-size:12px; line-height:18px; padding:3px 10px; border-radius:6px; cursor:pointer; }
.orm-view-btn:hover{ color:var(--dsw-alias-label-primary,#1f2328); }
.orm-view-btn-active{ background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,0.06)); color:var(--dsw-alias-label-primary,#1f2328); font-weight:600; }
.orm-order-idx{ display:inline-block; min-width:18px; margin-right:6px; color:var(--dsw-alias-label-tertiary,#80868f); font-size:11px; }
.orm-data-time{ font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary,#4d5560); white-space:nowrap; }
.orm-data-time-stale{ color:var(--dsw-alias-state-warn-primary,#e6a23c); font-weight:600; }
.orm-head-spacer{ flex:1 1 auto; min-width:0; }
.orm-toolbar{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 16px; border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,0.08)); }
.orm-search{ flex:0 1 260px; min-width:180px; height:30px; padding:0 10px; border-radius:8px; border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,0.12)); background:var(--dsw-alias-bg-layer-2,#ffffff); color:var(--dsw-alias-label-primary,#1f2328); font-size:13px; outline:none; }
.orm-search:focus{ border-color:var(--dsw-alias-brand-primary,#4f8cff); }
.orm-chip{ padding:4px 12px; border-radius:999px; border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,0.12)); background:transparent; color:var(--dsw-alias-label-secondary,#4d5560); font-size:12px; line-height:18px; cursor:pointer; white-space:nowrap; }
.orm-chip-active{ border-color:var(--dsw-alias-brand-primary,#4f8cff); color:var(--dsw-alias-brand-primary,#4f8cff); background:var(--dsw-alias-brand-tertiary,rgba(79,140,255,0.10)); }
.orm-select{ height:30px; padding:0 6px; border-radius:8px; border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,0.12)); background:var(--dsw-alias-bg-layer-2,#ffffff); color:var(--dsw-alias-label-primary,#1f2328); font-size:12px; cursor:pointer; outline:none; }
.orm-dir-btn{ height:30px; padding:0 10px; border-radius:8px; border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,0.12)); background:var(--dsw-alias-bg-layer-2,#ffffff); color:var(--dsw-alias-label-secondary,#4d5560); font-size:12px; cursor:pointer; }
.orm-count{ font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary,#80868f); margin-left:auto; white-space:nowrap; }
.orm-banner{ padding:8px 16px; font-size:12px; line-height:18px; border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,0.08)); color:var(--dsw-alias-state-warn-primary,#e6a23c); background:var(--dsw-alias-bg-layer-1,#ffffff); word-break:break-word; }
.orm-scroll{ flex:1 1 auto; min-height:0; overflow:auto; }
.orm-table{ width:100%; border-collapse:collapse; font-size:13px; }
.orm-table th{ position:sticky; top:0; z-index:1; background:var(--dsw-alias-bg-layer-2,#f5f6f8); color:var(--dsw-alias-label-secondary,#4d5560); font-weight:500; text-align:left; padding:7px 10px; border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,0.08)); white-space:nowrap; font-size:12px; }
.orm-table td{ padding:7px 10px; border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,0.05)); vertical-align:middle; }
.orm-row{ cursor:pointer; }
.orm-row:hover td{ background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,0.02)); }
.orm-row-open-bg td{ background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,0.02)); }
.orm-th-sortable{ cursor:pointer; user-select:none; }
.orm-th-sortable:hover{ color:var(--dsw-alias-label-primary,#1f2328); }
.orm-name-wrap{ display:flex; align-items:center; gap:8px; min-width:0; }
.orm-name-text{ min-width:0; display:block; }
.orm-flag{ font-size:13px; line-height:1; flex:none; min-width:16px; }
.orm-price-cell{ display:inline-flex; align-items:baseline; gap:5px; justify-content:flex-end; }
.orm-price-before{ color:var(--dsw-alias-label-tertiary,#9aa0a8); text-decoration:line-through; font-size:11px; }
.orm-price-now{ color:var(--dsw-alias-state-success-primary,#1a7f37); }
.orm-discount{ flex:none; margin-left:6px; padding:0 6px; border-radius:999px; font-size:10.5px; line-height:16px; color:var(--dsw-alias-state-success-primary,#1a7f37); background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#1a7f37) 12%, transparent); }
.orm-badge-warn{ margin-left:6px; padding:0 6px; border-radius:999px; font-size:10.5px; line-height:16px; font-weight:400; color:var(--dsw-alias-state-warn-primary,#b26a00); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#b26a00) 12%, transparent); }
.orm-avatar{ width:18px; height:18px; border-radius:5px; object-fit:contain; flex:none; background:var(--dsw-alias-bg-layer-2,#f2f3f5); }
.orm-avatar-fallback{ display:inline-flex; align-items:center; justify-content:center; font-weight:600; letter-spacing:0.02em; color:var(--dsw-alias-label-secondary,#4d5560); background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2,#e9ebee)); }
.orm-name-main{ display:block; font-size:13px; line-height:18px; color:var(--dsw-alias-label-primary,#1f2328); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.orm-name-sub{ display:block; font-size:11px; line-height:15px; color:var(--dsw-alias-label-tertiary,#80868f); word-break:break-all; }
.orm-num{ font-variant-numeric:tabular-nums; white-space:nowrap; }
.orm-uptime-bar{ display:inline-flex; align-items:flex-end; gap:1px; height:14px; margin-right:6px; flex:none; vertical-align:middle; }
.orm-uptime-chip{ display:inline-block; width:6px; height:100%; border-radius:1px; background:var(--dsw-alias-bg-layer-3,#d8dce2); }
.orm-checkbox{ cursor:pointer; accent-color:var(--dsw-alias-brand-primary,#4f8cff); }
.orm-expand-btn{ width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; border-radius:6px; color:var(--dsw-alias-label-secondary,#4d5560); cursor:pointer; }
.orm-expand-btn:hover{ background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,0.06)); }
.orm-route-steps,.orm-route-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0;}
.orm-route-steps button[aria-pressed="true"],.orm-route-chips button[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary,#4f8cff);color:var(--dsw-alias-brand-primary,#4f8cff);}
.orm-route-steps button:disabled{opacity:.45;cursor:not-allowed;}
.orm-route-controls label{display:inline-flex;align-items:center;gap:5px;}
.orm-route-controls .orm-route-hint,.orm-route-controls .orm-route-chips{flex-basis:100%;}
.orm-route-excluded td{background:var(--dsw-alias-bg-layer-2,#f0f1f3);color:var(--dsw-alias-label-secondary,#4d5560);}
.orm-prov-sort{display:inline-flex;align-items:center;gap:5px;padding:2px 0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;}
.orm-prov-sort span{font-size:10px;color:var(--dsw-alias-label-secondary,#4d5560);}
.orm-refresh-notice{position:absolute;z-index:5;right:16px;top:calc(100% + 8px);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 4px 14px #0002;display:inline-flex;align-items:center;padding:5px 10px;border-radius:999px;border:1px solid currentColor;font-size:12px;font-weight:600;white-space:nowrap;}
.orm-toast{position:fixed;z-index:2147483000;right:28px;top:28px;max-width:min(440px,calc(100vw - 56px));padding:10px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2328);box-shadow:0 10px 30px #0003;border:1px solid var(--dsw-alias-border-l2,#e5e6eb);font-size:13px;font-weight:600;line-height:1.45;display:flex;align-items:center;gap:8px;}
.orm-toast-ok{ border-color:var(--dsw-alias-state-success-primary,#2fb344); }
.orm-toast-err{ border-color:var(--dsw-alias-state-warn-primary,#e6a23c); }
.orm-route-steps .orm-step-btn{display:inline-flex;align-items:center;gap:9px;min-height:44px;padding:8px 14px;border-radius:10px;font-size:14px;font-weight:650;background:var(--dsw-alias-bg-layer-1,#fff);}
.orm-step-num{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-bg-layer-3,#eef0f3);font-size:11px;}
.orm-route-controls{padding:12px;align-items:center;border:1px solid var(--dsw-alias-border-l2,#dedfe2);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);}
.orm-route-controls label{padding:6px 9px;border:1px solid var(--dsw-alias-border-l2,#dedfe2);border-radius:7px;}
.orm-route-controls select{font:inherit;border:1px solid var(--dsw-alias-border-l2,#dedfe2);border-radius:5px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;padding:3px 6px;}
.orm-route-controls .orm-route-chips button{margin:0 2px;}
.orm-prov-title > span:first-child{font-size:15px;font-weight:700;}
.orm-route-steps .orm-route-bar{margin:0;}
.orm-expanded-td{ padding:0 16px 14px; background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,0.015)); }
.orm-prov-title{ display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin:12px 0 8px; font-size:12px; color:var(--dsw-alias-label-secondary,#4d5560); }
.orm-prov-note{ font-size:11px; color:var(--dsw-alias-label-tertiary,#80868f); }
.orm-prov-scroll{ overflow-x:auto; }
.orm-prov-table{ width:100%; min-width:var(--orm-prov-min,840px); max-width:var(--orm-prov-max,1060px); table-layout:fixed; border-collapse:collapse; font-size:12px; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,0.08)); background:var(--dsw-alias-bg-layer-1,#ffffff); }
.orm-prov-table th{ font-weight:500; color:var(--dsw-alias-label-secondary,#4d5560); text-align:left; padding:6px 8px; border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,0.08)); white-space:nowrap; background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,0.02)); }
.orm-prov-table th.sortable:hover{ color:var(--dsw-alias-brand-primary,#4f8cff); }
.orm-prov-table td{ padding:6px 8px; border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,0.05)); }
.orm-prov-name-main{ font-size:12px; color:var(--dsw-alias-label-primary,#1f2328); }
.orm-prov-name-sub{ display:block; font-size:11px; color:var(--dsw-alias-label-tertiary,#80868f); }
.orm-center-note{ padding:28px 16px; display:flex; flex-direction:column; gap:10px; align-items:center; color:var(--dsw-alias-label-secondary,#4d5560); font-size:13px; text-align:center; }
.orm-foot{ display:flex; align-items:center; gap:12px; padding:10px 16px; border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,0.08)); background:var(--dsw-alias-bg-layer-2,#ffffff); }
.orm-foot-count{ font-size:13px; color:var(--dsw-alias-label-primary,#1f2328); white-space:nowrap; }
.orm-foot-msg{ font-size:12px; line-height:18px; min-width:0; flex:1 1 auto; word-break:break-word; }
.orm-msg-ok{ color:var(--dsw-alias-state-success-primary,#2fb344); }
.orm-msg-err{ color:var(--dsw-alias-state-warn-primary,#e6a23c); }
.orm-ghost-btn{ padding:5px 12px; border-radius:8px; border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,0.12)); background:transparent; color:var(--dsw-alias-label-secondary,#4d5560); font-size:12px; line-height:18px; cursor:pointer; white-space:nowrap; }
.orm-ghost-btn:hover{ color:var(--dsw-alias-label-primary,#1f2328); }
.orm-primary-btn{ padding:5px 16px; border-radius:8px; border:1px solid transparent; background:var(--dsw-alias-brand-primary,#4f8cff); color:#ffffff; font-size:13px; line-height:18px; font-weight:600; cursor:pointer; white-space:nowrap; }
.orm-primary-btn:disabled{ opacity:0.45; cursor:not-allowed; }
.orm-spin{ display:inline-block; width:12px; height:12px; border:2px solid var(--dsw-alias-border-secondary,rgba(0,0,0,0.2)); border-top-color:var(--dsw-alias-brand-primary,#4f8cff); border-radius:999px; animation:orm-spin 0.9s linear infinite; vertical-align:-2px; }
@keyframes orm-spin{ to{ transform:rotate(360deg); } }

/* routing (P2): per-model provider strategy editor inside the expanded row */
.orm-badge-route{ margin-left:6px; border-color:var(--dsw-alias-brand-primary,#4f8cff); color:var(--dsw-alias-brand-primary,#4f8cff); }
.orm-route-cell{ display:inline-flex; align-items:center; gap:6px; justify-content:center; }
.orm-route-order{ width:46px; height:22px; padding:0 4px; border-radius:6px; border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,0.12)); background:var(--dsw-alias-bg-layer-2,#ffffff); color:var(--dsw-alias-label-primary,#1f2328); font-size:11px; text-align:center; outline:none; }
.orm-route-order:focus{ border-color:var(--dsw-alias-brand-primary,#4f8cff); }
.orm-route-bar{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:8px 0 2px; font-size:12px; color:var(--dsw-alias-label-secondary,#4d5560); }
.orm-route-summary{ min-width:0; }
.orm-route-state{ font-size:11px; line-height:16px; padding:1px 8px; border-radius:999px; color:var(--dsw-alias-state-success-primary,#2fb344); border:1px solid var(--dsw-alias-state-success-primary,#2fb344); white-space:nowrap; }
.orm-route-state-off{ color:var(--dsw-alias-label-tertiary,#80868f); border-color:var(--dsw-alias-border-secondary,rgba(0,0,0,0.12)); }
.orm-route-advanced-head:hover{ color:var(--dsw-alias-label-primary,#1f2328); }
.orm-route-field{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.orm-route-field-label{ min-width:92px; color:var(--dsw-alias-label-secondary,#4d5560); }
.orm-route-price{ width:88px; height:24px; padding:0 6px; border-radius:6px; border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,0.12)); background:var(--dsw-alias-bg-layer-2,#ffffff); color:var(--dsw-alias-label-primary,#1f2328); font-size:12px; outline:none; }
.orm-route-price:focus{ border-color:var(--dsw-alias-brand-primary,#4f8cff); }
.orm-route-chip{ padding:2px 10px; border-radius:999px; border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,0.12)); background:transparent; color:var(--dsw-alias-label-secondary,#4d5560); font-size:11px; line-height:16px; cursor:pointer; }
.orm-route-chip-active{ border-color:var(--dsw-alias-brand-primary,#4f8cff); color:var(--dsw-alias-brand-primary,#4f8cff); background:var(--dsw-alias-brand-tertiary,rgba(79,140,255,0.10)); }
.orm-route-chips{ display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap; }
.orm-route-maxprice{ display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap; }
.orm-route-hint{ padding:2px 0 6px; font-size:11.5px; line-height:17px; color:var(--dsw-alias-label-tertiary,#80868f); }
`

		function StyleEl() {
			return h('style', null, ORM_CSS)
		}

		function errorFallback(error, tag) {
			return h(React.Fragment, null,
				StyleEl(),
				h('div', { className: 'orm-scope' },
					h('div', { className: 'orm-error' }, `${tag}: ${formatError(error)}`)
				)
			)
		}

		// ==================================================================
		// Routing (P2) components — factory scope on purpose: a component declared
		// inside a render body would get a fresh identity every render and remount.
		// ==================================================================

		function routeText(props, key, params) {
			const t = props && typeof props.t === 'function' ? props.t : null
			if (t) return t(key, params)
			return key
		}

		function RouteBadge(props) {
			try {
				return h('span', {
					className: 'orm-badge orm-badge-route',
					title: routeText(props, 'routeBadgeTitle')
				}, routeText(props, 'routeBadge'))
			} catch (error) {
				return null
			}
		}

		function RouteProviderCell(props) {
			try {
				const disabled = !!(props && props.disabled)
				const showOrder = !!(props && props.showOrder)
				const orderValue = props && typeof props.order === 'number' && Number.isFinite(props.order) ? String(props.order) : ''
				const onOrder = props && typeof props.onOrder === 'function' ? props.onOrder : () => {}
				if (!showOrder) return null
				return h('span', { className: 'orm-route-cell' },
					h('input', {
						type: 'number',
						min: 1,
						max: 99,
						className: 'orm-route-order',
						value: orderValue,
						disabled,
						placeholder: '–',
						'aria-label': routeText(props, 'routeOrder'),
						title: routeText(props, 'routeOrderHint'),
						onChange: (event) => {
							if (disabled) return
							const raw = event && event.target ? event.target.value : ''
							const parsed = raw === '' ? null : Number(raw)
							onOrder(Number.isFinite(parsed) ? parsed : null)
						}
					})
				)
			} catch (error) {
				return null
			}
		}

		function RouteSaveBar(props) {
			try {
				const disabled = !!(props && props.disabled)
				const saving = !!(props && props.saving)
				const msg = props ? props.msg : null
				const onSave = props && typeof props.onSave === 'function' ? props.onSave : () => {}
				const onClear = props && typeof props.onClear === 'function' ? props.onClear : () => {}
				const onProbe = props && typeof props.onProbe === 'function' ? props.onProbe : null
				const probing = !!(props && props.probing)
				return h('div', { className: 'orm-route-bar' },
					h('button', {
						type: 'button',
						className: 'orm-primary-btn orm-route-save',
						disabled: disabled || saving,
						onClick: () => {
							if (!disabled && !saving) onSave()
						}
					}, saving ? routeText(props, 'routeSaving') : routeText(props, 'routeSave')),
					h('button', {
						type: 'button',
						className: 'orm-ghost-btn orm-route-clear',
						disabled: props.clearDisabled || saving,
						onClick: () => {
							if (!props.clearDisabled && !saving) onClear()
						}
					}, routeText(props, 'routeClear')),
					onProbe !== null
						? h('button', {
							type: 'button',
							className: 'orm-ghost-btn orm-route-probe',
							disabled: props.clearDisabled || saving || probing,
							title: routeText(props, 'routeProbe'),
							onClick: () => {
								if (!props.clearDisabled && !saving && !probing) onProbe()
							}
						}, probing ? routeText(props, 'routeProbing') : routeText(props, 'routeProbe'))
						: null,
					msg !== null && msg !== undefined
						? h('span', { className: `orm-foot-msg ${msg.kind === 'ok' ? 'orm-msg-ok' : 'orm-msg-err'}` }, msg.text)
						: null
				)
			} catch (error) {
				return null
			}
		}

		function RouteControls({ t, step, strategy, onChange, disabled, showLists, onToggleLists }) {
			const patch = (fields) => onChange({ ...strategy, ...fields, enabled: true })
			const checkbox = (label, checked, change) => h('label', null,
				h('input', { type: 'checkbox', checked, disabled, onChange: (event) => change(event.target.checked) }), label)
			const number = (label, value, change) => h('label', null, label, h('input', {
				type: 'number', min: 0, step: 'any', className: 'orm-route-price',
				value: formatPriceLimit(value), disabled, onChange: (event) => change(event.target.value)
			}))
			const select = (label, value, options, change) => h('label', null, label, h('select', {
				value, disabled, onChange: (event) => change(event.target.value)
			}, options.map(([key, name]) => h('option', { key, value: key }, name))))
			if (step === 1) return h('div', { className: 'orm-route-controls' },
				checkbox(t('routeLists'), showLists, onToggleLists),
				showLists ? h('button', { type: 'button', className: 'orm-ghost-btn', disabled,
					onClick: () => patch({ only: [], ignore: [] })
				}, t('routeResetLists')) : null,
				checkbox(t('routeRequire'), strategy.requireParameters, (requireParameters) => patch({ requireParameters })),
				checkbox(t('routeData'), strategy.dataCollection === 'deny', (deny) => patch({ dataCollection: deny ? 'deny' : 'allow' })),
				checkbox(t('routeZdr'), strategy.zdr, (zdr) => patch({ zdr })),
				checkbox(t('routeDistill'), strategy.enforceDistillableText, (enforceDistillableText) => patch({ enforceDistillableText })),
				number(t('routeMaxPricePrompt'), strategy.maxPrice.prompt, (value) => onChange(setMaxPrice({ ...strategy, enabled: true }, 'prompt', value))),
				number(t('routeMaxPriceCompletion'), strategy.maxPrice.completion, (value) => onChange(setMaxPrice({ ...strategy, enabled: true }, 'completion', value))),
				number(t('routeMaxPriceRequest'), strategy.maxPrice.request, (value) => onChange(setMaxPrice({ ...strategy, enabled: true }, 'request', value))),
				number(t('routeMaxPriceImage'), strategy.maxPrice.image, (value) => onChange(setMaxPrice({ ...strategy, enabled: true }, 'image', value))),
				h('div', { className: 'orm-route-chips' }, t('routeQuant'), QUANT_OPTIONS.map((quant) =>
					h('button', { key: quant, type: 'button', disabled, className: 'orm-ghost-btn',
						'aria-pressed': strategy.quantizations.includes(quant),
						onClick: () => onChange(toggleQuantization({ ...strategy, enabled: true }, quant))
					}, quant))),
				h('div', { className: 'orm-route-hint' }, t('routeRuntime')))
			if (step === 2) return h('div', { className: 'orm-route-controls' },
				select(t('routeStrategy'), strategy.mode, [
					['auto', t('routeModeAuto')], ['custom', t('routeModeCustom')], ['sort', t('routeSort')]
				], (mode) => patch({ mode })),
				strategy.mode === 'sort' ? select(t('routeSortBy'), strategy.sort, [
					['price', t('routeModeCheapest')], ['throughput', t('routeModeFastest')], ['latency', t('routeModeLatency')]
				], (sort) => patch({ sort })) : null,
				strategy.mode === 'custom' ? h('span', null, t('routeOrderHint')) : null)
			if (step === 3) {
				return h('div', { className: 'orm-route-controls' },
					number(t('routeMin'), strategy.preferredMinThroughput, (value) => patch({ preferredMinThroughput: parsePriceLimit(value) })),
					number(t('routeMax'), strategy.preferredMaxLatency, (value) => patch({ preferredMaxLatency: parsePriceLimit(value) })),
					h('div', { className: 'orm-route-hint' }, t('routePerfHint')))
			}
			return h('div', { className: 'orm-route-controls' },
				checkbox(t('routeFallbacks'), strategy.allowFallbacks, (allowFallbacks) => patch({ allowFallbacks })),
				h('span', null, t('routeFallbacksHint')))
		}

		function InjectionStatus(props) {
			try {
				const state = props && typeof props.state === 'string' ? props.state : 'idle'
				const enabled = !!(props && props.enabled)
				const text = state === 'error'
					? routeText(props, 'routeInjectUnavailable')
					: (state !== 'ready' ? routeText(props, 'routeInjectLoading') : (enabled ? routeText(props, 'routeInjectOn') : routeText(props, 'routeInjectOff')))
				const title = state === 'error'
					? routeText(props, 'routeUnavailable')
					: (enabled ? routeText(props, 'routeInjectOnHint') : routeText(props, 'routeInjectOffHint'))
				const off = state === 'ready' && !enabled
				return h('span', {
					className: off ? 'orm-route-state orm-route-state-off' : 'orm-route-state',
					title
				}, text)
			} catch (error) {
				return null
			}
		}

		// ==================================================================
		// Entry component (settings.models.footer)
		// ==================================================================

		function Entry() {
			const lang = currentLang()
			const t = useMemo(() => makeTranslator(lang), [lang])
			try {
				return h(React.Fragment, null,
					StyleEl(),
					h('div', { className: 'orm-scope orm-entry' },
						h('button', {
							type: 'button',
							className: 'orm-entry-btn',
							onClick: () => {
								try {
									setPanelOpen(true)
								} catch (error) {}
							}
						}, t('entryButton')),
						h('span', { className: 'orm-entry-desc' }, t('entryDesc'))
					)
				)
			} catch (error) {
				return errorFallback(error, NS)
			}
		}

		// ==================================================================
		// Panel component (shell.overlay)
		// ==================================================================

		function Panel() {
			const open = usePanelOpen()
			const lang = currentLang()
			const t = useMemo(() => makeTranslator(lang), [lang])
			const langRef = useRef(lang)
			langRef.current = lang

			// data states
			const [models, setModels] = useState(null) // { models, cachedAt, stale, source, modelCount }
			const [modelsLoading, setModelsLoading] = useState(false)
			const [modelsError, setModelsError] = useState(null)
			const [modelsLoadedOnce, setModelsLoadedOnce] = useState(false)
			const [installed, setInstalled] = useState(null)
			const [status, setStatus] = useState(null)
			const [refreshing, setRefreshing] = useState(false)
			const [refreshNotice, setRefreshNotice] = useState(null)
			const [importing, setImporting] = useState(false)
			const [importMsg, setImportMsg] = useState(null) // { kind: 'ok'|'err', text }
			// transient top-right toast for import / route-probe results
			const [toast, setToast] = useState(null) // { kind: 'ok'|'err', text }
			const [selectionOverrides, setSelectionOverrides] = useState(() => new Map())
			// modelId -> { status:'loading'|'ready'|'error', endpoints, cachedAt, stale, error, sortKey, sortDir }
			const [expanded, setExpanded] = useState(() => new Map())
			const expandedRef = useRef(expanded)
			expandedRef.current = expanded
			const loadedEndpoints = useRef(new Map())
			// routing (P2): { state:'idle'|'loading'|'ready'|'error', data:{strategies,updatedAt,injection,status}, error }
			const [routing, setRouting] = useState({ state: 'idle', data: null, error: null })
			// modelId -> local strategy draft (edited but not yet saved)
			const [routeDrafts, setRouteDrafts] = useState(() => new Map())
			const [routeSteps, setRouteSteps] = useState(() => new Map())
			const [routeLists, setRouteLists] = useState(() => new Map())
			const [routeSaving, setRouteSaving] = useState(null)
			const [routeProbing, setRouteProbing] = useState(null)
			// modelId -> { kind:'ok'|'err', text }
			const [routeMsg, setRouteMsg] = useState(() => new Map())

			// page: catalogue (browse/import) or configured (read-only config+route view)
			const [view, setView] = useState('catalog')

			// toolbar states
			const [searchInput, setSearchInput] = useState('')
			const [searchText, setSearchText] = useState('')
			const [filter, setFilter] = useState('all') // all | text | image | free | added
			const [sortKey, setSortKey] = useState('name')
			const [sortDir, setSortDir] = useState('asc')
			const [rowLimit, setRowLimit] = useState(150)
			const scrollRef = useRef(null)
			const dialogRef = useRef(null)

			// Auto-dismiss the transient toast (import result, route probe result).
			useEffect(() => {
				if (toast === null) return undefined
				const timer = setTimeout(() => { setToast(null) }, 4500)
				return () => clearTimeout(timer)
			}, [toast])

			// Every view opens with rows collapsed: switching the filter, the page or
			// opening the panel clears stale expansions.
			useEffect(() => {
				setExpanded(new Map())
			}, [filter, open, view])

			// The Configured page is rendered from the DSH config + routing store, so
			// (re)load both when it becomes visible.
			useEffect(() => {
				if (view !== 'configured') return
				void loadInstalled().catch(() => {})
				void loadRouting().catch(() => {})
			}, [view])

			// Keep the native dialog in sync with the open state. Outside clicks cannot
			// dismiss it any more: only the explicit close button (and Esc) do.
			useEffect(() => {
				const node = dialogRef.current
				if (!open || !node) return undefined
				try {
					if (typeof node.showModal === 'function' && node.open !== true) node.showModal()
				} catch (error) {}
				return () => {
					try {
						if (typeof node.close === 'function' && node.open === true) node.close()
					} catch (error) {}
				}
			}, [open])

			const installedIdSet = useMemo(() => {
				const set = new Set()
				if (installed && Array.isArray(installed.models)) {
					for (const row of installed.models) {
						if (row && typeof row.id === 'string') set.add(row.id)
					}
				}
				return set
			}, [installed])

			// ---------------- data loading ----------------

			const loadModels = useCallback(async (force) => {
				setModelsLoading(true)
				try {
					const now = Date.now()
					if (!force && memModels.payload && now - memModels.at < CLIENT_MODELS_TTL_MS) {
						setModels(memModels.payload)
						setModelsError(null)
					} else {
						const value = await apiGet(force ? '/api/openrouter-models/models?refresh=1' : '/api/openrouter-models/models')
						if (value && Array.isArray(value.models)) {
							memModels = { at: Date.now(), payload: value }
							setModels(value)
							setModelsError(null)
							setModelsLoadedOnce(true)
							return value.stale !== true
						} else {
							throw new Error('malformed models response')
						}
					}
				} catch (error) {
					setModelsError(error)
					if (memModels.payload) {
						setModels(memModels.payload)
						setModelsLoadedOnce(true)
					}
					return false
				} finally {
					setModelsLoading(false)
				}
			}, [])

			const loadInstalled = useCallback(async () => {
				try {
					const value = await apiGet('/api/openrouter-models/installed')
					setInstalled(value && typeof value === 'object' ? value : { configured: false, count: 0, models: [] })
					return value
				} catch (error) {
					setInstalled((prev) => (prev === null ? { configured: false, count: 0, models: [] } : prev))
				}
			}, [])

			const loadStatus = useCallback(async () => {
				try {
					const value = await apiGet('/api/openrouter-models/status')
					if (value && typeof value === 'object') setStatus(value)
				} catch (error) {
					// status is auxiliary; ignore failures
				}
			}, [])

			// Routing is optional: an older or not-yet-updated Host answers 404/error.
			// The panel must keep working and show "routing service unavailable".
			const loadRouting = useCallback(async () => {
				setRouting((prev) => ({ state: prev && prev.state === 'ready' ? 'ready' : 'loading', data: prev ? prev.data : null, error: null }))
				try {
					const read = await apiGet(ROUTING_API.read)
					let statusValue = null
					try {
						statusValue = await apiGet(ROUTING_API.status)
					} catch (statusError) {
						statusValue = null
					}
					const strategies = read && read.strategies && typeof read.strategies === 'object' ? read.strategies : {}
					setRouting({
						state: 'ready',
						data: {
							strategies,
							updatedAt: read && typeof read.updatedAt === 'number' ? read.updatedAt : null,
							injection: read && read.injection && typeof read.injection === 'object' ? read.injection : null,
							status: statusValue && typeof statusValue === 'object' ? statusValue : null
						},
						error: null
					})
				} catch (error) {
					setRouting((prev) => ({
						state: 'error',
						data: prev && prev.data ? prev.data : null,
						error: formatError(error)
					}))
				}
			}, [])

			const loadAll = useCallback(async (forceModels) => {
				await Promise.all([
					loadModels(forceModels === true),
					loadInstalled(),
					loadStatus(),
					loadRouting()
				])
			}, [loadModels, loadInstalled, loadStatus, loadRouting])

			// Load data whenever the panel opens.
			const loadAllRef = useRef(loadAll)
			loadAllRef.current = loadAll
			const loadRoutingRef = useRef(loadRouting)
			loadRoutingRef.current = loadRouting
			const routingRef = useRef(routing)
			routingRef.current = routing
			useEffect(() => {
				if (!open) return undefined
				setImportMsg(null)
				try {
					loadAllRef.current(false)
				} catch (error) {
					setModelsError(error)
				}
				return undefined
			}, [open])

			// Search debounce (300ms).
			useEffect(() => {
				const timer = window.setTimeout(() => {
					setSearchText(searchInput.trim().toLowerCase())
				}, 300)
				return () => window.clearTimeout(timer)
			}, [searchInput])

			// Esc closes the panel.
			useEffect(() => {
				const onKey = (event) => {
					try {
						if (panelOpen && event && event.key === 'Escape') setPanelOpen(false)
					} catch (error) {}
				}
				document.addEventListener('keydown', onKey)
				return () => {
					document.removeEventListener('keydown', onKey)
				}
			}, [])

			// Reset pager + scroll position when query changes.
			useEffect(() => {
				setRowLimit(150)
				try {
					if (scrollRef.current) scrollRef.current.scrollTop = 0
				} catch (error) {}
			}, [searchText, filter, sortKey, sortDir])

			// ---------------- actions ----------------

			const onRetry = useCallback(async () => {
				try {
					await loadAllRef.current(true)
				} catch (error) {
					setModelsError(error)
				}
			}, [])

			function selectModels(ids, selected) {
				setSelectionOverrides((prev) => {
					const next = new Map(prev)
					for (const id of ids) next.set(id, selected)
					return next
				})
			}

			const selectedIds = useMemo(() => {
				const ids = new Set()
				const saved = Object.entries(routing.data?.strategies || {})
				for (const [id, raw] of new Map([...saved, ...routeDrafts])) {
					const strategy = normalizeStrategy(raw)
					if (!strategy.enabled) continue
					const picks = strategy.only.concat(strategy.mode === 'custom' ? strategy.order : [])
					const rows = loadedEndpoints.current.get(id)
					const model = models?.models?.find((entry) => entry.id === id)
					const hasSelection = Array.isArray(rows)
						? rows.some((row) => picks.includes(providerKey(row)) && eligibleEndpoint(row, strategy, model))
						: picks.some((key) => !strategy.ignore.includes(key))
					if (hasSelection) ids.add(id)
				}
				for (const [id, selected] of selectionOverrides) {
					if (selected) ids.add(id)
					else ids.delete(id)
				}
				return ids
			}, [routing.data, routeDrafts, selectionOverrides, expanded, models])

			const fetchEndpointsFor = useCallback(async (modelId, refresh = false) => {
				try {
					const url = `/api/openrouter-models/endpoints?slug=${encodeURIComponent(modelId)}`
					const value = await apiGet(refresh ? url + '&refresh=1' : url)
					if (!Array.isArray(value?.endpoints)) throw new Error('malformed provider response')
					loadedEndpoints.current.set(modelId, value.endpoints)
					setExpanded((prev) => {
						if (!prev.has(modelId)) return prev
						const next = new Map(prev)
						const old = prev.get(modelId)
						next.set(modelId, {
							status: 'ready',
							endpoints: value && Array.isArray(value.endpoints) ? value.endpoints : [],
							cachedAt: value && typeof value.cachedAt === 'number' ? value.cachedAt : null,
							stale: !!(value && value.stale === true),
							error: null,
							sortKey: old && old.sortKey ? old.sortKey : 'none',
							sortDir: old && old.sortDir ? old.sortDir : 'asc'
						})
						return next
					})
					return value.stale !== true
				} catch (error) {
					setExpanded((prev) => {
						if (!prev.has(modelId)) return prev
						const next = new Map(prev)
						const old = prev.get(modelId)
						if (refresh && old.status === 'ready') return prev
						next.set(modelId, {
							status: 'error',
							endpoints: null,
							cachedAt: null,
							stale: false,
							error: formatError(error),
							sortKey: old && old.sortKey ? old.sortKey : 'none',
							sortDir: old && old.sortDir ? old.sortDir : 'asc'
						})
						return next
					})
					return false
				}
			}, [])

			async function onRefresh() {
				setRefreshing(true)
				setRefreshNotice(null)
				try {
					const results = await Promise.allSettled([
						loadModels(true),
						...Array.from(expandedRef.current.keys(), (id) => fetchEndpointsFor(id, true))
					])
					const ok = results.every((result) => result.status === 'fulfilled' && result.value === true)
					setRefreshNotice({ ok })
				} finally {
					setRefreshing(false)
				}
			}

			useEffect(() => {
				if (!refreshNotice) return
				const timer = setTimeout(() => setRefreshNotice(null), 4000)
				return () => clearTimeout(timer)
			}, [refreshNotice])

			async function openAddedModels() {
				// The Configured view is read-only and starts collapsed: load the
				// installed list and the routing table only; expanding a row is the
				// user's action, not the tab's.
				await Promise.all([loadInstalled(), loadRouting()])
			}

			const toggleExpanded = useCallback((model) => {
				const modelId = model && model.id
				if (typeof modelId !== 'string' || modelId === '') return
				// Opening a row is the natural moment to (re)read the routing table:
				// one GET per expand, skipped while a read is already in flight.
				try {
					if (routingRef.current.state !== 'loading') void loadRoutingRef.current().catch(() => {})
				} catch (error) {}
				setExpanded((prev) => {
					const next = new Map(prev)
					if (next.has(modelId)) {
						next.delete(modelId)
						return next
					}
					next.set(modelId, { status: 'loading', endpoints: null, error: null, cachedAt: null, stale: false, sortKey: 'none', sortDir: 'asc' })
					fetchEndpointsFor(modelId).catch(() => {})
					return next
				})
			}, [fetchEndpointsFor])

			const onEndpointSort = useCallback((modelId, headerKey) => {
				setExpanded((prev) => {
					if (!prev.has(modelId)) return prev
					const old = prev.get(modelId)
					const next = new Map(prev)
					if (old.sortKey === headerKey) {
						next.set(modelId, { ...old, sortDir: old.sortDir === 'asc' ? 'desc' : 'asc' })
					} else {
						next.set(modelId, { ...old, sortKey: headerKey, sortDir: 'asc' })
					}
					return next
				})
			}, [])

			const onRetryEndpoints = useCallback((model) => {
				const modelId = model && model.id
				if (typeof modelId !== 'string') return
				setExpanded((prev) => {
					if (!prev.has(modelId)) return prev
					const next = new Map(prev)
					const old = prev.get(modelId)
					next.set(modelId, { ...old, status: 'loading', error: null })
					fetchEndpointsFor(modelId).catch(() => {})
					return next
				})
			}, [fetchEndpointsFor])

			const onScrollRows = useCallback(() => {
				try {
					const node = scrollRef.current
					if (!node) return
					if (node.scrollTop + node.clientHeight >= node.scrollHeight - 60) {
						setRowLimit((prev) => (prev < filteredRef.current.length ? Math.min(prev + 150, filteredRef.current.length) : prev))
					}
				} catch (error) {}
			}, [])

			// ---------------- import ----------------

			const onImport = useCallback(async () => {
				if (importing) return
				if (selectedIds.size === 0) return
				setImporting(true)
				setImportMsg(null)
				const langNow = langRef.current
				try {
					const byId = new Map()
					const source = memModels.payload && Array.isArray(memModels.payload.models) ? memModels.payload.models : []
					const fallback = modelsDataRef.current
					const catalog = (models && Array.isArray(models.models) ? models.models : [])
						.concat(source.length > 0 ? source : fallback, installed?.models || [])
					for (const model of catalog) {
						if (model && typeof model.id === 'string' && !byId.has(model.id)) byId.set(model.id, model)
					}
					const payload = []
					for (const modelId of selectedIds) {
						const model = byId.get(modelId)
						if (!model) continue
						payload.push({
							id: model.id,
							name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
							contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : null,
							maxTokens: typeof model.maxTokens === 'number' ? model.maxTokens : null,
							input: Array.isArray(model.input) ? model.input.slice() : []
						})
					}
					if (payload.length === 0) throw new Error('selected models are no longer in the catalog')
					const value = await apiPost('/api/openrouter-models/import', JSON.stringify({ models: payload }))
					const added = Array.isArray(value && value.added) ? value.added.length : 0
					const updated = Array.isArray(value && value.updated) ? value.updated.length : 0
					const skipped = Array.isArray(value && value.skipped) ? value.skipped.length : 0
					const total = value && typeof value.total === 'number' ? value.total : null
					let text = makeTranslator(langNow)('importSuccess', { a: added, u: updated, t: total === null ? added + updated : total })
					if (skipped > 0) text += makeTranslator(langNow)('importSkipped', { s: skipped })
					setImportMsg({ kind: 'ok', text })
					setToast({ kind: 'ok', text })
					await loadInstalled()
				} catch (error) {
					const text = `${makeTranslator(langNow)('importFailed')}${formatError(error)}`
					setImportMsg({ kind: 'err', text })
					setToast({ kind: 'err', text })
				} finally {
					setImporting(false)
				}
			}, [importing, selectedIds, models, loadInstalled, installed])

			// ---------------- derived list ----------------

			const modelList = useMemo(() => (
				models && Array.isArray(models.models)
					? models.models.filter((m) => m && typeof m.id === 'string')
					: []
			), [models])

			const filteredModels = useMemo(() => {
				try {
					const catalogById = filter === 'added' ? new Map(modelList.map((model) => [model.id, model])) : null
					let list = catalogById
						? (installed?.models || []).map((model) => ({ ...catalogById.get(model.id), ...model }))
						: modelList
					if (searchText !== '') {
						list = list.filter((m) => {
							const haystack = `${m.id || ''}\n${m.name || ''}\n${m.author || ''}`.toLowerCase()
							return haystack.includes(searchText)
						})
					}
					if (filter === 'text') {
						list = list.filter((m) => Array.isArray(m.input) && m.input.includes('text'))
					} else if (filter === 'image') {
						list = list.filter((m) => Array.isArray(m.input) && m.input.includes('image'))
					} else if (filter === 'free') {
						list = list.filter((m) => m.isFree === true)
					}
					if (filter === 'added') return list
					const dir = sortDir === 'desc' ? -1 : 1
					return list.slice().sort((a, b) => compareModels(a, b, sortKey) * dir)
				} catch (error) {
					return []
				}
			}, [modelList, searchText, filter, sortKey, sortDir, installed])

			// keep refs in sync for callbacks registered before these values change
			const filteredRef = useRef(filteredModels)
			filteredRef.current = filteredModels
			const modelsDataRef = useRef(modelList)
			modelsDataRef.current = modelList

			const visibleModels = useMemo(() => filteredModels.slice(0, rowLimit), [filteredModels, rowLimit])

			const filteredSelectedCount = useMemo(() => {
				let count = 0
				for (const model of filteredModels) {
					if (selectedIds.has(model.id)) count += 1
				}
				return count
			}, [filteredModels, selectedIds])

			// ---------------- routing (P2) ----------------

			const routeStrategies = routing.data && routing.data.strategies && typeof routing.data.strategies === 'object'
				? routing.data.strategies
				: {}
			const routeInjection = routing.data ? routing.data.injection : null
			const routeStatus = routing.data ? routing.data.status : null
			const routingAvailable = routing.state === 'ready'

			function savedStrategyOf(modelId) {
				const raw = Object.prototype.hasOwnProperty.call(routeStrategies, modelId) ? routeStrategies[modelId] : null
				return raw ? normalizeStrategy(raw) : null
			}

			function draftFor(modelId) {
				const existing = routeDrafts.get(modelId)
				if (existing) return normalizeStrategy(existing)
				return savedStrategyOf(modelId) || defaultStrategy()
			}

			function updateDraft(modelId, next) {
				setRouteDrafts((prev) => {
					const map = new Map(prev)
					map.set(modelId, normalizeStrategy(next))
					return map
				})
			}

			function setRouteMessage(modelId, kind, text) {
				const message = { kind, text }
				setRouteMsg((prev) => new Map(prev).set(modelId, message))
				if (kind === 'ok') setTimeout(() => {
					setRouteMsg((prev) => {
						if (prev.get(modelId) !== message) return prev
						const next = new Map(prev)
						next.delete(modelId)
						return next
					})
				}, 3500)
			}

			async function saveStrategy(modelId, strategy) {
				setRouteSaving(modelId)
				try {
					await apiPost(ROUTING_API.save, JSON.stringify({ modelId, strategy: normalizeStrategy(strategy) }))
					setRouteDrafts((prev) => {
						const map = new Map(prev)
						map.delete(modelId)
						return map
					})
					setRouteMessage(modelId, 'ok', t('routeSaved'))
					await loadRoutingRef.current()
				} catch (error) {
					setRouteMessage(modelId, 'err', `${t('routeSaveFailed')}${formatError(error)}`)
				} finally {
					setRouteSaving(null)
				}
			}

			async function clearStrategy(modelId) {
				setRouteSaving(modelId)
				try {
					await apiPost(ROUTING_API.remove, JSON.stringify({ modelId }))
					setRouteDrafts((prev) => {
						const map = new Map(prev)
						map.delete(modelId)
						return map
					})
					setRouteMessage(modelId, 'ok', t('routeCleared'))
					await loadRoutingRef.current()
				} catch (error) {
					setRouteMessage(modelId, 'err', `${t('routeSaveFailed')}${formatError(error)}`)
				} finally {
					setRouteSaving(null)
				}
			}

			async function probeRoute(modelId) {
				setRouteProbing(modelId)
				try {
					const value = await apiGet(`/api/openrouter-models/probe?model=${encodeURIComponent(modelId)}`)
					const provider = value && typeof value.provider === 'string' && value.provider !== '' ? value.provider : null
					if (provider !== null) {
						const text = `${t('routeProbeOk')}${provider}`
						setRouteMessage(modelId, 'ok', text)
						setToast({ kind: 'ok', text })
					} else {
						const detail = value && value.error ? formatError(value.error) : ''
						const text = `${t('routeProbeUnknown')}${detail}`
						setRouteMessage(modelId, 'err', text)
						setToast({ kind: 'err', text })
					}
				} catch (error) {
					const text = `${t('routeProbeFailed')}${formatError(error)}`
					setRouteMessage(modelId, 'err', text)
					setToast({ kind: 'err', text })
				} finally {
					setRouteProbing(null)
				}
			}

			const stale = !!(models && models.stale === true)
			const showStaleBanner = stale || (modelsLoadedOnce && modelsError !== null)
			const dataTime = models && typeof models.cachedAt === 'number' ? models.cachedAt : (status && typeof status.modelsCachedAt === 'number' ? status.modelsCachedAt : null)

			// ---------------- render ----------------

			if (!open) return null

			try {
				return h(React.Fragment, null,
					StyleEl(),
					// A native <dialog> opened with showModal() lives in the browser's
					// top layer, so the settings dialog (a plain fixed element with
					// z-index 1000) can never paint over it — no z-index race, and it
					// wins on the very first click.
					h('dialog', {
						className: 'orm-scope orm-dialog',
						ref: dialogRef,
						onCancel: (event) => {
							try {
								if (event && typeof event.preventDefault === 'function') event.preventDefault()
							} catch (error) {}
							setPanelOpen(false)
						},
						style: {
							position: 'fixed',
							inset: 0,
							margin: 0,
							padding: 0,
							border: 0,
							width: '100vw',
							height: '100vh',
							maxWidth: 'none',
							maxHeight: 'none',
							background: 'transparent',
							overflow: 'hidden'
						}
					},
						h('div', {
							className: 'orm-overlay',
							style: {
								position: 'absolute',
								inset: 0,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center'
							}
						},
						h('div', { className: 'orm-card', role: 'dialog', 'aria-modal': 'true' },
							toast !== null
								? h('div', {
									role: 'status',
									className: 'orm-toast ' + (toast.kind === 'ok' ? 'orm-toast-ok' : 'orm-toast-err')
								}, toast.text)
								: null,

							// ---- header ----
							h('div', { className: 'orm-head' },
								h('h3', { className: 'orm-title' }, t('panelTitle')),
								dataTime !== null
									? h('span', { className: stale ? 'orm-data-time orm-data-time-stale' : 'orm-data-time' },
										stale ? `${t('cachedData')} · ` : `${t('dataTime')} · `,
										formatClock(dataTime))
									: null,
								h('div', { className: 'orm-views', role: 'tablist' },
									h('button', {
										type: 'button', role: 'tab', 'aria-selected': view === 'catalog',
										className: view === 'catalog' ? 'orm-view-btn orm-view-btn-active' : 'orm-view-btn',
										onClick: () => setView('catalog')
									}, t('viewCatalog')),
									h('button', {
										type: 'button', role: 'tab', 'aria-selected': view === 'configured',
										className: view === 'configured' ? 'orm-view-btn orm-view-btn-active' : 'orm-view-btn',
										onClick: () => setView('configured')
									}, t('viewConfigured'))),
								h('div', { className: 'orm-head-spacer' }),
								h('button', {
									type: 'button',
									className: 'orm-ghost-btn',
									disabled: refreshing,
									onClick: () => {
										if (!refreshing) {
											void onRefresh().catch(() => {})
										}
									}
								},
									refreshing ? h('span', { className: 'orm-spin', style: { marginRight: 6 } }) : null,
									refreshing ? t('refreshing') : t('refresh')),
								refreshNotice ? h('span', {
									role: 'status', className: 'orm-refresh-notice ' + (refreshNotice.ok ? 'orm-msg-ok' : 'orm-msg-err')
								}, (refreshNotice.ok ? '✓ ' : '') + t(refreshNotice.ok ? 'refreshDone' : 'refreshIncomplete')) : null,
								view === 'catalog'
									? h('button', {
										type: 'button',
										className: 'orm-primary-btn',
										disabled: importing || selectedIds.size === 0,
										onClick: () => {
											if (!importing) void onImport().catch(() => {})
										}
									}, importing ? t('importing') : t('importBtn'))
									: null,
								h('button', { type: 'button', className: 'orm-ghost-btn', onClick: () => setPanelOpen(false) }, t('close'))
							),

							// ---- toolbar ----
							view === 'catalog' ? h('div', { className: 'orm-toolbar' },
								h('input', {
									type: 'search',
									className: 'orm-search',
									placeholder: t('searchPlaceholder'),
									value: searchInput,
									onChange: (event) => setSearchInput(event && event.target ? event.target.value : '')
								}),
								h('div', { role: 'group' }, buildFilterChips()),
								h('select', {
									className: 'orm-select',
									value: sortKey,
									onChange: (event) => {
										const key = event && event.target ? event.target.value : 'name'
										setSortKey(SORT_KEYS.includes(key) ? key : 'name')
									}
								}, sortOptions()),
								h('button', {
									type: 'button',
									className: 'orm-dir-btn',
									'title': sortDir === 'asc' ? t('sortAsc') : t('sortDesc'),
									onClick: () => setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
								}, sortDir === 'asc' ? '↑' : '↓'),
								h('span', { className: 'orm-count' }, t('totalModels', { n: filteredModels.length }))
							)
							: null,

							// ---- banner: stale cache / network errors ----
							view === 'catalog' && showStaleBanner
								? h('div', { className: 'orm-banner' },
									modelsLoadedOnce && modelsError !== null
										? `${t('lastErrorNote')}${formatError(modelsError)}. ${t('offlineHint')}`
										: (dataTime !== null ? `${t('cachedData')} — ${t('dataTime')} ${formatClock(dataTime)}` : t('cachedData')))
								: null,

							// ---- model table / configured page ----
							view === 'configured' ? renderConfiguredPage() : renderModelsArea(),

							// ---- footer ----
							view === 'catalog' ? h('div', { className: 'orm-foot' },
								h('span', { className: 'orm-foot-count' }, t('footSelected', { n: selectedIds.size })),
								h(InjectionStatus, {
									t,
									state: routing.state,
									enabled: !!(routeStatus && routeStatus.enabled === true) || !!(routeInjection && routeInjection.enabled === true)
								}),

								importMsg !== null
									? h('span', {
										className: `orm-foot-msg ${importMsg.kind === 'ok' ? 'orm-msg-ok' : importMsg.kind === 'err' ? 'orm-msg-err' : ''}`
									}, importMsg.text)
									: null
							)
								: h('div', { className: 'orm-foot' },
									h('span', { className: 'orm-readonly-note' }, t('configuredReadOnly')))
						)
						)
					)
				)
			} catch (error) {
				return errorFallback(error, `${NS} panel`)
			}

			function buildFilterChips() {
				const chips = [
					['all', t('filterAll')],
					['text', t('filterText')],
					['image', t('filterImage')],
					['free', t('filterFree')],
					['added', t('filterAdded')]
				]
				return chips.map(([key, label]) =>
					h('button', {
						type: 'button',
						key,
						className: filter === key ? 'orm-chip orm-chip-active' : 'orm-chip',
						style: { marginRight: 6 },
						onClick: () => {
							setFilter(key)
							if (key === 'added') void openAddedModels()
						}
					}, label))
			}

			function sortOptions() {
				return SORT_KEYS.map((key) =>
					h('option', {
						key,
						value: key
					}, `${t(key === 'name' ? 'sortName' : key === 'input' ? 'sortInput' : key === 'output' ? 'sortOutput' : 'sortContext')} (${sortDir === 'asc' ? t('sortAsc') : t('sortDesc')})`))
			}

			function renderModelsArea() {
				if (filter !== 'added' && models === null && (modelsLoading || !modelsLoadedOnce && modelsError === null)) {
					return h('div', { className: 'orm-scroll' },
						h('div', { className: 'orm-center-note' },
							h('span', { className: 'orm-spin' }),
							h('span', null, t('loading'))
						)
					)
				}
				if (filter !== 'added' && models === null && modelsError !== null) {
					return h('div', { className: 'orm-scroll' },
						h('div', { className: 'orm-center-note' },
							h('span', { className: 'orm-msg-err' }, `${t('loadFailed')}${formatError(modelsError)}`),
							h('span', null, t('offlineHint')),
							h('button', { type: 'button', className: 'orm-ghost-btn', onClick: () => { void onRetry().catch(() => {}) } }, t('retry'))
						)
					)
				}
				return h('div', { className: 'orm-scroll', ref: scrollRef, onScroll: onScrollRows },
					h('table', { className: 'orm-table' },
						h('thead', null,
							h('tr', null,
								h('th', { style: { width: 42, textAlign: 'center' } },
									h('input', {
										type: 'checkbox',
										className: 'orm-checkbox',
										'aria-label': t('selectAll'),
										checked: visibleModels.length > 0 && visibleModels.every((model) => selectedIds.has(model.id)),
										onChange: () => {
											const allSelected = visibleModels.length > 0 && visibleModels.every((model) => selectedIds.has(model.id))
											selectModels(visibleModels.map((model) => model.id), !allSelected)
										}
									})),
								modelHeaderCell('name', t('colModel'), null),
								modelHeaderCell('context', t('colContext'), { width: 92 }),
								modelHeaderCell('input', t('colInput'), { width: 96 }),
								modelHeaderCell('output', t('colOutput'), { width: 96 }),
								h('th', { style: { width: 84 } }, t('colConfigured')),
								h('th', { style: { width: 84 } }, t('colRouter')),
								h('th', { style: { width: 44 } })
							)
						),
						h('tbody', null,
							visibleModels.map((model) => renderModelRow(model)),
							filteredModels.length === 0
								? h('tr', null,
									h('td', { colSpan: 8, style: { padding: 20, textAlign: 'center', color: 'var(--dsw-alias-label-tertiary,#80868f)' } },
										modelList.length === 0 ? (modelsError !== null ? `${t('loadFailed')}${formatError(modelsError)}` : t('emptyCatalog')) : t('noMatch')))
								: null,
							filteredModels.length > rowLimit
								? h('tr', null,
									h('td', { colSpan: 8, style: { padding: 10, textAlign: 'center', color: 'var(--dsw-alias-label-tertiary,#80868f)', fontSize: 12 } },
										t('scrollMore')))
								: null
						)
					)
				)
			}

			function modelHeaderCell(key, label, style) {
				const active = sortKey === key
				const marker = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
				return h('th', {
					key,
					className: 'orm-th-sortable',
					style: style || undefined,
					role: 'button',
					tabIndex: 0,
					title: active
						? (sortDir === 'asc' ? t('sortAsc') : t('sortDesc'))
						: t('sortName'),
					onClick: () => {
						if (active) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
						else { setSortKey(key); setSortDir('asc') }
					},
					onKeyDown: (event) => {
						try {
							if (event && (event.key === 'Enter' || event.key === ' ')) {
								event.preventDefault()
								if (active) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
								else { setSortKey(key); setSortDir('asc') }
							}
						} catch (error) {}
					}
				}, `${label}${marker}`)
			}

			// ---------------- configured page (read-only) ----------------
			// Rendered from the DSH config (installed models) + the routing store
			// (strategies) + the Provider data fetched from OpenRouter's endpoints
			// API. It is deliberately not the model catalogue table: no selection,
			// no import, no routing controls — just the effective routing order.

			function configuredModels() {
				const list = installed && Array.isArray(installed.models) ? installed.models : []
				return list.filter((model) => model && typeof model.id === 'string' && model.id !== '')
			}

			function configuredSummary(saved) {
				if (!saved || saved.enabled !== true) return t('configuredNoRoute')
				if (saved.mode === 'custom' && Array.isArray(saved.order) && saved.order.length > 0) return t('configuredOrdered', { n: saved.order.length })
				if (Array.isArray(saved.only) && saved.only.length > 0) return t('configuredOnly', { n: saved.only.length })
				return t('configuredNoRoute')
			}

			function orderedConfiguredProviders(allRows, saved) {
				const rows = Array.isArray(allRows) ? allRows.slice() : []
				const priceAsc = (a, b) => (Number(a && a.pricing ? a.pricing.prompt : 0) || 0) - (Number(b && b.pricing ? b.pricing.prompt : 0) || 0)
				if (!saved || saved.enabled !== true) {
					rows.sort(priceAsc)
					return rows
				}
				const order = Array.isArray(saved.order) ? saved.order : []
				if (order.length > 0) {
					const position = new Map(order.map((key, index) => [key, index]))
					return rows
						.filter((row) => position.has(providerKey(row)))
						.sort((a, b) => position.get(providerKey(a)) - position.get(providerKey(b)))
				}
				const only = Array.isArray(saved.only) ? saved.only : []
				if (only.length > 0) {
					const allowed = new Set(only)
					return rows.filter((row) => allowed.has(providerKey(row))).sort(priceAsc)
				}
				rows.sort(priceAsc)
				return rows
			}

			function renderConfiguredPage() {
				if (installed === null) {
					return h('div', { className: 'orm-scroll' },
						h('div', { className: 'orm-center-note' },
							h('span', { className: 'orm-spin' }),
							h('span', null, t('loading'))))
				}
				const models = configuredModels()
				if (models.length === 0) {
					return h('div', { className: 'orm-scroll' },
						h('div', { className: 'orm-center-note' }, h('span', null, t('configuredEmpty'))))
				}
				return h('div', { className: 'orm-scroll', ref: scrollRef },
					h('table', { className: 'orm-table' },
						h('thead', null,
							h('tr', null,
								h('th', { style: { width: 72, textAlign: 'center' } }, ''),
								h('th', null, t('colModel')),
								h('th', { style: { width: 260 } }, t('colRouter')),
								h('th', { style: { width: 44 } }))),
						h('tbody', null, models.map((model) => renderConfiguredRow(model)))))
			}

			function renderConfiguredRow(model) {
				const modelId = model.id
				const isOpen = expanded.has(modelId)
				const saved = savedStrategyOf(modelId)
				const routed = !!(saved && saved.enabled)
				const name = typeof model.name === 'string' && model.name !== '' ? model.name : modelId
				return h(React.Fragment, { key: modelId },
					h('tr', {
						className: isOpen ? 'orm-row orm-row-open-bg' : 'orm-row',
						onClick: () => toggleExpanded(model)
					},
					h('td', { style: { textAlign: 'center' }, onClick: (event) => { if (event && event.stopPropagation) event.stopPropagation() } },
						h('span', { className: 'orm-badge' }, t('added'))),
					h('td', { style: { maxWidth: 420, minWidth: 240 } },
						h('span', { className: 'orm-name-wrap' },
							h(BrandIcon, {
								name: modelBrand(model),
								slug: typeof model.author === 'string' && model.author !== '' ? model.author : modelId,
								size: 18
							}),
							h('span', { className: 'orm-name-text' },
								h('span', { className: 'orm-name-main' }, name),
								h('span', { className: 'orm-name-sub' }, modelId)))),
					h('td', null,
						h('span', { className: routed ? 'orm-badge' : 'orm-badge-off' }, configuredSummary(saved))),
					h('td', { style: { textAlign: 'center' }, onClick: (event) => { if (event && event.stopPropagation) event.stopPropagation() } },
						h('span', {
							role: 'button',
							tabIndex: 0,
							className: 'orm-expand-btn',
							'aria-expanded': isOpen,
							onClick: () => toggleExpanded(model),
							onKeyDown: (event) => {
								try {
									if (event && (event.key === 'Enter' || event.key === ' ')) {
										event.preventDefault()
										toggleExpanded(model)
									}
								} catch (error) {}
							}
						}, chevronIcon(isOpen)))),
					isOpen
						? h('tr', { key: `${modelId}#configured` },
							h('td', { colSpan: 4, className: 'orm-expanded-td' }, renderConfiguredProviders(model, saved)))
						: null)
			}

			function renderConfiguredProviders(model, saved) {
				const modelId = model.id
				const state = expanded.get(modelId)
				if (!state) return null
				if (state.status === 'loading') {
					return h('div', { className: 'orm-prov-title' },
						h('span', { className: 'orm-spin' }),
						h('span', null, t('provLoading')))
				}
				if (state.status === 'error') {
					return h('div', { className: 'orm-prov-title' },
						h('span', { className: 'orm-msg-err' }, `${t('provFailed')}${state.error || t('provEmptyValue')}`),
						h('button', {
							type: 'button',
							className: 'orm-ghost-btn',
							onClick: () => onRetryEndpoints(model)
						}, t('retry')))
				}
				const rows = orderedConfiguredProviders(state.endpoints, saved)
				const showIndex = !!(saved && saved.enabled && Array.isArray(saved.order) && saved.order.length > 0)
				return h('div', null,
					h('div', { className: 'orm-prov-title' },
						h('span', null, t('provTitle')),
						h('span', { className: 'orm-prov-note' }, t('provCount', { n: rows.length })),
						h('span', { className: 'orm-readonly-note' }, showIndex ? configuredSummary(saved) : t('configuredDefaultOrder'))),
					rows.length > 0
						? h('div', { className: 'orm-prov-scroll' },
							h('table', {
								className: 'orm-prov-table',
								style: { '--orm-prov-min': '820px', '--orm-prov-max': '1040px' }
							},
							h('thead', null,
								h('tr', null, ENDPOINT_COLUMNS.map((col) =>
									h('th', { key: col.key, style: col.width ? { width: col.width } : undefined }, colHeaderLabel(col.key))))),
							h('tbody', null, rows.map((row, index) => renderConfiguredEndpointRow(row, index, showIndex)))))
						: h('div', { style: { padding: '10px 0', color: 'var(--dsw-alias-label-tertiary,#80868f)', fontSize: 12 } }, t('provEmpty')))
			}

			function renderConfiguredEndpointRow(row, index, showIndex) {
				const main = row && typeof row.providerName === 'string' && row.providerName !== ''
					? row.providerName
					: (row && typeof row.name === 'string' && row.name !== '' ? row.name : `#${index + 1}`)
				const subParts = []
				if (row && typeof row.serviceTier === 'string' && row.serviceTier !== '') subParts.push(row.serviceTier)
				if (row && typeof row.contextLength === 'number' && Number.isFinite(row.contextLength)) subParts.push(formatContext(row.contextLength))
				const pricing = row ? row.pricing : null
				const isFree = endpointRowIsFree(pricing)
				const quant = row && typeof row.quantization === 'string' && row.quantization !== '' ? row.quantization : t('provEmptyValue')
				const discount = pricing && typeof pricing.discount === 'number' ? pricing.discount : 0
				const before = pricing && pricing.beforeDiscount ? pricing.beforeDiscount : null
				const flag = countryFlag(row ? row.country : null)
				const tagText = row && typeof row.tag === 'string' && row.tag !== '' ? row.tag : ''
				return h('tr', { key: providerKey(row) + ':' + (row.tag || row.name || index) },
					h('td', null,
						h('span', { className: 'orm-name-wrap' },
							showIndex ? h('span', { className: 'orm-order-idx' }, `#${index + 1}`) : null,
							h('span', { className: 'orm-flag', 'aria-hidden': 'true' }, flag),
							h(BrandIcon, { name: main, slug: main, size: 16 }),
							h('span', { className: 'orm-name-text' },
								h('span', { className: 'orm-prov-name-main' }, main),
								subParts.length > 0 || tagText !== ''
									? h('span', { className: 'orm-prov-name-sub' }, [...subParts, tagText].filter(Boolean).join(' · '))
									: null),
							discount > 0 ? h('span', { className: 'orm-discount' }, `${discount}% off`) : null)),
					h('td', { className: 'orm-num' }, priceCell(pricing ? pricing.prompt : null, before ? before.prompt : null, isFree, lang, discount)),
					h('td', { className: 'orm-num' }, priceCell(pricing ? pricing.completion : null, before ? before.completion : null, isFree, lang, discount)),
					h('td', { className: 'orm-num' }, priceCell(pricing ? pricing.cacheRead : null, before ? before.cacheRead : null, false, lang, discount)),
					h('td', { className: 'orm-num' }, formatLatency(row ? row.latencyLast30m : null)),
					h('td', { className: 'orm-num' }, formatThroughput(row ? row.throughputLast30m : null)),
					h('td', { className: 'orm-num' },
						h(UptimeBar, {
							uptime5m: row ? row.uptimeLast5m : null,
							uptime30m: row ? row.uptimeLast30m : null,
							uptime1d: row ? row.uptimeLast1d : null,
							status: row ? row.status : null
						}),
						' ',
						formatUptime(firstNumber(row, 'uptimeLast30m', 'uptimeLast5m', 'uptimeLast1d'))),
					h('td', null, quant))
			}

			function renderModelRow(model) {
				const modelId = model.id
				const isOpen = expanded.has(modelId)
				const isAdded = installedIdSet.has(modelId)
				return h(React.Fragment, { key: modelId },
					h('tr', { className: isOpen ? 'orm-row orm-row-open-bg' : 'orm-row', onClick: () => toggleExpanded(model) },
						h('td', { style: { textAlign: 'center' }, onClick: (event) => { if (event && event.stopPropagation) event.stopPropagation() } },
							h('input', {
								type: 'checkbox',
								className: 'orm-checkbox',
								'aria-label': modelId,
								checked: selectedIds.has(modelId),
								onChange: () => selectModels([modelId], !selectedIds.has(modelId))
							})),
						h('td', { style: { maxWidth: 420, minWidth: 240 } },
							h('span', { className: 'orm-name-wrap' },
								h(BrandIcon, {
									name: modelBrand(model),
									slug: typeof model.author === 'string' && model.author !== '' ? model.author : modelId,
									size: 18
								}),
								h('span', { className: 'orm-name-text' },
									h('span', { className: 'orm-name-main' },
										typeof model.name === 'string' && model.name !== '' ? model.name : modelId,
										typeof model.expirationDate === 'string' && model.expirationDate !== ''
											? h('span', { className: 'orm-badge-warn', title: model.expirationDate },
												`${t('deprecating')} ${formatShortDate(model.expirationDate)}`)
											: null),
									h('span', { className: 'orm-name-sub' }, modelId)
								)
							)
						),
						h('td', { className: 'orm-num' }, formatContext(model.contextWindow)),
						h('td', { className: 'orm-num' }, formatPrice(model.pricing ? model.pricing.prompt : null, model.isFree, lang)),
						h('td', { className: 'orm-num' }, formatPrice(model.pricing ? model.pricing.completion : null, model.isFree, lang)),
						h('td', null,
							isAdded ? h('span', { className: 'orm-badge' }, t('added')) : h('span', { className: 'orm-badge-off' }, t('badgeNotConfigured'))),
						h('td', null,
							routingAvailable && savedStrategyOf(modelId)?.enabled === true
								? h(RouteBadge, { t })
								: routingAvailable
									? h('button', {
										type: 'button',
										className: 'orm-route-open',
										onClick: (event) => {
											if (event && event.stopPropagation) event.stopPropagation()
											if (!isOpen) toggleExpanded(model)
										}
									}, t('routeBadge'))
									: null),
						h('td', { style: { textAlign: 'center' }, onClick: (event) => { if (event && event.stopPropagation) event.stopPropagation() } },
							h('span', {
								role: 'button',
								tabIndex: 0,
								className: 'orm-expand-btn',
								'aria-expanded': isOpen,
								title: t('provTitle'),
								onClick: () => toggleExpanded(model),
								onKeyDown: (event) => {
									try {
										if (event && (event.key === 'Enter' || event.key === ' ')) {
											event.preventDefault()
											toggleExpanded(model)
										}
									} catch (error) {}
								}
							}, chevronIcon(isOpen))
						)
					),
					isOpen ? h('tr', { key: `${modelId}#expanded` },
						h('td', { colSpan: 8, className: 'orm-expanded-td' }, renderExpanded(model))
					) : null
				)
			}

			function renderExpanded(model) {
				const modelId = model.id
				const state = expanded.get(modelId)
				if (!state) return null
				if (state.status === 'loading') {
					return h('div', { className: 'orm-prov-title' },
						h('span', { className: 'orm-spin' }),
						h('span', null, t('provLoading'))
					)
				}
				if (state.status === 'error') {
					return h('div', { className: 'orm-prov-title' },
						h('span', { className: 'orm-msg-err' }, `${t('provFailed')}${state.error || t('provEmptyValue')}`),
						h('button', {
							type: 'button',
							className: 'orm-ghost-btn',
							onClick: () => {
								const model = { id: modelId }
								onRetryEndpoints(model)
							}
						}, t('retry'))
					)
				}
				const allRows = Array.isArray(state.endpoints) ? state.endpoints : []
				const draft = routingAvailable ? draftFor(modelId) : defaultStrategy()
				const requestedStep = routeSteps.get(modelId) || 1
				const manualOrder = draft.mode === 'custom'
				const step = requestedStep === 3 && manualOrder ? 2 : requestedStep
				const showLists = routingAvailable && (routeLists.get(modelId) ?? Boolean(draft.only.length || draft.ignore.length))
				const showOrder = routingAvailable && manualOrder && step === 2
				const disabled = routeSaving !== null
				const eligible = (row) => eligibleEndpoint(row, draft, model)
				const candidates = allRows.filter(eligible)
				const hardCandidates = allRows.filter((row) => eligibleEndpoint(row, draft, model, false))
				const rows = (step === 1 && showLists ? hardCandidates : candidates).slice()
				const metric = draft.sort === 'price' ? 'input' : draft.sort
				const savedOrder = filter === 'added' ? savedStrategyOf(modelId) : null
				const sortOrder = showOrder && state.sortKey === 'order' ? draft
					: state.sortKey === 'none' && savedOrder?.mode === 'custom' && savedOrder.enabled ? savedOrder : null
				rows.sort((a, b) => {
					if (sortOrder) {
						const first = orderIndex(a, sortOrder)
						const second = orderIndex(b, sortOrder)
						if (first === second) return 0
						if (!Number.isFinite(first)) return 1
						if (!Number.isFinite(second)) return -1
						return (first - second) * (state.sortDir === 'desc' ? -1 : 1)
					}
					if (state.sortKey !== 'none' && state.sortKey !== 'order') return compareEndpoints(a, b, state.sortKey, state.sortDir)
					if (manualOrder) return 0
					const preference = Number(preferredEndpoint(b, draft)) - Number(preferredEndpoint(a, draft))
					if (preference) return preference
					if (draft.mode === 'sort') return compareEndpoints(a, b, metric, metric === 'throughput' ? 'desc' : 'asc')
					return 0
				})
				const keys = showLists ? rowProviderKeys(hardCandidates) : []
				const routeCtx = { modelId, keys, eligible, step, draft, showLists, showOrder, disabled }
				const noCandidates = allRows.length > 0 && candidates.length === 0
				const orderMissing = routingAvailable && manualOrder && !candidates.some((row) => Number.isFinite(orderIndex(row, draft)))
				function endpointHeader(key, label, width, sortable) {
					const active = state.sortKey === key
					return h('th', {
						key, style: width ? { width } : undefined,
						className: key === 'order' ? 'orm-col-actions orm-col-order' : undefined,
						'aria-sort': sortable ? (active ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined
					}, sortable ? h('button', {
						type: 'button', className: 'orm-prov-sort', onClick: () => onEndpointSort(modelId, key)
					}, label, h('span', { 'aria-hidden': 'true' }, active ? (state.sortDir === 'asc' ? '▲' : '▼') : '↕')) : label)
				}

				return h('div', null,
					h('div', { className: 'orm-prov-title' },
						h('span', null, t('provTitle')),
						rows.length > 0 ? h('span', { className: 'orm-prov-note' }, t('provCount', { n: rows.length })) : null,
						state.cachedAt !== null
							? h('span', { className: 'orm-prov-note' }, `${t('dataTime')} · ${formatClock(state.cachedAt)}`)
							: null
					),
					routingAvailable ? h('div', { className: 'orm-route-steps', role: 'group', 'aria-label': t('routeSteps') },
						['routeHard', 'routeStrategy', 'routePerformance', 'routeFailover'].map((key, index) =>
							h(React.Fragment, { key },
								h('button', {
									type: 'button', className: 'orm-ghost-btn orm-step-btn', 'aria-pressed': step === index + 1,
									disabled: index === 2 && manualOrder,
									title: index === 2 && manualOrder ? t('routePerfCustom') : undefined,
									onClick: () => setRouteSteps((prev) => new Map(prev).set(modelId, index + 1))
								}, h('span', { className: 'orm-step-num', 'aria-hidden': 'true' }, index + 1), t(key)),
								h('span', { 'aria-hidden': 'true' }, '→'))),
						h(RouteSaveBar, {
							t, disabled: disabled || orderMissing || noCandidates, clearDisabled: disabled,
							saving: routeSaving === modelId, msg: routeMsg.get(modelId),
							probing: routeProbing === modelId,
							onProbe: () => { void probeRoute(modelId) },
							onSave: () => { void saveStrategy(modelId, { ...draft, order: manualOrder ? draft.order : [], enabled: true }) },
							onClear: () => { void clearStrategy(modelId) }
						})
					) : null,
					routingAvailable ? h(RouteControls, {
						t, step, strategy: draft, disabled, showLists,
						onChange: (next) => updateDraft(modelId, next),
						onToggleLists: (value) => setRouteLists((prev) => new Map(prev).set(modelId, value))
					}) : null,
					noCandidates || orderMissing
						? h('div', { className: 'orm-route-hint' }, t(noCandidates ? 'routeNoCandidates' : 'routeOrderRequired'))
						: null,
					rows.length > 0
						? h('div', { className: 'orm-prov-scroll' },
							h('table', {
								className: 'orm-prov-table',
								style: {
									'--orm-prov-min': (840 + (showLists ? 188 : 0) + (showOrder ? 90 : 0)) + 'px',
									'--orm-prov-max': (1060 + (showLists ? 188 : 0) + (showOrder ? 90 : 0)) + 'px'
								}
							},
							h('thead', null,
								h('tr', null,
									ENDPOINT_COLUMNS.map((col) => endpointHeader(col.key, colHeaderLabel(col.key), col.width, col.sortable)),
									showLists ? ['routeOnly', 'routeIgnore'].map((key) =>
										h('th', { key, style: { width: 94 } }, t(key))) : null,
									showOrder ? endpointHeader('order', t('routeOrder'), 90, true) : null
								)
							),
							h('tbody', null,
								rows.map((row, index) => renderEndpointRow(row, index, routeCtx))
							)
						))
						: h('div', { style: { padding: '10px 0', color: 'var(--dsw-alias-label-tertiary,#80868f)', fontSize: 12 } }, t('provEmpty')),
					routingAvailable ? null
						: h('div', { className: 'orm-route-summary orm-msg-err' }, t('routeUnavailable'))
				)
			}

			function colHeaderLabel(key) {
				switch (key) {
					case 'provider': return t('provColProvider')
					case 'input': return t('provColInput')
					case 'output': return t('provColOutput')
					case 'cache': return t('provColCache')
					case 'latency': return t('provColLatency')
					case 'throughput': return t('provColThroughput')
					case 'uptime': return t('provColUptime')
					case 'quantization': return t('provColQuant')
					default: return key
				}
			}

			function renderEndpointRow(row, index, routeCtx) {
				const main = row && typeof row.providerName === 'string' && row.providerName !== ''
					? row.providerName
					: (row && typeof row.name === 'string' && row.name !== '' ? row.name : `#${index + 1}`)
				const subParts = []
				if (row && typeof row.serviceTier === 'string' && row.serviceTier !== '') subParts.push(row.serviceTier)
				if (row && typeof row.contextLength === 'number' && Number.isFinite(row.contextLength)) {
					subParts.push(formatContext(row.contextLength))
				}
				const pricing = row ? row.pricing : null
				const isFree = endpointRowIsFree(pricing)
				const quant = row && typeof row.quantization === 'string' && row.quantization !== '' ? row.quantization : t('provEmptyValue')
				const discount = pricing && typeof pricing.discount === 'number' ? pricing.discount : 0
				const before = pricing && pricing.beforeDiscount ? pricing.beforeDiscount : null
				const flag = countryFlag(row ? row.country : null)
				const tagText = row && typeof row.tag === 'string' && row.tag !== '' ? row.tag : ''
				const routeKey = providerKey(row)
				const { draft, keys, eligible, step, showLists, showOrder, disabled, modelId } = routeCtx
				const indexInOrder = orderIndex(row, draft)
				const ignored = draft.ignore.includes(routeKey)
				const allowed = !ignored && (!draft.only.length || draft.only.includes(routeKey))
				const editable = step === 1 && !disabled && routeKey !== ''
				const toggleProvider = (field) => {
					const next = field === 'only' && !draft.only.length
						? keys.filter((key) => key !== routeKey)
						: toggleListValue(draft[field], routeKey)
					updateDraft(modelId, { ...draft, [field]: next, enabled: true })
				}
				return h('tr', { key: routeKey + ':' + (row.tag || row.name || index), className: eligible(row) ? undefined : 'orm-route-excluded' },
					h('td', null,
						h('span', { className: 'orm-name-wrap' },
							h('span', { className: 'orm-flag', 'aria-hidden': 'true' }, flag),
							h(BrandIcon, { name: main, slug: main, size: 16 }),
							h('span', { className: 'orm-name-text' },
								h('span', { className: 'orm-prov-name-main' }, main),
								subParts.length > 0 || tagText !== ''
									? h('span', { className: 'orm-prov-name-sub' }, [...subParts, tagText].filter(Boolean).join(' · '))
									: null
							),
							discount > 0 ? h('span', { className: 'orm-discount' }, `${discount}% off`) : null
						)
					),
					h('td', { className: 'orm-num' }, priceCell(pricing ? pricing.prompt : null, before ? before.prompt : null, isFree, lang, discount)),
					h('td', { className: 'orm-num' }, priceCell(pricing ? pricing.completion : null, before ? before.completion : null, isFree, lang, discount)),
					h('td', { className: 'orm-num' }, priceCell(pricing ? pricing.cacheRead : null, before ? before.cacheRead : null, false, lang, discount)),
					h('td', { className: 'orm-num' }, formatLatency(row ? row.latencyLast30m : null)),
					h('td', { className: 'orm-num' }, formatThroughput(row ? row.throughputLast30m : null)),
					h('td', { className: 'orm-num' },
						h(UptimeBar, {
							uptime5m: row ? row.uptimeLast5m : null,
							uptime30m: row ? row.uptimeLast30m : null,
							uptime1d: row ? row.uptimeLast1d : null,
							status: row ? row.status : null
						}),
						' ',
						formatUptime(firstNumber(row, 'uptimeLast30m', 'uptimeLast5m', 'uptimeLast1d'))),
					h('td', null, quant),
					showLists ? h('td', null, h('input', {
						type: 'checkbox', checked: allowed,
						disabled: !editable || ignored || (allowed && (draft.only.length || keys.length) <= 1),
						'aria-label': t('routeOnly') + ' ' + routeKey, onChange: () => toggleProvider('only')
					})) : null,
					showLists ? h('td', null, h('input', {
						type: 'checkbox', checked: ignored, disabled: !editable,
						'aria-label': t('routeIgnore') + ' ' + routeKey, onChange: () => toggleProvider('ignore')
					})) : null,
					showOrder ? h('td', { className: 'orm-col-actions orm-col-order' },
						routeKey !== '' ? h(RouteProviderCell, {
							t, showOrder: true, disabled: disabled || !eligible(row),
							order: Number.isFinite(indexInOrder) ? indexInOrder + 1 : null,
							onOrder: (position) => updateDraft(modelId, setOrderPosition({ ...draft, enabled: true }, routeKey, position))
						}) : null) : null
				)
			}

		function chevronIcon(isOpenValue) {
				return h('span', {
					'aria-hidden': 'true',
					style: {
						display: 'inline-block',
						borderRight: '2px solid currentColor',
						borderBottom: '2px solid currentColor',
						width: 8,
						height: 8,
						transform: isOpenValue ? 'rotate(45deg)' : 'rotate(-45deg)',
						marginLeft: isOpenValue ? -2 : 2
					}
				})
			}
		}

		function firstNumber(row, ...fields) {
			try {
				if (!row || typeof row !== 'object') return null
				for (const field of fields) {
					const value = row[field]
					if (typeof value === 'number' && Number.isFinite(value)) return value
				}
			} catch (error) {}
			return null
		}

		function setModelsErrorSafe(error) {
			return error === null || error === undefined ? new Error('unknown refresh error') : error
		}

		// ==================================================================
		// apply(): register both slots, return combined cleanup
		// ==================================================================

		const CLIENT_MODELS_TTL_MS = 5 * 60 * 1000

		function apply(ctx) {
			ORM_CTX = ctx || null
			const cleanups = []

			try {
				cleanups.push(ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
					name: 'settings.models.footer',
					id: 'openrouter-models.entry',
					order: 50
				}, Entry)))
			} catch (error) {
				try { console.error('[openrouter-models] injecting settings.models.footer failed', error) } catch (loggingError) {}
			}

			try {
				cleanups.push(ctx.slots.inject('shell.overlay', () => ctx.slots.register({
					name: 'shell.overlay',
					id: 'openrouter-models.panel',
					order: 50
				}, Panel)))
			} catch (error) {
				try { console.error('[openrouter-models] injecting shell.overlay failed', error) } catch (loggingError) {}
			}

			return function cleanup() {
				for (const dispose of cleanups.splice(0)) {
					try {
						if (typeof dispose === 'function') dispose()
					} catch (error) {}
				}
				ORM_CTX = null
				panelOpen = false
				panelListeners.clear()
			}
		}

		return {
			id: NS,
			version: PLUGIN_VERSION,
			inject: ['slots', 'locale'],
			apply
		}
	}
})
