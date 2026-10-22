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

  const loadAdminData = async () => {
    if (!user || user.role !== 'admin') return

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
    if (!user || user.role !== 'admin') return

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
  }, [user])

  // Non-admin or unauthenticated access guard
  if (!user || user.role !== 'admin') {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-8 text-center max-w-xl mx-auto shadow-xs">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
          <AdminIcon className="w-6 h-6" />
        </div>
        <h3 className="mt-4 text-base font-bold text-rose-950">Access Restricted (HTTP 403)</h3>
        <p className="mt-1.5 text-xs text-rose-800 leading-5">
          The administrative control plane is restricted exclusively to authenticated users with the <span className="font-semibold">admin</span> role. Standard participants cannot inspect global user records or administrative summaries.
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
            System administration, global participant auditing, and security telemetry.
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
          <p className="mt-1 text-[11px] text-slate-400">Customer verification records</p>
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
                          u.role === 'admin'
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
