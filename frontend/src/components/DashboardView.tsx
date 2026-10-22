import { useEffect, useState, type FC } from 'react'
import type { AdminSummary, HealthStatus, Transaction, UserRole } from '../types'
import {
  fetchAdminSummary,
  fetchTransactions,
  checkHealth,
  checkDbHealth,
} from '../api'
import { formatCurrency } from '../utils'
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  RefreshIcon,
} from './Icons'

interface DashboardViewProps {
  user: { id: number; username: string; role: UserRole } | null
  onNavigate: (page: 'Transactions' | 'KYC Records' | 'Security' | 'Admin') => void
  onOpenAuth: () => void
}

export const DashboardView: FC<DashboardViewProps> = ({
  user,
  onNavigate,
  onOpenAuth,
}) => {
  const [adminSummary, setAdminSummary] = useState<AdminSummary | null>(null)
  const [userTransactions, setUserTransactions] = useState<Transaction[]>([])
  const [apiHealth, setApiHealth] = useState<HealthStatus | null>(null)
  const [dbHealth, setDbHealth] = useState<HealthStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDashboardData = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // 1. Always check API & DB health
      const [h, dbH] = await Promise.allSettled([checkHealth(), checkDbHealth()])
      if (h.status === 'fulfilled') setApiHealth(h.value)
      if (dbH.status === 'fulfilled') setDbHealth(dbH.value)

      if (user) {
        if (user.role === 'admin') {
          // Admin can load admin summary
          const summary = await fetchAdminSummary()
          setAdminSummary(summary)
        }
        // Fetch user's own transactions for recent preview
        const txns = await fetchTransactions()
        setUserTransactions(txns)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load dashboard data.'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let active = true

    const fetchData = async () => {
      try {
        const [h, dbH] = await Promise.allSettled([checkHealth(), checkDbHealth()])
        if (!active) return
        if (h.status === 'fulfilled') setApiHealth(h.value)
        if (dbH.status === 'fulfilled') setDbHealth(dbH.value)

        if (user) {
          if (user.role === 'admin') {
            const summary = await fetchAdminSummary()
            if (!active) return
            setAdminSummary(summary)
          }
          const txns = await fetchTransactions()
          if (!active) return
          setUserTransactions(txns)
        }
      } catch (err: unknown) {
        if (!active) return
        const msg = err instanceof Error ? err.message : 'Failed to load dashboard data.'
        setError(msg)
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
            Confidential Banking Workload Protection
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Secure Operations Overview
          </h2>
          <p className="mt-1.5 max-w-2xl text-xs sm:text-sm leading-5 text-slate-600">
            A central interface for transaction processing, KYC records, role-based access control, and confidential computing infrastructure.
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
            Live Database Connected
          </span>
        </div>
      </div>

      {/* Error state with retry */}
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
            <h4 className="text-sm font-bold text-blue-900">Sign in to interact with banking workloads</h4>
            <p className="mt-1 text-xs text-blue-800">
              Transactions, customer KYC verification, and administrative audit features require a valid JWT token.
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

      {/* Statistics Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {user?.role === 'admin' ? (
          // Admin sees system-wide aggregates from /admin/summary
          <>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-start justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Total Users
                </p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700 font-bold text-xs">
                  USR
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
                {isLoading ? '...' : adminSummary?.total_users ?? '—'}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">Aggregated from users table</p>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-start justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Total Transactions
                </p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-700 font-bold text-xs">
                  TXN
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
                {isLoading ? '...' : adminSummary?.total_transactions ?? '—'}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">System-wide transaction count</p>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-start justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Total KYC Records
                </p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700 font-bold text-xs">
                  KYC
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
                {isLoading ? '...' : adminSummary?.total_kyc_records ?? '—'}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">Customer verification records</p>
            </article>
          </>
        ) : (
          // Regular User sees their personalized stats
          <>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-start justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  My Transactions
                </p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700 font-bold text-xs">
                  TXN
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
                {isLoading ? '...' : userTransactions.length}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {user ? 'Filtered by your account ID' : 'Sign in to view records'}
              </p>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-start justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Account Status
                </p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 font-bold text-xs">
                  ACT
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-emerald-600">
                {user ? 'Active' : 'Guest'}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">Role: {user?.role ?? 'Unauthenticated'}</p>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-start justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Enclave Session
                </p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-700 font-bold text-xs">
                  ENC
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
                Planned
              </p>
              <p className="mt-1 text-[11px] text-slate-500">JWT Token: {user ? 'Present (session)' : 'Inactive'}</p>
            </article>
          </>
        )}

        {/* Real-time Health Card */}
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              API & DB Health
            </p>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 font-bold text-xs">
              HLT
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            {isSystemOnline ? 'Healthy' : 'Degraded'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            PostgreSQL: {dbHealth?.status === 'connected' ? 'Connected' : 'Checking'}
          </p>
        </article>
      </section>

      {/* Main Grid: Transactions & Security Overview */}
      <section className="grid gap-6 xl:grid-cols-3">
        {/* Recent Transactions Table */}
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs xl:col-span-2">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-base font-bold text-slate-900">Recent Transactions</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {user
                  ? 'Real live transactions belonging to your authenticated account'
                  : 'Live database records appear here after sign in'}
              </p>
            </div>
            {user && (
              <button
                type="button"
                onClick={() => onNavigate('Transactions')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <span>View all transactions</span>
                <ArrowRightIcon className="w-3.5 h-3.5 text-slate-500" />
              </button>
            )}
          </div>

          <div className="mt-5 overflow-x-auto">
            {!user ? (
              <div className="py-12 text-center text-slate-500">
                <p className="text-sm font-medium">Please sign in to view your banking transactions.</p>
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="mt-3 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition"
                >
                  Sign In
                </button>
              </div>
            ) : userTransactions.length === 0 ? (
              <div className="py-12 text-center text-slate-500">
                <p className="text-sm font-medium">No transactions recorded yet in the database.</p>
                <button
                  type="button"
                  onClick={() => onNavigate('Transactions')}
                  className="mt-3 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition"
                >
                  Post Your First Transaction
                </button>
              </div>
            ) : (
              <table className="w-full min-w-[540px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="pb-3 pr-4">Txn ID</th>
                    <th className="pb-3 pr-4">Account</th>
                    <th className="pb-3 pr-4">Type</th>
                    <th className="pb-3 pr-4">Amount</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {userTransactions.slice(0, 5).map((txn) => (
                    <tr key={txn.id} className="hover:bg-slate-50/50 transition">
                      <td className="py-3.5 pr-4 font-mono text-xs font-semibold text-slate-900">
                        TXN-{txn.id}
                      </td>
                      <td className="py-3.5 pr-4 text-xs font-medium text-slate-700">
                        {txn.account_id}
                      </td>
                      <td className="py-3.5 pr-4 text-xs capitalize text-slate-600">
                        {txn.transaction_type}
                      </td>
                      <td className="py-3.5 pr-4 text-xs font-semibold text-slate-900">
                        {txn.transaction_type === 'withdrawal' ? '-' : '+'}
                        {formatCurrency(txn.amount)}
                      </td>
                      <td className="py-3.5 pr-4">
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          <CheckCircleIcon className="w-3 h-3 text-emerald-600" />
                          {txn.status}
                        </span>
                      </td>
                      <td className="py-3.5 text-xs text-slate-400">
                        {new Date(txn.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </article>

        {/* Security Overview & Capabilities Card */}
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Security Architecture</h3>
              <button
                type="button"
                onClick={() => onNavigate('Security')}
                className="text-xs font-semibold text-blue-700 hover:text-blue-800"
              >
                Details →
              </button>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Verified controls vs future confidential computing roadmap
            </p>

            <div className="mt-5 space-y-4">
              {[
                {
                  title: 'JWT Authentication',
                  desc: 'HMAC-SHA256 bearer tokens with 30-min expiry',
                  status: 'Implemented',
                },
                {
                  title: 'Argon2 Password Hashing',
                  desc: 'pwdlib recommended memory-hard hashing',
                  status: 'Implemented',
                },
                {
                  title: 'Role-Based Access Control',
                  desc: 'Strict multi-tenant & admin endpoint boundary',
                  status: 'Implemented',
                },
                {
                  title: 'PostgreSQL Health Checks',
                  desc: 'Session pooling with automatic pre-ping',
                  status: 'Tested',
                },
                {
                  title: 'Hardware TEE Integration',
                  desc: 'Intel SGX / AMD SEV confidential enclave execution',
                  status: 'Planned',
                },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      item.status === 'Planned'
                        ? 'bg-slate-100 text-slate-500'
                        : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {item.status === 'Planned' ? (
                      <ClockIcon className="w-3.5 h-3.5" />
                    ) : (
                      <CheckCircleIcon className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800">{item.title}</p>
                    <p className="text-[11px] leading-4 text-slate-500">{item.desc}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold ${
                      item.status === 'Planned'
                        ? 'bg-slate-100 text-slate-600'
                        : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-xl bg-slate-50 p-3.5 border border-slate-100">
            <p className="text-xs font-bold text-slate-700">Academic & Prototype Notice</p>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">
              Hardware-backed isolation requires genuine CPU enclave extensions (e.g. Intel SGX). Standard cryptographic and authorization protections are fully operational.
            </p>
          </div>
        </article>
      </section>
    </div>
  )
}
