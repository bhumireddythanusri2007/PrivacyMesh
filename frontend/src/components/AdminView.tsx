import { useEffect, useState, type FC } from 'react'
import type { AdminSummary, User, UserRole } from '../types'
import { fetchAdminSummary, fetchAdminUsers } from '../api'
import { AdminIcon, RefreshIcon } from './Icons'

interface AdminViewProps {
  user: { id: number; username: string; role: UserRole } | null
  onOpenAuth: () => void
}

export const AdminView: FC<AdminViewProps> = ({ user, onOpenAuth }) => {
  const [summary, setSummary] = useState<AdminSummary | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = user?.role === 'admin' || user?.role === 'system_admin'

  const loadAdminData = async () => {
    if (!isAdmin) return

    setIsLoading(true)
    setError(null)
    try {
      const [sumData, usersData] = await Promise.all([
        fetchAdminSummary(),
        fetchAdminUsers(),
      ])
      setSummary(sumData)
      setUsers(usersData)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve administrative data.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!isAdmin) return

    let active = true
    const fetchData = async () => {
      try {
        const [sumData, usersData] = await Promise.all([
          fetchAdminSummary(),
          fetchAdminUsers(),
        ])
        if (!active) return
        setSummary(sumData)
        setUsers(usersData)
      } catch (err: unknown) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to retrieve administrative data.')
      }
    }
    void fetchData()

    return () => {
      active = false
    }
  }, [isAdmin])

  // Non-admin or unauthenticated access guard
  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-8 text-center max-w-xl mx-auto shadow-xs">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
          <AdminIcon className="w-6 h-6" />
        </div>
        <h3 className="mt-4 text-base font-bold text-rose-950">Access Restricted (HTTP 403)</h3>
        <p className="mt-1.5 text-xs text-rose-800 leading-5">
          The administrative control plane is restricted exclusively to authenticated users with the <span className="font-semibold">system_admin</span> role. Standard participants (customers, bank employees, and bank managers) cannot inspect global user records or administrative summaries.
        </p>
        {!user && (
          <button
            type="button"
            onClick={onOpenAuth}
            className="mt-5 rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition"
          >
            Sign In with Admin Account
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Refresh */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold tracking-tight text-slate-900">Administrator Console</h3>
            <span className="rounded-sm bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-700 uppercase tracking-wide">
              Privileged
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            User-account administration, technical audit metadata, and security telemetry. KYC dossiers and review decisions remain restricted to bank staff.
          </p>
        </div>

        <button
          type="button"
          onClick={loadAdminData}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
        >
          <RefreshIcon className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh Audit Data
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={loadAdminData} className="underline font-bold">
            Retry
          </button>
        </div>
      )}

      {/* System Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Registered Users</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {isLoading ? '...' : summary?.total_users ?? '—'}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">Database user identities</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Workload Transactions</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {isLoading ? '...' : summary?.total_transactions ?? '—'}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">Across all tenant accounts</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total KYC Records</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {isLoading ? '...' : summary?.total_kyc_records ?? '—'}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">Legacy customer verification records (not KYC workflow submissions)</p>
        </div>
      </div>

      {/* Security boundary notice */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900 flex items-start gap-3">
        <span className="shrink-0 mt-0.5 font-bold text-amber-700">⚠</span>
        <div>
          <span className="font-bold">Least-Privilege Boundary:</span> System administrators manage users and system accounts only. Access to KYC workflow submissions, dossiers, internal compliance notes, officer review records, and final decisions is strictly prohibited for this role (HTTP 403). KYC content is accessible only to bank_employee, bank_manager, and the owning customer.
        </div>
      </div>

      {/* Registered Users Table Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="mb-4">
          <h4 className="text-base font-bold text-slate-900">Registered System Users</h4>
          <p className="text-xs text-slate-500 mt-0.5">
            Audit view of active users. Sensitive authentication hashes are never exposed by the API.
          </p>
        </div>

        <div className="overflow-x-auto">
          {isLoading && users.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-500">Loading user catalog...</div>
          ) : (
            <table className="w-full min-w-[500px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="pb-3 pr-4">User ID</th>
                  <th className="pb-3 pr-4">Username</th>
                  <th className="pb-3 pr-4">Assigned Role</th>
                  <th className="pb-3">Registered At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/50 transition">
                    <td className="py-3.5 pr-4 font-mono text-xs font-semibold text-slate-900">
                      #{u.id}
                    </td>
                    <td className="py-3.5 pr-4 text-xs font-medium text-slate-800">
                      {u.username}
                      {u.username === user.username && (
                        <span className="ml-2 rounded-sm bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                          Current Session
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 pr-4">
                      <span
                        className={`inline-block rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          u.role === 'admin' || u.role === 'system_admin'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3.5 text-xs text-slate-400">
                      {new Date(u.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
