import { useEffect, useState, type FC, type FormEvent } from 'react'
import type {
  KYCAutoValidationStatus,
  KYCManagerAction,
  KYCReviewResponse,
  KYCSubmissionResponse,
  KYCSubmissionStatus,
  UserRole,
} from '../types'
import {
  archiveKYCSubmission,
  assignEmployeeToKYCCase,
  fetchKYCSubmissionDetail,
  fetchKYCSubmissionReviews,
  fetchManagerKYCCases,
  finalizeManagerKYCDecision,
} from '../api'
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  CpuChipIcon,
  KYCIcon,
  RefreshIcon,
} from './Icons'

interface ManagerWorkflowViewProps {
  user: { id: number; username: string; role: UserRole } | null
  onOpenAuth: () => void
}

export const ManagerWorkflowView: FC<ManagerWorkflowViewProps> = ({ user, onOpenAuth }) => {
  const [cases, setCases] = useState<KYCSubmissionResponse[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters and search
  const [statusFilter, setStatusFilter] = useState<'all' | 'unassigned' | 'submitted' | 'under_employee_review' | 'pending_manager_decision' | 'finalized'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Selected case and inspector state
  const [selectedCase, setSelectedCase] = useState<KYCSubmissionResponse | null>(null)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [reviews, setReviews] = useState<KYCReviewResponse[]>([])
  const [isLoadingReviews, setIsLoadingReviews] = useState(false)
  const [reviewsError, setReviewsError] = useState<string | null>(null)

  // Notifications
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null)
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null)

  // Assignment modal state
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)
  const [targetEmployeeId, setTargetEmployeeId] = useState('')
  const [isAssigning, setIsAssigning] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  // Final Decision modal state
  const [isDecisionModalOpen, setIsDecisionModalOpen] = useState(false)
  const [decisionAction, setDecisionAction] = useState<KYCManagerAction>('approve')
  const [customerNotes, setCustomerNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [confirmedBinding, setConfirmedBinding] = useState(false)
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false)
  const [decisionError, setDecisionError] = useState<string | null>(null)

  // Archive confirmation modal state
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  const isBankManager = user?.role === 'bank_manager'

  const loadManagerCases = async () => {
    if (!user || !isBankManager) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchManagerKYCCases()
      setCases(data)
      if (selectedCase) {
        const updated = data.find((c) => c.id === selectedCase.id)
        if (updated) setSelectedCase(updated)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve manager cases.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!user || !isBankManager) return
    let active = true

    const fetchInitial = async () => {
      setIsLoading(true)
      try {
        const data = await fetchManagerKYCCases()
        if (!active) return
        setCases(data)
      } catch (err: unknown) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to retrieve manager cases.')
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void fetchInitial()
    return () => {
      active = false
    }
  }, [user, isBankManager])

  // Select case and load details + review log
  const handleSelectCase = async (kCase: KYCSubmissionResponse) => {
    setSelectedCase(kCase)
    setIsLoadingDetail(true)
    setActionSuccessMessage(null)
    setActionErrorMessage(null)
    setReviews([])
    setReviewsError(null)

    try {
      const [detail, reviewList] = await Promise.allSettled([
        fetchKYCSubmissionDetail(kCase.id),
        fetchKYCSubmissionReviews(kCase.id),
      ])

      if (detail.status === 'fulfilled') {
        setSelectedCase(detail.value)
      }

      if (reviewList.status === 'fulfilled') {
        setReviews(reviewList.value)
      } else {
        setReviewsError(
          reviewList.reason instanceof Error
            ? reviewList.reason.message
            : 'Unable to load case review history.'
        )
      }
    } finally {
      setIsLoadingDetail(false)
    }
  }

  const loadCaseReviews = async (caseId: number) => {
    setIsLoadingReviews(true)
    setReviewsError(null)
    try {
      const list = await fetchKYCSubmissionReviews(caseId)
      setReviews(list)
    } catch (err: unknown) {
      setReviewsError(err instanceof Error ? err.message : 'Failed to retrieve reviews.')
    } finally {
      setIsLoadingReviews(false)
    }
  }

  // D. Assign employee to case
  const handleAssignSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedCase) return
    setAssignError(null)

    const empIdNum = parseInt(targetEmployeeId.trim(), 10)
    if (isNaN(empIdNum) || empIdNum <= 0) {
      setAssignError('Please enter a valid positive numerical Employee User ID.')
      return
    }

    setIsAssigning(true)
    try {
      const updated = await assignEmployeeToKYCCase(selectedCase.id, {
        assigned_employee_id: empIdNum,
      })
      setSelectedCase(updated)
      setIsAssignModalOpen(false)
      setTargetEmployeeId('')
      setActionSuccessMessage(`Case successfully assigned to Compliance Officer #${empIdNum}.`)
      await loadManagerCases()
      await loadCaseReviews(selectedCase.id)
    } catch (err: unknown) {
      setAssignError(err instanceof Error ? err.message : 'Assignment failed.')
    } finally {
      setIsAssigning(false)
    }
  }

  // E. Final manager decision
  const handleDecisionSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedCase) return
    setDecisionError(null)

    const trimmedCustomerNotes = customerNotes.trim()
    if (!trimmedCustomerNotes) {
      setDecisionError('Customer-facing decision notes are required for official applicant notification.')
      return
    }

    if (!confirmedBinding) {
      setDecisionError('You must confirm this is a binding final determination.')
      return
    }

    setIsSubmittingDecision(true)
    try {
      const updated = await finalizeManagerKYCDecision(selectedCase.id, {
        action: decisionAction,
        customer_notes: trimmedCustomerNotes,
        internal_notes: internalNotes.trim() || undefined,
      })
      setSelectedCase(updated)
      setIsDecisionModalOpen(false)
      setCustomerNotes('')
      setInternalNotes('')
      setConfirmedBinding(false)
      setActionSuccessMessage(
        `Final determination (${decisionAction.replace(/_/g, ' ').toUpperCase()}) executed successfully.`
      )
      await loadManagerCases()
      await loadCaseReviews(selectedCase.id)
    } catch (err: unknown) {
      setDecisionError(err instanceof Error ? err.message : 'Failed to issue final determination.')
    } finally {
      setIsSubmittingDecision(false)
    }
  }

  // F. Archive completed submission
  const handleArchiveSubmit = async () => {
    if (!selectedCase) return
    setArchiveError(null)
    setIsArchiving(true)

    try {
      await archiveKYCSubmission(selectedCase.id)
      setIsArchiveModalOpen(false)
      setSelectedCase(null)
      setActionSuccessMessage('Dossier archived successfully. All historical logs remain immutably preserved.')
      await loadManagerCases()
    } catch (err: unknown) {
      setArchiveError(err instanceof Error ? err.message : 'Failed to archive dossier.')
    } finally {
      setIsArchiving(false)
    }
  }

  // Unauthenticated guard
  if (!user) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center max-w-xl mx-auto shadow-xs">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
          <KYCIcon className="w-6 h-6" />
        </div>
        <h3 className="mt-4 text-base font-bold text-slate-900">Authentication Required</h3>
        <p className="mt-1.5 text-xs text-slate-600 leading-5">
          Please sign in with a Bank Manager account to supervise compliance workloads, assign verification officers, and render final binding decisions.
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

  // Role authorization guard
  if (!isBankManager) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-900 max-w-xl mx-auto shadow-xs">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
          <AlertIcon className="w-5 h-5" />
        </div>
        <h3 className="mt-3 text-base font-bold">Bank Management Console Restricted</h3>
        <p className="mt-1 text-xs text-amber-700">
          This portal is reserved strictly for authorized Bank Managers. Your current role is <strong>{user.role}</strong>. Please use your authorized navigation section in the sidebar.
        </p>
      </div>
    )
  }

  // Overview metrics derived from live cases
  const totalCount = cases.length
  // Unassigned: submitted with no employee assigned
  const unassignedCount = cases.filter((c) => !c.assigned_employee_id && c.status === 'submitted').length
  // Assigned and awaiting employee: submitted WITH employee assigned (not yet under review)
  const assignedSubmittedCount = cases.filter((c) => !!c.assigned_employee_id && c.status === 'submitted').length
  const underReviewCount = cases.filter((c) => c.status === 'under_employee_review').length
  const pendingDecisionCount = cases.filter((c) => c.status === 'pending_manager_decision').length
  const correctionCount = cases.filter((c) => c.status === 'correction_requested').length
  const finalizedCount = cases.filter((c) => ['approved', 'rejected'].includes(c.status)).length

  // Verify sum equals total (all statuses accounted for)
  // unassigned + assignedSubmitted + underReview + pendingDecision + correction + finalized = totalCount
  // Any remainder = unexpected status (legacy/unknown)
  const knownStatusCount = unassignedCount + assignedSubmittedCount + underReviewCount + pendingDecisionCount + correctionCount + finalizedCount
  const otherCount = totalCount - knownStatusCount

  // Filtered cases
  const filteredCases = cases.filter((c) => {
    if (statusFilter === 'unassigned' && (c.assigned_employee_id || c.status !== 'submitted')) return false
    if (statusFilter === 'submitted' && c.status !== 'submitted') return false
    if (statusFilter === 'under_employee_review' && c.status !== 'under_employee_review') return false
    if (statusFilter === 'pending_manager_decision' && c.status !== 'pending_manager_decision') return false
    // Finalized: approved, rejected, correction_requested (closed/terminal or correction loop)
    if (statusFilter === 'finalized' && !['approved', 'rejected', 'correction_requested'].includes(c.status)) return false

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      const matchRef = c.submission_ref.toLowerCase().includes(q)
      const matchDoc = (c.current_version?.document_type || '').toLowerCase().includes(q)
      const matchCust = c.customer_id ? String(c.customer_id).includes(q) : false
      const matchEmp = c.assigned_employee_id ? String(c.assigned_employee_id).includes(q) : false
      return matchRef || matchDoc || matchCust || matchEmp
    }
    return true
  })

  return (
    <div className="space-y-6">
      {/* Overview Header & Actions */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-slate-900">KYC Case Management Console</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Bank-wide Compliance Oversight · Assign review officers, inspect audit trails, and issue binding final decisions
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadManagerCases}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
          >
            <RefreshIcon className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh All
          </button>
          <span className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800">
            Manager: #{user.id} ({user.username})
          </span>
        </div>
      </div>

      {/* Global Error Banner */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={loadManagerCases} className="font-bold underline hover:text-rose-950">
            Retry
          </button>
        </div>
      )}

      {/* A. Manager Overview Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Cases</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{isLoading ? '...' : totalCount}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">Bank-wide registry</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Unassigned</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-rose-600">{isLoading ? '...' : unassignedCount}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">Awaiting officer allocation</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Assigned / Under Review</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-amber-600">{isLoading ? '...' : underReviewCount + assignedSubmittedCount}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">Assigned to an officer or under examination</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Pending Decision</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-indigo-700">{isLoading ? '...' : pendingDecisionCount}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">Awaiting manager action</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Correction Active</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-orange-600">{isLoading ? '...' : correctionCount}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">Applicant revisions pending</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Determinations</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-emerald-700">{isLoading ? '...' : finalizedCount}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">Approved or rejected</p>
        </article>
        {!isLoading && otherCount > 0 && (
          <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-xs xl:col-span-6">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
              Unclassified Cases: {otherCount}
            </p>
            <p className="mt-0.5 text-[10px] text-amber-600">
              Cases with status values not covered by the standard categories above. Check database for unexpected statuses.
            </p>
          </article>
        )}
      </section>

      {/* Main Layout: Case Explorer & Detail Inspector */}
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* B. Bank-Wide Case Explorer Table */}
        <div className={`space-y-4 ${selectedCase ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
            {/* Filter Tabs & Search */}
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    statusFilter === 'all'
                      ? 'bg-indigo-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  All ({totalCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('unassigned')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    statusFilter === 'unassigned'
                      ? 'bg-rose-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Unassigned ({unassignedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('pending_manager_decision')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    statusFilter === 'pending_manager_decision'
                      ? 'bg-indigo-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Pending Action ({pendingDecisionCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('finalized')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    statusFilter === 'finalized'
                      ? 'bg-indigo-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Resolved ({finalizedCount})
                </button>
              </div>

              <div className="w-full sm:w-56">
                <input
                  type="text"
                  placeholder="Search ref, doc, customer, officer..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-hidden"
                />
              </div>
            </div>

            {/* Cases Table */}
            <div className="overflow-x-auto">
              {isLoading && cases.length === 0 ? (
                <div className="py-16 text-center text-xs text-slate-500">
                  <RefreshIcon className="w-5 h-5 mx-auto mb-2 animate-spin text-indigo-600" />
                  Loading bank-wide cases...
                </div>
              ) : filteredCases.length === 0 ? (
                <div className="py-16 text-center text-slate-500">
                  <p className="text-sm font-semibold text-slate-700">No Cases Found</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {searchQuery || statusFilter !== 'all'
                      ? 'No cases match your active search or filter criteria.'
                      : 'There are currently no registered KYC submissions in the bank database.'}
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="pb-3 pr-2">Ref</th>
                      <th className="pb-3 pr-2">Doc Type</th>
                      <th className="pb-3 pr-2">Applicant</th>
                      <th className="pb-3 pr-2">Assigned Officer</th>
                      <th className="pb-3 pr-2">Status</th>
                      <th className="pb-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCases.map((c) => {
                      const isSelected = selectedCase?.id === c.id
                      return (
                        <tr
                          key={c.id}
                          onClick={() => handleSelectCase(c)}
                          className={`cursor-pointer transition ${
                            isSelected ? 'bg-indigo-50/70' : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <td className="py-3 pr-2 font-mono text-xs font-bold text-slate-900">
                            {c.submission_ref}
                          </td>
                          <td className="py-3 pr-2 text-xs text-slate-700 font-medium">
                            {c.current_version?.document_type || 'Identity Dossier'}
                            <span className="ml-1 text-[10px] text-slate-400 font-mono">
                              v{c.current_version?.version_number ?? 1}
                            </span>
                          </td>
                          <td className="py-3 pr-2 text-xs text-slate-600">
                            {c.customer_id ? `Customer #${c.customer_id}` : 'Applicant'}
                          </td>
                          <td className="py-3 pr-2 text-xs">
                            {c.assigned_employee_id ? (
                              <span className="font-semibold text-slate-800">
                                Officer #{c.assigned_employee_id}
                              </span>
                            ) : (
                              <span className="inline-flex rounded-sm bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 uppercase">
                                Unassigned
                              </span>
                            )}
                          </td>
                          <td className="py-3 pr-2">
                            <ManagerStatusBadge status={c.status} />
                          </td>
                          <td className="py-3 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSelectCase(c)
                              }}
                              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                                isSelected
                                  ? 'bg-indigo-600 text-white'
                                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* C, D, E, F. Case Details, History, Assignment & Decision Inspector */}
        {selectedCase && (
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
              {/* Header */}
              <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Management Dossier Inspector
                  </span>
                  <div className="flex items-center gap-2">
                    <h4 className="font-mono text-base font-bold text-slate-900">
                      {selectedCase.submission_ref}
                    </h4>
                    {isLoadingDetail && (
                      <RefreshIcon className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    ID #{selectedCase.id} · Registered: {new Date(selectedCase.created_at).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCase(null)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                  title="Close inspector"
                >
                  ✕
                </button>
              </div>

              {/* Action Banner */}
              {actionSuccessMessage && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
                  {actionSuccessMessage}
                </div>
              )}
              {actionErrorMessage && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800">
                  {actionErrorMessage}
                </div>
              )}

              {/* Status and Primary Management Controls */}
              <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-slate-400">Current Status</span>
                    <div className="mt-1">
                      <ManagerStatusBadge status={selectedCase.status} />
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] uppercase font-semibold text-slate-400">Assigned Officer</span>
                    <div className="text-xs font-bold text-slate-800 mt-1">
                      {selectedCase.assigned_employee_id
                        ? `Officer #${selectedCase.assigned_employee_id}`
                        : 'Unassigned'}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/60">
                  {/* D. Assign/Reassign Action */}
                  <button
                    type="button"
                    onClick={() => {
                      setAssignError(null)
                      setTargetEmployeeId(selectedCase.assigned_employee_id ? String(selectedCase.assigned_employee_id) : '')
                      setIsAssignModalOpen(true)
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-xs"
                  >
                    {selectedCase.assigned_employee_id ? 'Reassign Officer' : 'Assign Officer'}
                  </button>

                  {/* E. Issue Final Decision Action */}
                  {!['approved', 'rejected'].includes(selectedCase.status) && (
                    <button
                      type="button"
                      onClick={() => {
                        setDecisionError(null)
                        setConfirmedBinding(false)
                        setIsDecisionModalOpen(true)
                      }}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 transition"
                    >
                      Issue Final Decision
                    </button>
                  )}

                  {/* F. Archive Action */}
                  {!selectedCase.is_archived && (
                    <button
                      type="button"
                      onClick={() => {
                        setArchiveError(null)
                        setIsArchiveModalOpen(true)
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition"
                      title="Archive completed or closed dossier"
                    >
                      Archive Dossier
                    </button>
                  )}
                </div>
              </div>

              {/* C. Current Version and Automated Screening */}
              <div className="space-y-2">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Active Document Version
                </h5>
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Version:</span>
                    <span className="font-mono font-bold text-slate-900">
                      v{selectedCase.current_version?.version_number ?? 1} (Active)
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Document Classification:</span>
                    <span className="font-semibold text-slate-800">
                      {selectedCase.current_version?.document_type || 'Identity Dossier'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Automated Screening:</span>
                    <AutoValidationBadge
                      status={selectedCase.current_version?.auto_validation_status || 'unassessed'}
                    />
                  </div>
                  <div className="border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                    Version registered: {selectedCase.current_version?.created_at
                      ? new Date(selectedCase.current_version.created_at).toLocaleString()
                      : '—'}
                  </div>
                </div>
              </div>

              {/* C. Complete Review History (Full Staff Trail) */}
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Comprehensive Review History
                  </h5>
                  <span className="text-[10px] text-indigo-700 font-bold uppercase tracking-wider">
                    Staff Restricted
                  </span>
                </div>

                {isLoadingReviews ? (
                  <div className="p-4 text-center text-xs text-slate-500">
                    <RefreshIcon className="w-4 h-4 mx-auto mb-1 animate-spin text-indigo-600" />
                    Retrieving review logs...
                  </div>
                ) : reviewsError ? (
                  <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-500">
                    {reviewsError}
                  </div>
                ) : reviews.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-center text-xs text-slate-500">
                    No compliance recommendations or decisions recorded on this dossier yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reviews.map((rev) => (
                      <div
                        key={rev.id}
                        className={`rounded-xl border p-3.5 space-y-2 text-xs ${
                          rev.reviewer_role === 'bank_manager'
                            ? 'border-indigo-200 bg-indigo-50/40'
                            : 'border-slate-200 bg-slate-50/70'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900">
                              {rev.reviewer_role === 'bank_manager' ? 'Bank Manager Decision' : 'Officer Recommendation'}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              (Officer #{rev.reviewer_id})
                            </span>
                          </div>
                          <span
                            className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                              rev.action.includes('approve')
                                ? 'bg-emerald-100 text-emerald-800'
                                : rev.action.includes('reject')
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-orange-100 text-orange-800'
                            }`}
                          >
                            {rev.action.replace(/_/g, ' ')}
                          </span>
                        </div>

                        {/* Customer Notes */}
                        {rev.customer_notes && (
                          <div className="rounded-lg bg-blue-50/70 p-2.5 border border-blue-100">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 block mb-0.5">
                              Applicant Notice (Customer Visible):
                            </span>
                            <p className="text-blue-900 text-xs leading-relaxed">
                              {rev.customer_notes}
                            </p>
                          </div>
                        )}

                        {/* Internal Notes */}
                        {rev.internal_notes && (
                          <div className="rounded-lg bg-white p-2.5 border border-slate-200/80">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                              Confidential Internal Notes (Staff Only):
                            </span>
                            <p className="text-slate-800 text-xs leading-relaxed font-mono whitespace-pre-wrap">
                              {rev.internal_notes}
                            </p>
                          </div>
                        )}

                        <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-200/50">
                          Recorded: {new Date(rev.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Confidentiality notice */}
                <div className="flex items-start gap-2 rounded-lg bg-slate-100/90 p-2.5 text-[11px] text-slate-600">
                  <CpuChipIcon className="w-4 h-4 text-indigo-700 shrink-0 mt-0.5" />
                  <span>
                    <strong>Confidential Banking Log:</strong> Assessment deliberations and internal risk rationale are accessible only to authorized Bank Employees and Managers. They are excluded from customer-facing views.
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* D. Employee Assignment Modal */}
      {isAssignModalOpen && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Assign Case to Officer</h3>
                <p className="text-xs text-slate-500">Case Ref: {selectedCase.submission_ref}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAssignModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAssignSubmit} className="mt-4 space-y-4">
              {assignError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-medium">
                  {assignError}
                </div>
              )}

              <div>
                <label htmlFor="officerId" className="block text-xs font-semibold text-slate-700">
                  Compliance Officer User ID <span className="text-rose-500">*</span>
                </label>
                <input
                  id="officerId"
                  type="number"
                  min="1"
                  step="1"
                  value={targetEmployeeId}
                  onChange={(e) => setTargetEmployeeId(e.target.value)}
                  placeholder="e.g. 2"
                  required
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                />
              </div>

              {/* Architectural Notice: Missing Directory Endpoint */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-[11px] text-amber-900 leading-4">
                <strong>Backend Architecture Notice:</strong> The backend does not expose an employee directory to managers (access to <code>/admin/users</code> is restricted to System Administrators). Please enter the target Officer User ID directly.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAssignModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAssigning}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 transition disabled:opacity-50"
                >
                  {isAssigning ? 'Assigning...' : 'Confirm Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* E. Final Decision Modal */}
      {isDecisionModalOpen && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Issue Final Binding Determination</h3>
                <p className="text-xs text-slate-500">Case Ref: {selectedCase.submission_ref}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsDecisionModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleDecisionSubmit} className="mt-4 space-y-4">
              {decisionError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-medium">
                  {decisionError}
                </div>
              )}

              {/* Action Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Manager Determination Action
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setDecisionAction('approve')}
                    className={`rounded-xl border p-2.5 text-center text-xs font-semibold transition ${
                      decisionAction === 'approve'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-200'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Approve Application
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecisionAction('manager_request_correction')}
                    className={`rounded-xl border p-2.5 text-center text-xs font-semibold transition ${
                      decisionAction === 'manager_request_correction'
                        ? 'border-orange-500 bg-orange-50 text-orange-800 ring-2 ring-orange-200'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Request Correction
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecisionAction('reject')}
                    className={`rounded-xl border p-2.5 text-center text-xs font-semibold transition ${
                      decisionAction === 'reject'
                        ? 'border-rose-500 bg-rose-50 text-rose-800 ring-2 ring-rose-200'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Reject Application
                  </button>
                </div>
              </div>

              {/* Customer Notes (Required) */}
              <div>
                <label htmlFor="customerNotes" className="block text-xs font-semibold text-slate-700">
                  Official Notice to Applicant <span className="text-rose-500">*</span>
                </label>
                <p className="text-[11px] text-slate-500 mb-1.5">
                  Visible to the customer on their decision receipt and status dashboard.
                </p>
                <textarea
                  id="customerNotes"
                  rows={3}
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                  placeholder="Official notification regarding verification disposition, approval confirmation, or required corrective document updates..."
                  required
                  className="w-full rounded-xl border border-slate-200 p-3 text-xs text-slate-900 focus:border-indigo-600 focus:outline-hidden leading-relaxed"
                />
              </div>

              {/* Internal Notes (Optional) */}
              <div>
                <label htmlFor="managerInternalNotes" className="block text-xs font-semibold text-slate-700">
                  Confidential Management Audit Notes (Optional)
                </label>
                <p className="text-[11px] text-slate-500 mb-1.5">
                  Internal compliance and supervisory log. Strictly isolated to Bank Staff.
                </p>
                <textarea
                  id="managerInternalNotes"
                  rows={2}
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  placeholder="Record internal supervisory rationale or compliance sign-off notes..."
                  className="w-full rounded-xl border border-slate-200 p-3 text-xs text-slate-900 focus:border-indigo-600 focus:outline-hidden leading-relaxed"
                />
              </div>

              {/* Confirmation Checkbox */}
              <div className="flex items-start gap-2 pt-1">
                <input
                  id="bindingConfirm"
                  type="checkbox"
                  checked={confirmedBinding}
                  onChange={(e) => setConfirmedBinding(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="bindingConfirm" className="text-xs text-slate-700 font-medium">
                  I confirm that this is an official binding determination rendered under bank compliance authority.
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsDecisionModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingDecision || !confirmedBinding}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 transition disabled:opacity-50"
                >
                  {isSubmittingDecision ? 'Executing...' : 'Execute Determination'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* F. Archive Confirmation Modal */}
      {isArchiveModalOpen && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-100">
            <h3 className="text-base font-bold text-slate-900">Archive KYC Dossier</h3>
            <p className="mt-2 text-xs text-slate-600 leading-relaxed">
              Are you sure you want to archive dossier <strong>{selectedCase.submission_ref}</strong>?
            </p>
            <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-[11px] text-blue-900 leading-relaxed">
              Archiving removes this application from active operational queues. Historical versions, review deliberations, and audit trails remain permanently and immutably preserved in compliance with data retention requirements.
            </div>

            {archiveError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                {archiveError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setIsArchiveModalOpen(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleArchiveSubmit}
                disabled={isArchiving}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 transition disabled:opacity-50"
              >
                {isArchiving ? 'Archiving...' : 'Confirm Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ----------------- Supporting Components -----------------

function ManagerStatusBadge({ status }: { status: KYCSubmissionStatus | string }) {
  switch (status) {
    case 'submitted':
      return (
        <span className="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
          Submitted
        </span>
      )
    case 'under_employee_review':
      return (
        <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
          In Officer Review
        </span>
      )
    case 'pending_manager_decision':
      return (
        <span className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
          Pending Manager
        </span>
      )
    case 'approved':
      return (
        <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
          Approved
        </span>
      )
    case 'rejected':
      return (
        <span className="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
          Rejected
        </span>
      )
    case 'correction_requested':
      return (
        <span className="inline-flex items-center rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-700">
          Correction Requested
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {status.replace(/_/g, ' ')}
        </span>
      )
  }
}

function AutoValidationBadge({ status }: { status: KYCAutoValidationStatus | string }) {
  switch (status) {
    case 'passed':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
          <CheckCircleIcon className="w-3.5 h-3.5" /> Passed
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700">
          <AlertIcon className="w-3.5 h-3.5" /> Failed
        </span>
      )
    case 'warning':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700">
          <AlertIcon className="w-3.5 h-3.5" /> Warning
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
          <ClockIcon className="w-3.5 h-3.5" /> Unassessed
        </span>
      )
  }
}
