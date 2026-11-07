import { useEffect, useState, type FC } from 'react'
import type {
  AdminSummary,
  HealthStatus,
  KYCSubmissionResponse,
  KYCSubmissionStatus,
  MonitoringStatusResponse,
  UserRole,
} from '../types'
import type { NavigationPage } from './Sidebar'
import {
  checkDbHealth,
  checkHealth,
  fetchAdminSummary,
  fetchAssignedKYCCases,
  fetchManagerKYCCases,
  fetchMonitoringStatus,
  fetchMyKYCSubmissions,
} from '../api'
import {
  ActivityIcon,
  AdminIcon,
  AlertIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  CpuChipIcon,
  KYCIcon,
  RefreshIcon,
} from './Icons'

interface DashboardViewProps {
  user: { id: number; username: string; role: UserRole } | null
  onNavigate: (page: NavigationPage) => void
  onOpenAuth: () => void
}

export const DashboardView: FC<DashboardViewProps> = ({
  user,
  onNavigate,
  onOpenAuth,
}) => {
  // Shared health & telemetry states
  const [apiHealth, setApiHealth] = useState<HealthStatus | null>(null)
  const [dbHealth, setDbHealth] = useState<HealthStatus | null>(null)
  const [monitoringStatus, setMonitoringStatus] = useState<MonitoringStatusResponse | null>(null)

  // Role-specific datasets
  const [adminSummary, setAdminSummary] = useState<AdminSummary | null>(null)
  const [customerSubmissions, setCustomerSubmissions] = useState<KYCSubmissionResponse[]>([])
  const [employeeCases, setEmployeeCases] = useState<KYCSubmissionResponse[]>([])
  const [managerCases, setManagerCases] = useState<KYCSubmissionResponse[]>([])

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDashboardData = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // 1. Shared telemetry and infrastructure health
      const [h, dbH, mon] = await Promise.allSettled([
        checkHealth(),
        checkDbHealth(),
        fetchMonitoringStatus(),
      ])
      if (h.status === 'fulfilled') setApiHealth(h.value)
      if (dbH.status === 'fulfilled') setDbHealth(dbH.value)
      if (mon.status === 'fulfilled') setMonitoringStatus(mon.value)

      // 2. Strictly role-scoped business dataset retrieval
      if (user) {
        if (user.role === 'customer' || user.role === 'user') {
          const subs = await fetchMyKYCSubmissions()
          setCustomerSubmissions(subs)
        } else if (user.role === 'bank_employee') {
          const empCases = await fetchAssignedKYCCases()
          setEmployeeCases(empCases)
        } else if (user.role === 'bank_manager') {
          const mCases = await fetchManagerKYCCases()
          setManagerCases(mCases)
        } else if (user.role === 'system_admin' || user.role === 'admin') {
          const sum = await fetchAdminSummary()
          setAdminSummary(sum)
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let active = true

    const fetchData = async () => {
      try {
        const [h, dbH, mon] = await Promise.allSettled([
          checkHealth(),
          checkDbHealth(),
          fetchMonitoringStatus(),
        ])
        if (!active) return
        if (h.status === 'fulfilled') setApiHealth(h.value)
        if (dbH.status === 'fulfilled') setDbHealth(dbH.value)
        if (mon.status === 'fulfilled') setMonitoringStatus(mon.value)

        if (user) {
          if (user.role === 'customer' || user.role === 'user') {
            const subs = await fetchMyKYCSubmissions()
            if (!active) return
            setCustomerSubmissions(subs)
          } else if (user.role === 'bank_employee') {
            const empCases = await fetchAssignedKYCCases()
            if (!active) return
            setEmployeeCases(empCases)
          } else if (user.role === 'bank_manager') {
            const mCases = await fetchManagerKYCCases()
            if (!active) return
            setManagerCases(mCases)
          } else if (user.role === 'system_admin' || user.role === 'admin') {
            const sum = await fetchAdminSummary()
            if (!active) return
            setAdminSummary(sum)
          }
        }
      } catch (err: unknown) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data.')
      }
    }

    void fetchData()
    return () => {
      active = false
    }
  }, [user])

  const isSystemOnline = apiHealth?.status === 'healthy' && dbHealth?.status === 'connected'

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold tracking-widest text-blue-700 uppercase">
            Confidential Banking Platform
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {user?.role === 'customer'
              ? 'Customer KYC Hub'
              : user?.role === 'bank_employee'
              ? 'Compliance Officer Workbench'
              : user?.role === 'bank_manager'
              ? 'Management Oversight Console'
              : user?.role === 'system_admin' || user?.role === 'admin'
              ? 'System Operations & Infrastructure'
              : 'Secure Operations Overview'}
          </h2>
          <p className="mt-1.5 max-w-2xl text-xs sm:text-sm leading-5 text-slate-600">
            {user?.role === 'customer'
              ? 'Submit and track identity verification dossiers protected by role-based access controls and database-enforced row-level security.'
              : user?.role === 'bank_employee'
              ? 'Perform compliance examinations, evaluate applicant dossiers, and route recommendations.'
              : user?.role === 'bank_manager'
              ? 'Supervise bank-wide verification queues, assign compliance officers, and execute binding determinations.'
              : user?.role === 'system_admin' || user?.role === 'admin'
              ? 'Monitor platform health, telemetry metrics, and manage user identity credentials.'
              : 'A secure confidential computing platform for sensitive banking data workloads and identity verification.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadDashboardData}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
          >
            <RefreshIcon className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <span className="w-fit rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
            {isSystemOnline ? 'System Operational' : 'Telemetry Degraded'}
          </span>
        </div>
      </div>

      {/* Global Error Alert */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={loadDashboardData}
            className="ml-3 font-bold underline hover:text-rose-950"
          >
            Retry
          </button>
        </div>
      )}

      {/* Unauthenticated Alert Prompt */}
      {!user && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-bold text-blue-900">Sign in to access your role workspace</h4>
            <p className="mt-1 text-xs text-blue-800">
              Identity verification, compliance case queues, and management oversight require an authenticated session.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenAuth}
            className="shrink-0 rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition"
          >
            Sign In / Register
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* ROLE 1: CUSTOMER DASHBOARD                                          */}
      {/* ==================================================================== */}
      {(user?.role === 'customer' || user?.role === 'user') && (
        <CustomerDashboardContent
          submissions={customerSubmissions}
          isLoading={isLoading}
          onNavigate={onNavigate}
        />
      )}

      {/* ==================================================================== */}
      {/* ROLE 2: BANK EMPLOYEE DASHBOARD                                     */}
      {/* ==================================================================== */}
      {user?.role === 'bank_employee' && (
        <EmployeeDashboardContent
          cases={employeeCases}
          isLoading={isLoading}
          onNavigate={onNavigate}
        />
      )}

      {/* ==================================================================== */}
      {/* ROLE 3: BANK MANAGER DASHBOARD                                      */}
      {/* ==================================================================== */}
      {user?.role === 'bank_manager' && (
        <ManagerDashboardContent
          cases={managerCases}
          isLoading={isLoading}
          onNavigate={onNavigate}
        />
      )}

      {/* ==================================================================== */}
      {/* ROLE 4: SYSTEM ADMINISTRATOR DASHBOARD                              */}
      {/* ==================================================================== */}
      {(user?.role === 'system_admin' || user?.role === 'admin') && (
        <SystemAdminDashboardContent
          adminSummary={adminSummary}
          apiHealth={apiHealth}
          dbHealth={dbHealth}
          monitoringStatus={monitoringStatus}
          isLoading={isLoading}
          onNavigate={onNavigate}
        />
      )}

      {/* ==================================================================== */}
      {/* UNAUTHENTICATED / GUEST DASHBOARD                                    */}
      {/* ==================================================================== */}
      {!user && (
        <GuestDashboardContent
          apiHealth={apiHealth}
          dbHealth={dbHealth}
          monitoringStatus={monitoringStatus}
          onNavigate={onNavigate}
        />
      )}
    </div>
  )
}

// ============================================================================
// Role-Specific Sub-Components
// ============================================================================

function CustomerDashboardContent({
  submissions,
  isLoading,
  onNavigate,
}: {
  submissions: KYCSubmissionResponse[]
  isLoading: boolean
  onNavigate: (page: NavigationPage) => void
}) {
  const total = submissions.length
  const awaiting = submissions.filter((s) =>
    ['submitted', 'under_employee_review', 'pending_manager_decision'].includes(s.status)
  ).length
  const correction = submissions.filter((s) => s.status === 'correction_requested').length
  const finalized = submissions.filter((s) =>
    ['approved', 'rejected', 'legacy_verified'].includes(s.status)
  ).length

  return (
    <div className="space-y-6">
      {/* 4 Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">My Submissions</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700 font-bold text-xs">
              ALL
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{isLoading ? '...' : total}</p>
          <p className="mt-1 text-[11px] text-slate-500">Total registered applications</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Awaiting Bank Action</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
              <ClockIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-sky-700">{isLoading ? '...' : awaiting}</p>
          <p className="mt-1 text-[11px] text-slate-500">Submitted, under review, or awaiting a manager decision</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Correction Required</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-700">
              <AlertIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-orange-700">{isLoading ? '...' : correction}</p>
          <p className="mt-1 text-[11px] text-slate-500">Action needed from you</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Final Determinations</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <CheckCircleIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-emerald-700">{isLoading ? '...' : finalized}</p>
          <p className="mt-1 text-[11px] text-slate-500">Approved or concluded</p>
        </article>
      </section>

      {/* Main Grid: Recent Submissions & Action Banner */}
      <section className="grid gap-6 xl:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Recent KYC Applications</h3>
              <p className="text-xs text-slate-500">Real-time status of your identity submissions</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('My KYC')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 transition"
            >
              <span>Manage in My KYC</span>
              <ArrowRightIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          {submissions.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <p className="text-sm font-semibold text-slate-700">No applications on file</p>
              <p className="mt-1 text-xs text-slate-500">Submit your verification documents to activate banking services.</p>
              <button
                type="button"
                onClick={() => onNavigate('My KYC')}
                className="mt-3 rounded-xl bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition"
              >
                Start Verification
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="pb-3 pr-3">Ref</th>
                    <th className="pb-3 pr-3">Doc Type</th>
                    <th className="pb-3 pr-3">Version</th>
                    <th className="pb-3 pr-3">Status</th>
                    <th className="pb-3">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {submissions.slice(0, 4).map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/50 transition">
                      <td className="py-3 pr-3 font-mono text-xs font-bold text-slate-900">{s.submission_ref}</td>
                      <td className="py-3 pr-3 text-xs text-slate-700">{s.current_version?.document_type || 'Identity Dossier'}</td>
                      <td className="py-3 pr-3 font-mono text-xs text-slate-600">v{s.current_version?.version_number ?? 1}</td>
                      <td className="py-3 pr-3"><DashboardStatusBadge status={s.status} /></td>
                      <td className="py-3 text-xs text-slate-400">{new Date(s.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        {/* Customer Privacy Card */}
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CpuChipIcon className="w-5 h-5 text-blue-700" />
              <h3 className="text-base font-bold text-slate-900">Privacy & Confidentiality</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Your identity verification data is protected by role-based access controls and database-enforced row-level security.
            </p>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 text-xs">
                <p className="font-semibold text-slate-800">Direct Decision Receipts</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Applicant determinations and notices are delivered without intermediate disclosure.</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 text-xs">
                <p className="font-semibold text-slate-800">Internal Audit Isolation</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Compliance notes and supervisory remarks are kept strictly within bank staff boundaries.</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('Security')}
            className="mt-4 text-xs font-semibold text-blue-700 hover:underline inline-flex items-center gap-1"
          >
            <span>Inspect Security Architecture</span>
            <ArrowRightIcon className="w-3.5 h-3.5" />
          </button>
        </article>
      </section>
    </div>
  )
}

function EmployeeDashboardContent({
  cases,
  isLoading,
  onNavigate,
}: {
  cases: KYCSubmissionResponse[]
  isLoading: boolean
  onNavigate: (page: NavigationPage) => void
}) {
  const total = cases.length
  const awaiting = cases.filter((c) => c.status === 'submitted').length
  const underReview = cases.filter((c) => c.status === 'under_employee_review').length
  const recommended = cases.filter((c) =>
    ['pending_manager_decision', 'approved', 'rejected', 'correction_requested'].includes(c.status)
  ).length

  return (
    <div className="space-y-6">
      {/* 4 Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Assigned Cases</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700 font-bold text-xs">
              ALL
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{isLoading ? '...' : total}</p>
          <p className="mt-1 text-[11px] text-slate-500">Cases allocated to your officer queue</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Awaiting Review</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
              <ClockIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-sky-700">{isLoading ? '...' : awaiting}</p>
          <p className="mt-1 text-[11px] text-slate-500">Ready for review initiation</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Under Review</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <AlertIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-amber-700">{isLoading ? '...' : underReview}</p>
          <p className="mt-1 text-[11px] text-slate-500">Active examination in progress</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Recommendations Routed</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <CheckCircleIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-emerald-700">{isLoading ? '...' : recommended}</p>
          <p className="mt-1 text-[11px] text-slate-500">Escalated to Bank Manager</p>
        </article>
      </section>

      {/* Main Grid: Workload Queue & Quick Action */}
      <section className="grid gap-6 xl:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Active Workload Queue</h3>
              <p className="text-xs text-slate-500">Pending compliance evaluations in your queue</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('Assigned Cases')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 transition"
            >
              <span>Open Assigned Cases</span>
              <ArrowRightIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          {cases.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <p className="text-sm font-semibold text-slate-700">No assigned cases</p>
              <p className="mt-1 text-xs text-slate-500">You currently have no compliance cases pending in your queue.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="pb-3 pr-3">Ref</th>
                    <th className="pb-3 pr-3">Applicant</th>
                    <th className="pb-3 pr-3">Doc Type</th>
                    <th className="pb-3 pr-3">Status</th>
                    <th className="pb-3">Assigned Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cases.slice(0, 4).map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/50 transition">
                      <td className="py-3 pr-3 font-mono text-xs font-bold text-slate-900">{c.submission_ref}</td>
                      <td className="py-3 pr-3 text-xs text-slate-600">{c.customer_id ? `Customer #${c.customer_id}` : 'Applicant'}</td>
                      <td className="py-3 pr-3 text-xs text-slate-700">{c.current_version?.document_type || 'Identity Dossier'}</td>
                      <td className="py-3 pr-3"><DashboardStatusBadge status={c.status} /></td>
                      <td className="py-3 text-xs text-slate-400">{new Date(c.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        {/* Officer Policy Card */}
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <KYCIcon className="w-5 h-5 text-blue-700" />
              <h3 className="text-base font-bold text-slate-900">Officer Protocol</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Compliance officers record structured recommendations. Binding determinations are rendered exclusively by Bank Managers.
            </p>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 text-xs">
                <p className="font-semibold text-slate-800">Review Claim Requirement</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Initiate review on new dossiers to lock the case into active examination.</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 text-xs">
                <p className="font-semibold text-slate-800">Immutable Audit Trail</p>
                <p className="mt-0.5 text-[11px] text-slate-500">All recommendations and internal notes are permanently recorded and cannot be altered.</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('Assigned Cases')}
            className="mt-4 text-xs font-semibold text-blue-700 hover:underline inline-flex items-center gap-1"
          >
            <span>Proceed to Examination Queue</span>
            <ArrowRightIcon className="w-3.5 h-3.5" />
          </button>
        </article>
      </section>
    </div>
  )
}

function ManagerDashboardContent({
  cases,
  isLoading,
  onNavigate,
}: {
  cases: KYCSubmissionResponse[]
  isLoading: boolean
  onNavigate: (page: NavigationPage) => void
}) {
  const total = cases.length
  const unassigned = cases.filter((c) => !c.assigned_employee_id && c.status === 'submitted').length
  const pendingDecision = cases.filter((c) => c.status === 'pending_manager_decision').length
  const assignedSubmitted = cases.filter((c) => !!c.assigned_employee_id && c.status === 'submitted').length
  const underReview = cases.filter((c) => c.status === 'under_employee_review').length
  const officerQueue = assignedSubmitted + underReview

  return (
    <div className="space-y-6">
      {/* 4 Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Cases</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 font-bold text-xs">
              ALL
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{isLoading ? '...' : total}</p>
          <p className="mt-1 text-[11px] text-slate-500">All registered cases, including completed cases</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unassigned</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-700">
              <AlertIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-rose-700">{isLoading ? '...' : unassigned}</p>
          <p className="mt-1 text-[11px] text-slate-500">Awaiting compliance officer assignment</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pending Manager Action</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
              <ClockIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-indigo-700">{isLoading ? '...' : pendingDecision}</p>
          <p className="mt-1 text-[11px] text-slate-500">Ready for final binding determination</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Assigned / In Review</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <ActivityIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-amber-700">{isLoading ? '...' : officerQueue}</p>
          <p className="mt-1 text-[11px] text-slate-500">Assigned to an officer or under examination</p>
        </article>
      </section>

      {/* Main Grid: Management Oversight Priority Cases */}
      <section className="grid gap-6 xl:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Priority Cases Requiring Disposition</h3>
              <p className="text-xs text-slate-500">Dossiers awaiting officer allocation or final determination</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('Case Management')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 transition"
            >
              <span>Open Case Management</span>
              <ArrowRightIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          {cases.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <p className="text-sm font-semibold text-slate-700">No cases on file</p>
              <p className="mt-1 text-xs text-slate-500">Bank-wide registry is currently clear.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="pb-3 pr-2">Ref</th>
                    <th className="pb-3 pr-2">Doc Type</th>
                    <th className="pb-3 pr-2">Assigned Officer</th>
                    <th className="pb-3 pr-2">Status</th>
                    <th className="pb-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cases.slice(0, 4).map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/50 transition">
                      <td className="py-3 pr-2 font-mono text-xs font-bold text-slate-900">{c.submission_ref}</td>
                      <td className="py-3 pr-2 text-xs text-slate-700">{c.current_version?.document_type || 'Identity Dossier'}</td>
                      <td className="py-3 pr-2 text-xs">
                        {c.assigned_employee_id ? `Officer #${c.assigned_employee_id}` : (
                          <span className="text-[10px] font-bold text-rose-600 uppercase bg-rose-50 px-1 py-0.5 rounded-sm">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3 pr-2"><DashboardStatusBadge status={c.status} /></td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onNavigate('Case Management')}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 transition"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        {/* Manager Governance Card */}
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircleIcon className="w-5 h-5 text-indigo-700" />
              <h3 className="text-base font-bold text-slate-900">Governance & Authority</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Bank Managers hold exclusive authority to authorize binding determinations and archive completed cases.
            </p>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 text-xs">
                <p className="font-semibold text-slate-800">Binding Decisions</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Only manager decisions trigger applicant notifications and transition account statuses.</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 text-xs">
                <p className="font-semibold text-slate-800">Zero Admin Intervention</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Administrative superusers are completely isolated from KYC dossiers to satisfy banking privacy regulations.</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('Case Management')}
            className="mt-4 text-xs font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1"
          >
            <span>Open Case Management Portal</span>
            <ArrowRightIcon className="w-3.5 h-3.5" />
          </button>
        </article>
      </section>
    </div>
  )
}



function SystemAdminDashboardContent({
  adminSummary,
  apiHealth,
  dbHealth,
  monitoringStatus,
  isLoading,
  onNavigate,
}: {
  adminSummary: AdminSummary | null
  apiHealth: HealthStatus | null
  dbHealth: HealthStatus | null
  monitoringStatus: MonitoringStatusResponse | null
  isLoading: boolean
  onNavigate: (page: NavigationPage) => void
}) {
  const isHealthy = apiHealth?.status === 'healthy' && dbHealth?.status === 'connected'

  return (
    <div className="space-y-6">
      {/* 4 Infrastructure Metric Cards (STRICTLY NON-KYC) */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Platform Users</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-700 font-bold text-xs">
              <AdminIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            {isLoading ? '...' : adminSummary?.total_users ?? '—'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Total credentials in database</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">API Gateway</p>
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${
              apiHealth?.status === 'healthy' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            }`}>
              <CheckCircleIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            {apiHealth?.status === 'healthy' ? 'Healthy' : 'Degraded'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">FastAPI backend listener :8000</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">PostgreSQL Service</p>
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${
              dbHealth?.status === 'connected' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            }`}>
              <CheckCircleIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            {dbHealth?.status === 'connected' ? 'Connected' : 'Disconnected'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Role: privacy_app with RLS</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Host CPU Telemetry</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <ActivityIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            {monitoringStatus?.cpu_percent !== undefined ? `${monitoringStatus.cpu_percent}%` : '—'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Mem: {monitoringStatus?.memory_percent !== undefined ? `${monitoringStatus.memory_percent}%` : '—'}
          </p>
        </article>
      </section>

      {/* Main Grid: Technical Operations & Administrative Isolation */}
      <section className="grid gap-6 xl:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs xl:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">Platform Operations & Telemetry</h3>
              <p className="text-xs text-slate-500">Technical health and resource metrics for system maintenance</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate('User Management')}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-50 transition"
              >
                User Management
              </button>
              <a
                href="http://localhost:3000/d/privacymesh-overview/privacymesh-application-observability"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition"
              >
                Grafana
              </a>
              <a
                href="http://localhost:9090"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-800 hover:bg-orange-100 transition"
              >
                Prometheus
              </a>
              <button
                type="button"
                onClick={() => onNavigate('Monitoring')}
                className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition"
              >
                View Telemetry
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 pt-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Database Engine State</span>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Database Connection:</span>
                <span className="font-bold text-emerald-700">{dbHealth?.status || 'Unknown'}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Least-Privilege Role:</span>
                <span className="font-mono font-semibold text-slate-800">privacy_app</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">RLS on Protected Tables:</span>
                <span className="font-semibold text-emerald-700">Enforced</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Resource Telemetry</span>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">CPU Usage:</span>
                <span className="font-mono font-bold text-slate-800">{monitoringStatus?.cpu_percent ?? '—'}%</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Memory Utilization:</span>
                <span className="font-mono font-bold text-slate-800">{monitoringStatus?.memory_percent ?? '—'}%</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Prometheus Exporter:</span>
                <span className="font-semibold text-blue-700">/metrics Active</span>
              </div>
            </div>
          </div>

          {/* Strict Separation-of-Duties Notice */}
          <div className="flex items-start gap-3 rounded-xl border border-purple-200 bg-purple-50/70 p-4 text-xs text-purple-950">
            <CpuChipIcon className="w-5 h-5 text-purple-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Separation-of-Duties & Administrative Isolation</p>
              <p className="mt-1 text-[11px] leading-relaxed text-purple-900">
                In strict compliance with banking confidentiality and least-privilege regulations, System Administrators supervise user authentication and technical infrastructure only. Customer KYC dossiers, identity verification documents, and compliance reviews are isolated from administrative accounts at the database RLS and API middleware layers.
              </p>
            </div>
          </div>
        </article>

        {/* Security Summary Card */}
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CpuChipIcon className="w-5 h-5 text-slate-700" />
              <h3 className="text-base font-bold text-slate-900">Confidential Enclave</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Confidential computing hardware detection and workload isolation status.
            </p>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 text-xs">
                <p className="font-semibold text-slate-800">Operational Health</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {isHealthy ? 'All services operational.' : 'Investigate telemetry alerts.'}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 text-xs">
                <p className="font-semibold text-slate-800">Role-Based Access Control</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Four roles active: Customer, Employee, Manager, Admin.</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('Security')}
            className="mt-4 text-xs font-semibold text-blue-700 hover:underline inline-flex items-center gap-1"
          >
            <span>Review Security Status</span>
            <ArrowRightIcon className="w-3.5 h-3.5" />
          </button>
        </article>
      </section>
    </div>
  )
}

function GuestDashboardContent({
  apiHealth,
  dbHealth,
  monitoringStatus,
  onNavigate,
}: {
  apiHealth: HealthStatus | null
  dbHealth: HealthStatus | null
  monitoringStatus: MonitoringStatusResponse | null
  onNavigate: (page: NavigationPage) => void
}) {
  const isHealthy = apiHealth?.status === 'healthy' && dbHealth?.status === 'connected'

  return (
    <div className="space-y-6">
      {/* Platform Status Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Platform Status</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <CheckCircleIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            {isHealthy ? 'Operational' : 'Degraded'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Backend and Database online</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Security Model</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <CpuChipIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">4-Tier RBAC</p>
          <p className="mt-1 text-[11px] text-slate-500">PostgreSQL RLS & session isolation</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Telemetry</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
              <ActivityIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            {monitoringStatus?.cpu_percent !== undefined ? `${monitoringStatus.cpu_percent}% CPU` : 'Active'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">System load monitoring active</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">TEE Readiness</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <ClockIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">Simulation</p>
          <p className="mt-1 text-[11px] text-slate-500">Software isolation prototype</p>
        </article>
      </section>

      {/* Informational Grid */}
      <section className="grid gap-6 xl:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs xl:col-span-2 space-y-4">
          <h3 className="text-base font-bold text-slate-900">PrivacyMesh Confidential Computing Architecture</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            PrivacyMesh is an academic research platform demonstrating confidential computing for sensitive banking workloads and multi-role KYC verification processes.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 pt-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5 text-xs">
              <p className="font-bold text-slate-800">Customer Workflow</p>
              <p className="mt-1 text-[11px] text-slate-500">Submit and track identity verification dossiers protected by role-based access controls and database-enforced row-level security.</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5 text-xs">
              <p className="font-bold text-slate-800">Compliance & Management</p>
              <p className="mt-1 text-[11px] text-slate-500">Structured officer recommendations and binding final determinations with immutable audit trails.</p>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Confidential Controls</h3>
            <p className="mt-1 text-xs text-slate-500">Explore security mechanisms and attestation status.</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('Security')}
            className="mt-4 text-xs font-semibold text-blue-700 hover:underline inline-flex items-center gap-1"
          >
            <span>Inspect Security Controls</span>
            <ArrowRightIcon className="w-3.5 h-3.5" />
          </button>
        </article>
      </section>
    </div>
  )
}

function DashboardStatusBadge({ status }: { status: KYCSubmissionStatus | string }) {
  switch (status) {
    case 'submitted':
      return (
        <span className="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
          Submitted
        </span>
      )
    case 'under_employee_review':
      return (
        <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
          In Review
        </span>
      )
    case 'pending_manager_decision':
      return (
        <span className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
          Pending Manager
        </span>
      )
    case 'approved':
      return (
        <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          Approved
        </span>
      )
    case 'rejected':
      return (
        <span className="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
          Rejected
        </span>
      )
    case 'correction_requested':
      return (
        <span className="inline-flex items-center rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
          Correction Needed
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
          {status.replace(/_/g, ' ')}
        </span>
      )
  }
}
