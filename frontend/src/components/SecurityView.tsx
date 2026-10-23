import { useEffect, useState, type FC } from 'react'
import type {
  SyntheticWorkloadInput,
  SyntheticWorkloadResult,
  TEEStatusResponse,
  UserRole,
} from '../types'
import { fetchTEEStatus, runConfidentialDemo } from '../api'
import { formatCurrency } from '../utils'
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  CpuChipIcon,
  RefreshIcon,
  SecurityIcon,
} from './Icons'

interface SecurityViewProps {
  user?: { id: number; username: string; role: UserRole } | null
  onOpenAuth?: () => void
}

export const SecurityView: FC<SecurityViewProps> = ({ user, onOpenAuth }) => {
  const [teeStatus, setTeeStatus] = useState<TEEStatusResponse | null>(null)
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  // Synthetic demo state
  const [accountId, setAccountId] = useState('SYNTH-ACC-8021')
  const [monthlyIncome, setMonthlyIncome] = useState(7500)
  const [requestedCredit, setRequestedCredit] = useState(20000)
  const [obligations, setObligations] = useState(1500)
  const [riskTier, setRiskTier] = useState<'low' | 'medium' | 'high'>('low')
  const [isRunningDemo, setIsRunningDemo] = useState(false)
  const [demoResult, setDemoResult] = useState<SyntheticWorkloadResult | null>(null)
  const [demoError, setDemoError] = useState<string | null>(null)

  const loadStatus = async () => {
    setIsLoadingStatus(true)
    setStatusError(null)
    try {
      const status = await fetchTEEStatus()
      setTeeStatus(status)
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : 'Failed to retrieve TEE status.')
    } finally {
      setIsLoadingStatus(false)
    }
  }

  useEffect(() => {
    let active = true
    const initStatus = async () => {
      try {
        const status = await fetchTEEStatus()
        if (active) setTeeStatus(status)
      } catch (err: unknown) {
        if (active) setStatusError(err instanceof Error ? err.message : 'Failed to retrieve TEE status.')
      }
    }
    void initStatus()
    return () => {
      active = false
    }
  }, [])

  const handleRunDemo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) {
      onOpenAuth?.()
      return
    }

    setIsRunningDemo(true)
    setDemoError(null)
    setDemoResult(null)

    const payload: SyntheticWorkloadInput = {
      account_id: accountId.trim(),
      monthly_income: Number(monthlyIncome),
      requested_credit_amount: Number(requestedCredit),
      existing_obligations: Number(obligations),
      risk_tier: riskTier,
    }

    try {
      const result = await runConfidentialDemo(payload)
      setDemoResult(result)
    } catch (err: unknown) {
      setDemoError(err instanceof Error ? err.message : 'Demo execution failed.')
    } finally {
      setIsRunningDemo(false)
    }
  }

  const verifiedControls = [
    {
      title: 'Cryptographic Password Hashing',
      component: 'backend/app/security.py',
      detail:
        'Passwords hashed using pwdlib with Argon2id parameters. Plain credentials and hashes are never emitted in API responses.',
      status: 'Verified Active',
    },
    {
      title: 'JWT Bearer Authentication',
      component: 'backend/app/security.py',
      detail:
        'Signed JSON Web Tokens (HS256) with 30-minute expiration. Verified per-request via FastAPI dependencies.',
      status: 'Verified Active',
    },
    {
      title: 'Role-Based Authorization (RBAC)',
      component: 'backend/app/routers/admin.py',
      detail:
        'Guarded by require_admin. Registration strictly forces role="user", preventing privilege escalation.',
      status: 'Verified Active',
    },
    {
      title: 'Multi-Tenant Workload Isolation',
      component: 'backend/app/routers/transactions.py, kyc.py',
      detail:
        'Users can query and record only their own transactions and KYC dossiers via foreign-key scoped queries.',
      status: 'Verified Active',
    },
    {
      title: 'Database Connection Health Checks',
      component: 'backend/app/database.py',
      detail:
        'Pool pre-ping monitoring via /health and /db-health returning 503 upon connection failure.',
      status: 'Verified Active',
    },
  ]

  const plannedTEEFeatures = [
    {
      title: 'Hardware-Isolated Enclaves',
      technology: 'Intel SGX PRM / AMD SEV-SNP',
      detail:
        'Hardware encrypted memory regions (EPC/ASID) isolating banking workloads from host OS and hypervisor snooping.',
    },
    {
      title: 'Remote Attestation & Measurement',
      technology: 'DCAP / EPID Quote Verification',
      detail:
        'Cryptographic verification of enclave codebase identity and measurement prior to dispatching keys.',
    },
    {
      title: 'Hardware Key Sealing',
      technology: 'Silicon Root of Trust (Root Key Binding)',
      detail:
        'Sealing workload keys to CPU silicon so data can only be decrypted within the measured enclave.',
    },
  ]

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <SecurityIcon className="w-6 h-6 text-blue-700" />
            <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Confidential Computing & Security Architecture
            </h2>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-slate-600 max-w-3xl leading-5">
            PrivacyMesh explores confidential computing principles for sensitive banking workloads. Below is a transparent audit distinguishing verified software controls, operational execution state, and future hardware-backed enclave milestones.
          </p>
        </div>
        <button
          type="button"
          onClick={loadStatus}
          disabled={isLoadingStatus}
          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs self-start sm:self-auto"
        >
          <RefreshIcon className={`w-3.5 h-3.5 ${isLoadingStatus ? 'animate-spin' : ''}`} />
          Refresh TEE Status
        </button>
      </div>

      {/* Execution Status Panel */}
      <section className="rounded-2xl border border-amber-300 bg-amber-50/70 p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <CpuChipIcon className="w-6 h-6 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-amber-950">
                  Execution Status & Hardware TEE Capabilities
                </h3>
                <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-900 border border-amber-300">
                  {teeStatus?.mode_label ?? 'Simulation — not hardware-backed'}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-amber-900 leading-5 max-w-2xl">
                {teeStatus?.hardware_detection.detection_summary ??
                  'Inspecting host runtime for Intel SGX / AMD SEV extensions...'}
              </p>
            </div>
          </div>
          <div className="shrink-0 rounded-xl bg-white/80 border border-amber-200 p-3 text-right">
            <p className="text-[10px] uppercase font-bold text-slate-400">Operational Readiness</p>
            <p className="text-xs font-bold text-slate-800">
              {teeStatus?.operational_readiness ?? 'Checking...'}
            </p>
            <p className="text-[10px] text-amber-800 mt-0.5">
              Hardware Enclave Active: <span className="font-semibold">{teeStatus?.is_hardware_enclave ? 'Yes' : 'No'}</span>
            </p>
          </div>
        </div>

        {/* Hardware Detection Breakdown */}
        {teeStatus && (
          <div className="mt-5 pt-4 border-t border-amber-200/70 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div className="rounded-xl bg-white/70 p-2.5 border border-amber-100">
              <span className="text-slate-500 text-[11px] block">CPU SGX Instruction:</span>
              <span className="font-semibold text-slate-800">
                {teeStatus.hardware_detection.cpu_sgx_detected ? 'Detected in CPU' : 'Not detected'}
              </span>
            </div>
            <div className="rounded-xl bg-white/70 p-2.5 border border-amber-100">
              <span className="text-slate-500 text-[11px] block">CPU SEV Instruction:</span>
              <span className="font-semibold text-slate-800">
                {teeStatus.hardware_detection.cpu_sev_detected ? 'Detected in CPU' : 'Not detected'}
              </span>
            </div>
            <div className="rounded-xl bg-white/70 p-2.5 border border-amber-100">
              <span className="text-slate-500 text-[11px] block">Driver Initialized:</span>
              <span className="font-semibold text-slate-800">
                {teeStatus.hardware_detection.driver_initialized ? 'Device present' : 'Inactive / Absent'}
              </span>
            </div>
            <div className="rounded-xl bg-white/70 p-2.5 border border-amber-100">
              <span className="text-slate-500 text-[11px] block">Remote Attestation:</span>
              <span className="font-semibold text-slate-800">
                {teeStatus.hardware_detection.attestation_configured ? 'Verified' : 'Not configured'}
              </span>
            </div>
          </div>
        )}

        {statusError && (
          <p className="mt-3 text-xs text-rose-700 bg-rose-50 p-2 rounded-lg border border-rose-200">
            Error checking status: {statusError}
          </p>
        )}
      </section>

      {/* Educational Data Triad: At Rest, In Transit, In Use */}
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">
            The Data Protection Triad in Confidential Computing
          </h3>
          <p className="text-xs text-slate-500">
            Confidential computing specifically targets data-in-use protection to close the memory vulnerability gap.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Data at Rest */}
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-900">1. Data at Rest</h4>
                <span className="rounded-sm bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  Storage
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                Protects stored data against physical theft or unauthorized disk inspection using filesystem or database encryption.
              </p>
              <div className="mt-4 rounded-xl bg-slate-50 p-3 border border-slate-100 text-xs text-slate-700 space-y-1">
                <span className="font-semibold block text-[11px] text-slate-500 uppercase">
                  Current PrivacyMesh State:
                </span>
                <p className="text-[11px] text-slate-600 leading-4">
                  Standard PostgreSQL table storage. OS-level volume encryption depends on underlying disk configuration; database-tier column encryption is not active.
                </p>
              </div>
            </div>
            <span className="mt-4 inline-block w-fit rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              Unencrypted DB Tier
            </span>
          </article>

          {/* Data in Transit */}
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-900">2. Data in Transit</h4>
                <span className="rounded-sm bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  Network
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                Protects network packets traveling between client and servers against eavesdropping and tampering via TLS 1.3 / HTTPS.
              </p>
              <div className="mt-4 rounded-xl bg-slate-50 p-3 border border-slate-100 text-xs text-slate-700 space-y-1">
                <span className="font-semibold block text-[11px] text-slate-500 uppercase">
                  Current PrivacyMesh State:
                </span>
                <p className="text-[11px] text-slate-600 leading-4">
                  Development HTTP over localhost (port 8000). TLS certificates and HTTPS termination are not active in this academic prototype.
                </p>
              </div>
            </div>
            <span className="mt-4 inline-block w-fit rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              Local HTTP (TLS Not Active)
            </span>
          </article>

          {/* Data in Use */}
          <article className="rounded-2xl border-2 border-blue-200 bg-blue-50/40 p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-blue-950">3. Data in Use (TEE)</h4>
                <span className="rounded-sm bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">
                  Memory Enclave
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-blue-900">
                Hardware-enforced CPU memory encryption (TEEs) ensuring that hypervisors, root OS admins, or DMA attacks cannot snoop on process memory.
              </p>
              <div className="mt-4 rounded-xl bg-white p-3 border border-blue-200 text-xs text-blue-900 space-y-1">
                <span className="font-semibold block text-[11px] text-blue-600 uppercase">
                  Current PrivacyMesh State:
                </span>
                <p className="text-[11px] text-blue-800 leading-4">
                  Software simulation running inside user-space Python runtime. Transparently labeled as <span className="font-bold">Simulation — not hardware-backed</span>.
                </p>
              </div>
            </div>
            <span className="mt-4 inline-block w-fit rounded bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-900">
              Simulation — not hardware-backed
            </span>
          </article>
        </div>
      </section>

      {/* Interactive Confidential Computing Demonstration */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">
              Confidential Banking Workload Demonstration
            </h3>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-700 uppercase">
              Software Simulation
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Demonstrates sensitive multi-parameter credit facility evaluation under simulated memory isolation. Uses synthetic banking test vectors only.
          </p>
        </div>

        {/* Warning banner about synthetic data */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 flex items-start gap-3">
          <AlertIcon className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-600 leading-5">
            <span className="font-bold text-slate-800">Synthetic Banking Data Notice:</span> This demonstration calculates debt-to-income (DTI) and risk limits on synthetic customer records. Real credentials, passwords, JWTs, or real customer documents must never be submitted.
          </p>
        </div>

        {/* Workload Form */}
        <form onSubmit={handleRunDemo} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label htmlFor="accountId" className="block text-xs font-semibold text-slate-700">
                Synthetic Account ID
              </label>
              <input
                id="accountId"
                type="text"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                pattern="^SYNTH-[A-Za-z0-9_-]+$"
                title="Must start with SYNTH-"
                required
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900 shadow-xs focus:border-blue-500 focus:outline-hidden"
              />
              <span className="text-[10px] text-slate-400">Must start with &apos;SYNTH-&apos;</span>
            </div>

            <div>
              <label htmlFor="monthlyIncome" className="block text-xs font-semibold text-slate-700">
                Monthly Income ($)
              </label>
              <input
                id="monthlyIncome"
                type="number"
                min="100"
                max="1000000"
                step="50"
                value={monthlyIncome}
                onChange={(e) => setMonthlyIncome(Number(e.target.value))}
                required
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label htmlFor="obligations" className="block text-xs font-semibold text-slate-700">
                Existing Obligations ($/mo)
              </label>
              <input
                id="obligations"
                type="number"
                min="0"
                max="1000000"
                step="50"
                value={obligations}
                onChange={(e) => setObligations(Number(e.target.value))}
                required
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label htmlFor="requestedCredit" className="block text-xs font-semibold text-slate-700">
                Requested Credit Limit ($)
              </label>
              <input
                id="requestedCredit"
                type="number"
                min="500"
                max="5000000"
                step="500"
                value={requestedCredit}
                onChange={(e) => setRequestedCredit(Number(e.target.value))}
                required
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label htmlFor="riskTier" className="block text-xs font-semibold text-slate-700">
                Synthetic Risk Tier
              </label>
              <select
                id="riskTier"
                value={riskTier}
                onChange={(e) => setRiskTier(e.target.value as 'low' | 'medium' | 'high')}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-hidden"
              >
                <option value="low">Low Risk Profile (+30 pts)</option>
                <option value="medium">Medium Risk Profile (Baseline)</option>
                <option value="high">High Risk Profile (-50 pts)</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={isRunningDemo}
                className="w-full rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition disabled:opacity-50"
              >
                {isRunningDemo ? 'Executing Simulation...' : 'Execute Workload in TEE Simulation'}
              </button>
            </div>
          </div>
        </form>

        {demoError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            Execution error: {demoError}
          </div>
        )}

        {/* Demo Execution Output Trace */}
        {demoResult && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/60 p-5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Workload Execution Result</h4>
                <p className="text-xs text-slate-500">
                  Sanitized outputs scrubbed from simulated enclave memory
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-[11px] font-bold text-amber-900">
                  {demoResult.execution_mode}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    demoResult.approved
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-rose-100 text-rose-800 border border-rose-300'
                  }`}
                >
                  {demoResult.approved ? 'Approved' : 'Declined'}
                </span>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-xs">
                <span className="text-[11px] text-slate-500 uppercase font-semibold">
                  Masked Account
                </span>
                <p className="mt-1 font-mono text-sm font-bold text-slate-800">
                  {demoResult.masked_account_id}
                </p>
              </div>

              <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-xs">
                <span className="text-[11px] text-slate-500 uppercase font-semibold">
                  Debt-to-Income (DTI)
                </span>
                <p className="mt-1 text-sm font-bold text-slate-800">
                  {demoResult.debt_to_income_ratio}%
                </p>
              </div>

              <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-xs">
                <span className="text-[11px] text-slate-500 uppercase font-semibold">
                  Credit Risk Score
                </span>
                <p className="mt-1 text-sm font-bold text-slate-800">
                  {demoResult.credit_risk_score} / 850
                </p>
              </div>

              <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-xs">
                <span className="text-[11px] text-slate-500 uppercase font-semibold">
                  Approved Facility
                </span>
                <p className="mt-1 text-sm font-bold text-emerald-700">
                  {formatCurrency(demoResult.approved_limit)}
                </p>
              </div>
            </div>

            {/* Policy Recommendation */}
            <div className="rounded-xl bg-white p-3.5 border border-slate-200 text-xs text-slate-700">
              <span className="font-bold block text-slate-800 mb-1">Underwriting Decision:</span>
              <p className="leading-5">{demoResult.recommendation}</p>
            </div>

            {/* Step-by-Step Simulated Enclave Trace */}
            <div>
              <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Simulated Memory Execution Trace
              </h5>
              <div className="space-y-2">
                {demoResult.execution_trace.map((step) => (
                  <div
                    key={step.step_number}
                    className="rounded-xl bg-white p-3 border border-slate-200 text-xs"
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                      <span className="font-bold text-slate-800">{step.phase}</span>
                      <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] text-slate-600 font-mono">
                        {step.simulated_isolation_boundary}
                      </code>
                    </div>
                    <p className="text-slate-600 text-[11px] leading-4">{step.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Implemented Security Controls Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Implemented & Verified Security Controls
            </h3>
            <p className="text-xs text-slate-500">
              Active application-level controls covered by automated integration test verification.
            </p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
            5 Controls Active
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {verifiedControls.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs hover:border-slate-300 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircleIcon className="w-4 h-4 text-emerald-600 shrink-0" />
                  <h4 className="text-sm font-bold text-slate-900">{item.title}</h4>
                </div>
                <span className="shrink-0 rounded-sm bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  {item.status}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">{item.detail}</p>
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                <span>Location:</span>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                  {item.component}
                </code>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Planned TEE Enclave Roadmap */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Future Objective: Hardware Enclave (TEE) Roadmap
            </h3>
            <p className="text-xs text-slate-500">
              Hardware-enforced memory isolation planned for future research phases.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 border border-slate-200">
            Research Objectives
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {plannedTEEFeatures.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-5 shadow-xs flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center gap-2">
                  <ClockIcon className="w-4 h-4 text-slate-500 shrink-0" />
                  <h4 className="text-sm font-bold text-slate-800">{item.title}</h4>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-600">{item.detail}</p>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-200/60 text-[11px] text-slate-500">
                <span className="font-semibold text-slate-700">{item.technology}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
