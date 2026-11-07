import { useEffect, useRef, useState, type FC } from 'react'
import type {
  HealthStatus,
  MonitoringStatusResponse,
  ParsedPrometheusMetrics,
} from '../types'
import {
  checkDbHealth,
  checkHealth,
  fetchMetricsText,
  fetchMonitoringStatus,
  parsePrometheusMetrics,
} from '../api'
import {
  ActivityIcon,
  AlertIcon,
  CheckCircleIcon,
  CpuChipIcon,
  RefreshIcon,
} from './Icons'

export const MonitoringView: FC = () => {
  const [monitoringStatus, setMonitoringStatus] = useState<MonitoringStatusResponse | null>(null)
  const [parsedMetrics, setParsedMetrics] = useState<ParsedPrometheusMetrics | null>(null)
  const [rawMetricsText, setRawMetricsText] = useState<string>('')
  const [apiHealth, setApiHealth] = useState<HealthStatus | null>(null)
  const [dbHealth, setDbHealth] = useState<HealthStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true)
  const [showRawMetrics, setShowRawMetrics] = useState(false)

  // Track active fetch to avoid overlapping requests
  const isFetchingRef = useRef(false)

  const loadData = async (manual = false) => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    if (manual) setIsLoading(true)
    setError(null)

    try {
      const [statusRes, metricsRes, healthRes, dbHealthRes] = await Promise.allSettled([
        fetchMonitoringStatus(),
        fetchMetricsText(),
        checkHealth(),
        checkDbHealth(),
      ])

      if (statusRes.status === 'fulfilled') {
        setMonitoringStatus(statusRes.value)
      } else {
        setMonitoringStatus(null)
      }

      if (metricsRes.status === 'fulfilled') {
        setRawMetricsText(metricsRes.value)
        const parsed = parsePrometheusMetrics(metricsRes.value)
        setParsedMetrics(parsed)
      } else {
        setParsedMetrics(null)
        setRawMetricsText('')
      }

      if (healthRes.status === 'fulfilled') setApiHealth(healthRes.value)
      else setApiHealth({ status: 'unreachable' })

      if (dbHealthRes.status === 'fulfilled') setDbHealth(dbHealthRes.value)
      else setDbHealth({ status: 'disconnected' })

      // Determine top-level error state
      if (statusRes.status === 'rejected' && metricsRes.status === 'rejected') {
        const primaryError =
          statusRes.reason instanceof Error
            ? statusRes.reason.message
            : 'Unable to connect to monitoring endpoints.'
        setError(primaryError)
      }

      setLastRefreshed(new Date())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred while loading telemetry.')
    } finally {
      if (manual) setIsLoading(false)
      isFetchingRef.current = false
    }
  }

  // Initial load and recurring 6-second auto-refresh with cleanup
  useEffect(() => {
    let active = true

    // Initial load without causing synchronous cascading render lint error
    const runInitial = async () => {
      if (active) await loadData(true)
    }
    void runInitial()

    let intervalId: ReturnType<typeof setInterval> | null = null
    if (autoRefreshEnabled) {
      intervalId = setInterval(() => {
        if (active && !document.hidden) {
          void loadData(false)
        }
      }, 6000)
    }

    return () => {
      active = false
      if (intervalId) clearInterval(intervalId)
    }
  }, [autoRefreshEnabled])

  // Threshold helpers for resource status
  const cpuVal = monitoringStatus?.cpu_percent
  const memVal = monitoringStatus?.memory_percent

  const getCpuBadge = (val?: number) => {
    if (val === undefined) return { label: 'Unavailable', color: 'bg-slate-100 text-slate-600' }
    if (val < 60) return { label: 'Nominal', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    if (val < 85) return { label: 'Elevated', color: 'bg-amber-50 text-amber-700 border-amber-200' }
    return { label: 'High Load', color: 'bg-rose-50 text-rose-700 border-rose-200' }
  }

  const getMemBadge = (val?: number) => {
    if (val === undefined) return { label: 'Unavailable', color: 'bg-slate-100 text-slate-600' }
    if (val < 75) return { label: 'Healthy', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    if (val < 90) return { label: 'Constrained', color: 'bg-amber-50 text-amber-700 border-amber-200' }
    return { label: 'Critical', color: 'bg-rose-50 text-rose-700 border-rose-200' }
  }

  const cpuBadge = getCpuBadge(cpuVal)
  const memBadge = getMemBadge(memVal)

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Header Banner */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <ActivityIcon className="w-6 h-6 text-blue-700" />
            <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              System Telemetry & Resource Monitoring
            </h2>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-slate-600 max-w-3xl leading-5">
            Real-time observability of FastAPI process health, host environment resource consumption, and Prometheus HTTP traffic counters.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {/* Auto-refresh toggle */}
          <button
            type="button"
            onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition shadow-xs ${
              autoRefreshEnabled
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                autoRefreshEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
              }`}
            />
            {autoRefreshEnabled ? 'Auto-refresh: 6s' : 'Auto-refresh: Off'}
          </button>

          {/* Manual Refresh */}
          <button
            type="button"
            onClick={() => void loadData(true)}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
          >
            <RefreshIcon className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <AlertIcon className="w-4 h-4 text-rose-600 shrink-0" />
            <span>Monitoring endpoint error: {error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadData(true)}
            className="font-bold underline hover:text-rose-950 ml-4 shrink-0"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* External Monitoring Suites (Grafana & Prometheus) */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 via-white to-blue-50/40 p-5 shadow-xs flex flex-col justify-between sm:flex-row sm:items-center gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
              <h3 className="text-sm font-bold text-indigo-950">Grafana Observability Suite</h3>
            </div>
            <p className="text-xs text-slate-600 max-w-md leading-relaxed">
              Pre-provisioned dashboard displaying API throughput rates, p50/p95/p99 latency percentiles, error distribution, and process memory.
            </p>
          </div>
          <a
            href="http://localhost:3000/d/privacymesh-overview/privacymesh-application-observability"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-800 transition"
          >
            <span>Open Grafana</span>
            <span aria-hidden="true">&rarr;</span>
          </a>
        </div>

        <div className="rounded-2xl border border-orange-100 bg-gradient-to-r from-orange-50/80 via-white to-amber-50/40 p-5 shadow-xs flex flex-col justify-between sm:flex-row sm:items-center gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-orange-500" />
              <h3 className="text-sm font-bold text-orange-950">Prometheus Telemetry & Alerts</h3>
            </div>
            <p className="text-xs text-slate-600 max-w-md leading-relaxed">
              Scrape targets, active alert rule evaluations (Backend/DB down, CPU, 5xx rate), and raw PromQL query interface.
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <a
              href="http://localhost:9090/targets"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs font-semibold text-orange-800 shadow-xs hover:bg-orange-50 transition"
            >
              Targets
            </a>
            <a
              href="http://localhost:9090"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-orange-700 transition"
            >
              <span>Prometheus</span>
              <span aria-hidden="true">&rarr;</span>
            </a>
          </div>
        </div>
      </section>

      {/* Top Telemetry Cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* CPU Usage Card */}
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                CPU Utilization
              </span>
              <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-bold ${cpuBadge.color}`}>
                {cpuBadge.label}
              </span>
            </div>
            <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
              {cpuVal !== undefined ? `${cpuVal}%` : 'Unavailable'}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
            Source: <code className="font-mono text-slate-700">/monitoring/status</code>
          </div>
        </article>

        {/* Memory Usage Card */}
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Memory Consumption
              </span>
              <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-bold ${memBadge.color}`}>
                {memBadge.label}
              </span>
            </div>
            <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
              {memVal !== undefined ? `${memVal}%` : 'Unavailable'}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
            Total reported: {monitoringStatus?.memory_total_mb ? `${monitoringStatus.memory_total_mb} MB` : 'Unavailable'}
          </div>
        </article>

        {/* Total HTTP Requests Card */}
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Total HTTP Requests
              </span>
              <span className="rounded-sm bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                Prometheus
              </span>
            </div>
            <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
              {parsedMetrics?.totalRequests !== null && parsedMetrics?.totalRequests !== undefined
                ? parsedMetrics.totalRequests
                : 'Unavailable'}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5 text-[11px] text-slate-500">
            <div className="flex items-center justify-between">
              <span>2xx Success: <strong className="text-emerald-700">{parsedMetrics?.successRequests ?? '—'}</strong></span>
              <span>Errors: <strong className={parsedMetrics?.errorRequests ? 'text-rose-700' : 'text-slate-600'}>{parsedMetrics?.errorRequests ?? '0'}</strong></span>
            </div>
            <p className="text-[10px] text-slate-400 leading-tight">
              Combines user traffic, Prometheus scrapes (/metrics), &amp; health probes (/health, /db-health).
            </p>
          </div>
        </article>

        {/* Average Latency Card */}
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Avg Response Latency
              </span>
              <span className="rounded-sm bg-violet-50 border border-violet-200 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                Histogram
              </span>
            </div>
            <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
              {parsedMetrics?.avgLatencyMs !== null && parsedMetrics?.avgLatencyMs !== undefined
                ? `${parsedMetrics.avgLatencyMs} ms`
                : 'Unavailable'}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
            Backend health: <span className="font-semibold text-emerald-700">{apiHealth?.status ?? 'Checking'}</span> · DB: <span className="font-semibold text-emerald-700">{dbHealth?.status ?? 'Checking'}</span>
          </div>
        </article>
      </section>

      {/* Task 4: Resource Optimization & Operational Threshold Guidance */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CpuChipIcon className="w-5 h-5 text-blue-700" />
              <h3 className="text-base font-bold text-slate-900">
                Resource Utilization & Operational Guidance
              </h3>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Threshold-based operational analysis derived directly from current environment measurements.
            </p>
          </div>
          <span className="rounded-sm bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 uppercase">
            Informational Only
          </span>
        </div>

        {/* Notice explaining autoscaling architecture */}
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3.5 text-xs text-blue-900 flex items-start gap-3">
          <CheckCircleIcon className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="leading-5">
            <strong className="font-semibold text-blue-950">Autoscaling Architecture:</strong> In the Kubernetes deployment (Minikube), automated horizontal pod autoscaling is fully configured (<code className="font-mono text-blue-950 font-semibold">backend-hpa</code>, 1–4 replicas targeting 60% CPU) and was empirically validated in the Mode B benchmark. In contrast, local Docker Compose runs with fixed container counts. This monitoring dashboard is passive and does not directly trigger scaling events.
          </p>
        </div>

        {/* Guidance Items */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              CPU Headroom Analysis
            </span>
            <p className="mt-2 text-xs text-slate-700 leading-5">
              {cpuVal !== undefined
                ? cpuVal < 50
                  ? `CPU load is low (${cpuVal}%). Ample headroom exists for cryptographic hashing (Argon2id) and simulated enclave calculations.`
                  : `CPU utilization is elevated (${cpuVal}%). Consider throttling concurrent background tasks or load-balancing across worker threads.`
                : 'CPU metrics currently unavailable.'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Memory Pool Capacity
            </span>
            <p className="mt-2 text-xs text-slate-700 leading-5">
              {memVal !== undefined
                ? memVal < 70
                  ? `Current memory snapshot indicates utilization is at ${memVal}% of ${monitoringStatus?.memory_total_mb ?? '—'} MB total capacity. Multi-sample longitudinal analysis is required to evaluate long-term memory stability.`
                  : `Memory consumption is above 70% (${memVal}%). Review cache sizing and database connection pool max overflow settings.`
                : 'Memory metrics currently unavailable.'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              HTTP Pipeline Latency
            </span>
            <p className="mt-2 text-xs text-slate-700 leading-5">
              {parsedMetrics?.avgLatencyMs !== null && parsedMetrics?.avgLatencyMs !== undefined
                ? parsedMetrics.avgLatencyMs < 300
                  ? `Average measured request turnaround is ${parsedMetrics.avgLatencyMs} ms across local API and database execution.`
                  : `Average request turnaround is ${parsedMetrics.avgLatencyMs} ms. Check PostgreSQL query plan execution on KYC or transactions queries.`
                : 'Latency histogram data accumulating or unavailable.'}
            </p>
          </div>
        </div>
      </section>

      {/* HTTP Endpoints Traffic Table */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Prometheus HTTP Traffic by Endpoint
            </h3>
            <p className="text-xs text-slate-500">
              Aggregated from <code className="font-mono text-slate-700">privacymesh_http_requests_total</code> counter. Includes user API requests as well as automated Prometheus scrapes (<code className="font-mono text-slate-600">/metrics</code>) and orchestrator health probes (<code className="font-mono text-slate-600">/health</code>, <code className="font-mono text-slate-600">/db-health</code>).
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              <span className="font-semibold text-amber-700">4xx</span> responses include expected auth rejections (401 Unauthorized, 403 Forbidden, 422 Validation). Only <span className="font-semibold text-rose-700">5xx</span> responses indicate genuine server errors.
            </p>
          </div>
          {lastRefreshed && (
            <span className="text-[11px] text-slate-400">
              Last sampled: {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
        </div>

        {parsedMetrics?.endpointBreakdown && parsedMetrics.endpointBreakdown.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="pb-3 pr-4">Method</th>
                  <th className="pb-3 pr-4">Endpoint Path</th>
                  <th className="pb-3 pr-4">Status Code</th>
                  <th className="pb-3 text-right">Recorded Invocations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parsedMetrics.endpointBreakdown.map((ep, idx) => (
                  <tr key={`${ep.method}-${ep.endpoint}-${ep.status}-${idx}`} className="hover:bg-slate-50/50 transition">
                    <td className="py-3 pr-4">
                      <span className="rounded-sm bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-700">
                        {ep.method}
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-800">
                      {ep.endpoint}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-block rounded-sm px-2 py-0.5 text-[10px] font-bold font-mono ${
                          ep.status.startsWith('2')
                            ? 'bg-emerald-50 text-emerald-700'
                            : ep.status.startsWith('4')
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {ep.status}
                      </span>
                    </td>
                    <td className="py-3 text-right font-mono text-xs font-semibold text-slate-900">
                      {ep.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-10 text-center text-xs text-slate-500">
            {isLoading ? 'Collecting Prometheus endpoint counters...' : 'No endpoint traffic recorded yet. Issue API requests to generate metrics.'}
          </div>
        )}
      </section>

      {/* Raw Metrics Inspector (Collapsible) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <button
          type="button"
          onClick={() => setShowRawMetrics(!showRawMetrics)}
          className="flex w-full items-center justify-between text-left text-xs font-bold text-slate-700 hover:text-slate-900"
        >
          <span>Raw Prometheus Metric Feed (/metrics)</span>
          <span className="text-[11px] font-normal text-slate-400">
            {showRawMetrics ? 'Hide Raw Output ↑' : 'Show Raw Output ↓'}
          </span>
        </button>

        {showRawMetrics && (
          <div className="mt-4 pt-3 border-t border-slate-100">
            <pre className="max-h-72 overflow-auto rounded-xl bg-slate-900 p-4 font-mono text-[11px] leading-4 text-emerald-400">
              {rawMetricsText || 'No raw metric data available.'}
            </pre>
          </div>
        )}
      </section>
    </div>
  )
}
