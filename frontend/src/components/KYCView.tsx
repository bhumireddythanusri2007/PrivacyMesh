import { useEffect, useState, type FC, type FormEvent } from 'react'
import type { KYCRecord, UserRole } from '../types'
import { createKYCRecord, fetchKYCRecords } from '../api'
import {
  CheckCircleIcon,
  ClockIcon,
  KYCIcon,
  PlusIcon,
  RefreshIcon,
} from './Icons'

interface KYCViewProps {
  user: { id: number; username: string; role: UserRole } | null
  onOpenAuth: () => void
}

export const KYCView: FC<KYCViewProps> = ({ user, onOpenAuth }) => {
  const [kycRecords, setKycRecords] = useState<KYCRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Creation modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [customerRef, setCustomerRef] = useState('')
  const [documentType, setDocumentType] = useState('Passport')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const loadKYC = async () => {
    if (!user) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchKYCRecords()
      setKycRecords(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve KYC records.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!user) return

    let active = true
    const fetchData = async () => {
      try {
        const data = await fetchKYCRecords()
        if (!active) return
        setKycRecords(data)
      } catch (err: unknown) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to retrieve KYC records.')
      }
    }
    void fetchData()

    return () => {
      active = false
    }
  }, [user])

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const trimmedRef = customerRef.trim()
    const trimmedDoc = documentType.trim()

    if (!trimmedRef) {
      setFormError('Customer reference is required.')
      return
    }

    if (!trimmedDoc) {
      setFormError('Document type is required.')
      return
    }

    setIsSubmitting(true)
    try {
      await createKYCRecord(trimmedRef, trimmedDoc)
      setCustomerRef('')
      setDocumentType('Passport')
      setIsModalOpen(false)
      await loadKYC()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'KYC record registration failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!user) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center max-w-xl mx-auto shadow-xs">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
          <KYCIcon className="w-6 h-6" />
        </div>
        <h3 className="mt-4 text-base font-bold text-slate-900">Authentication Required</h3>
        <p className="mt-1.5 text-xs text-slate-600 leading-5">
          You must be authenticated to register or inspect confidential customer KYC verification files.
        </p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="mt-5 rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition"
        >
          Sign In
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-slate-900">KYC Verification Records</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {user.role === 'admin'
              ? 'Administrator View: Access to all customer verification records across tenants'
              : 'User View: Inspect and register your permitted customer identity dossiers'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadKYC}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
          >
            <RefreshIcon className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setFormError(null)
              setIsModalOpen(true)
            }}
            className="flex items-center gap-1.5 rounded-xl bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            New KYC Record
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={loadKYC} className="underline font-bold">
            Retry
          </button>
        </div>
      )}

      {/* KYC Table Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="overflow-x-auto">
          {isLoading && kycRecords.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-500">Loading KYC records...</div>
          ) : kycRecords.length === 0 ? (
            <div className="py-16 text-center text-slate-500">
              <p className="text-sm font-semibold text-slate-700">No KYC Records Found</p>
              <p className="mt-1 text-xs text-slate-500">
                You have not submitted any customer references for verification yet.
              </p>
            </div>
          ) : (
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="pb-3 pr-4">Record ID</th>
                  <th className="pb-3 pr-4">Customer Ref</th>
                  <th className="pb-3 pr-4">Document Type</th>
                  <th className="pb-3 pr-4">Verification</th>
                  <th className="pb-3 pr-4">Risk Category</th>
                  <th className="pb-3">Registered At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {kycRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50/50 transition">
                    <td className="py-3.5 pr-4 font-mono text-xs font-bold text-slate-900">
                      KYC-{record.id}
                    </td>
                    <td className="py-3.5 pr-4 font-mono text-xs text-slate-800">
                      {record.customer_ref}
                    </td>
                    <td className="py-3.5 pr-4 text-xs font-medium text-slate-700">
                      {record.document_type}
                    </td>
                    <td className="py-3.5 pr-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          record.verification_status === 'verified'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {record.verification_status === 'verified' ? (
                          <CheckCircleIcon className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <ClockIcon className="w-3 h-3 text-amber-600" />
                        )}
                        {record.verification_status}
                      </span>
                    </td>
                    <td className="py-3.5 pr-4">
                      <span className="rounded-sm bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-600 font-medium">
                        {record.risk_category}
                      </span>
                    </td>
                    <td className="py-3.5 text-xs text-slate-400">
                      {new Date(record.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-base font-bold text-slate-900">Register KYC Dossier</h4>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Customer Reference Identifier
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CUST-BANK-9901"
                  value={customerRef}
                  onChange={(e) => setCustomerRef(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-hidden"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Unique reference token across customer databases.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Document Type
                </label>
                <select
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-hidden"
                >
                  <option value="Passport">Passport</option>
                  <option value="National Identity Card">National Identity Card</option>
                  <option value="Driver License">Driver License</option>
                  <option value="Taxpayer ID">Taxpayer ID (PAN / SSN)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 disabled:opacity-60 transition"
                >
                  {isSubmitting ? 'Registering...' : 'Register KYC'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
