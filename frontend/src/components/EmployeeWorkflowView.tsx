import { useEffect, useState, type FC, type FormEvent } from 'react'
import type {
  KYCAutoValidationStatus,
  KYCEmployeeAction,
  KYCReviewResponse,
  KYCSubmissionResponse,
  KYCSubmissionStatus,
  UserRole,
} from '../types'
import {
  fetchAssignedKYCCases,
  fetchKYCSubmissionDetail,
  fetchKYCSubmissionReviews,
  startEmployeeKYCReview,
  submitEmployeeKYCRecommendation,
} from '../api'
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  CpuChipIcon,
  KYCIcon,
  RefreshIcon,
} from './Icons'

interface EmployeeWorkflowViewProps {
  user: { id: number; username: string; role: UserRole } | null
  onOpenAuth: () => void
}

export const EmployeeWorkflowView: FC<EmployeeWorkflowViewProps> = ({ user, onOpenAuth }) => {
  const [assignedCases, setAssignedCases] = useState<KYCSubmissionResponse[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filtering and search - defaults to active queue (approved/rejected strictly excluded)
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | 'submitted' | 'under_employee_review' | 'completed'>('active')
  const [searchQuery, setSearchQuery] = useState('')

  // Selected case and inspector state
  const [selectedCase, setSelectedCase] = useState<KYCSubmissionResponse | null>(null)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [reviews, setReviews] = useState<KYCReviewResponse[]>([])
  const [isLoadingReviews, setIsLoadingReviews] = useState(false)
  const [reviewsError, setReviewsError] = useState<string | null>(null)

  // Action states
  const [isStartingReview, setIsStartingReview] = useState(false)
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null)
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null)

  // Recommendation form state
  const [isRecModalOpen, setIsRecModalOpen] = useState(false)
  const [recommendAction, setRecommendAction] = useState<KYCEmployeeAction>('recommend_approve')
  const [internalNotes, setInternalNotes] = useState('')
  const [isSubmittingRec, setIsSubmittingRec] = useState(false)
  const [recError, setRecError] = useState<string | null>(null)

  const isBankEmployee = user?.role === 'bank_employee'

  const loadAssignedCases = async () => {
    if (!user || !isBankEmployee) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchAssignedKYCCases()
      setAssignedCases(data)
      if (selectedCase) {
        const updated = data.find((c) => c.id === selectedCase.id)
        if (updated) setSelectedCase(updated)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve assigned cases.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!user || !isBankEmployee) return
    let active = true

    const fetchInitial = async () => {
      setIsLoading(true)
      try {
        const data = await fetchAssignedKYCCases()
        if (!active) return
        setAssignedCases(data)
      } catch (err: unknown) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to retrieve assigned cases.')
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void fetchInitial()
    return () => {
      active = false
    }
  }, [user, isBankEmployee])

  // Select a case and load full details + review history
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
            : 'Unable to load previous review log.'
        )
      }
    } finally {
      setIsLoadingDetail(false)
    }
  }

  // Reload reviews for current case
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

  // D. Start review action
  const handleStartReview = async () => {
    if (!selectedCase) return
    setIsStartingReview(true)
    setActionErrorMessage(null)
    setActionSuccessMessage(null)

    try {
      const updated = await startEmployeeKYCReview(selectedCase.id)
      setSelectedCase(updated)
      setActionSuccessMessage('Review started. Case is now marked as Under Employee Review.')
      await loadAssignedCases()
      await loadCaseReviews(selectedCase.id)
    } catch (err: unknown) {
      setActionErrorMessage(err instanceof Error ? err.message : 'Failed to start review.')
    } finally {
      setIsStartingReview(false)
    }
  }

  // E. Submit employee recommendation
  const handleSubmitRecommendation = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedCase) return
    setRecError(null)

    const trimmedNotes = internalNotes.trim()
    if (!trimmedNotes) {
      setRecError('Confidential internal notes are required to substantiate your recommendation.')
      return
    }

    setIsSubmittingRec(true)
    try {
      const updated = await submitEmployeeKYCRecommendation(selectedCase.id, {
        action: recommendAction,
        internal_notes: trimmedNotes,
      })
      setSelectedCase(updated)
      setIsRecModalOpen(false)
      setInternalNotes('')
      setActionSuccessMessage(
        'Recommendation submitted successfully. Case advanced to Management for final determination.'
      )
      await loadAssignedCases()
      await loadCaseReviews(selectedCase.id)
    } catch (err: unknown) {
      setRecError(err instanceof Error ? err.message : 'Failed to record recommendation.')
    } finally {
      setIsSubmittingRec(false)
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
          Please sign in with a Bank Employee account to inspect assigned KYC applications and perform compliance evaluations.
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
  if (!isBankEmployee) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-900 max-w-xl mx-auto shadow-xs">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
          <AlertIcon className="w-5 h-5" />
        </div>
        <h3 className="mt-3 text-base font-bold">Bank Employee Portal Restricted</h3>
        <p className="mt-1 text-xs text-amber-700">
          This workspace is strictly reserved for assigned Bank Compliance Employees. Your current role is <strong>{user.role}</strong>. Please use your authorized module in the sidebar.
        </p>
      </div>
    )
  }

  // Active queue: cases the employee can still act on
  const ACTIVE_STATUSES = ['submitted', 'under_employee_review']
  // Completed history: recommendations submitted; cases are with manager or finalized
  const COMPLETED_STATUSES = ['pending_manager_decision', 'approved', 'rejected', 'correction_requested']

  // Overview metrics derived from actual backend data
  const activeQueueCount = assignedCases.filter((c) => ACTIVE_STATUSES.includes(c.status)).length
  const awaitingReviewCount = assignedCases.filter((c) => c.status === 'submitted').length
  const underReviewCount = assignedCases.filter((c) => c.status === 'under_employee_review').length
  const recommendedCount = assignedCases.filter((c) => COMPLETED_STATUSES.includes(c.status)).length
  const totalAssigned = assignedCases.length

  // Filtered cases: 'active' filter strictly excludes approved, rejected, and completed cases
  const filteredCases = assignedCases.filter((c) => {
    if (statusFilter === 'active' && !ACTIVE_STATUSES.includes(c.status)) return false
    if (statusFilter === 'submitted' && c.status !== 'submitted') return false
    if (statusFilter === 'under_employee_review' && c.status !== 'under_employee_review') return false
    // 'completed' tab shows cases where employee recommendation is done (not in active queue)
    if (statusFilter === 'completed' && ACTIVE_STATUSES.includes(c.status)) return false

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      const matchRef = c.submission_ref.toLowerCase().includes(q)
      const matchDoc = (c.current_version?.document_type || '').toLowerCase().includes(q)
      const matchCust = c.customer_id ? String(c.customer_id).includes(q) : false
      return matchRef || matchDoc || matchCust
    }
    return true
  })

  return (
    <div className="space-y-6">
      {/* Overview Header & Actions */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-slate-900">Assigned KYC Review Cases</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Compliance Officer Workbench Â· Examine customer identity dossiers and submit assessment recommendations
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadAssignedCases}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
          >
            <RefreshIcon className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh Cases
          </button>
          <span className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800">
            Officer ID: #{user.id} ({user.username})
          </span>
        </div>
      </div>

      {/* Global Error Banner */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={loadAssignedCases} className="font-bold underline hover:text-rose-950">
            Retry
          </button>
        </div>
      )}

      {/* A. Employee Overview Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Assigned
            </p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700 font-bold text-xs">
              ALL
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            {isLoading ? '...' : totalAssigned}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">All cases ever assigned to this officer</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Active Queue
            </p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
              <ClockIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-sky-700">
            {isLoading ? '...' : activeQueueCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Cases awaiting or in review (action required)</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Currently Under Review
            </p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <AlertIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-amber-700">
            {isLoading ? '...' : underReviewCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Active evaluation in progress</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Recommendations History
            </p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <CheckCircleIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            {isLoading ? '...' : recommendedCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Completed â€” escalated to Bank Manager</p>
        </article>
      </section>

      {/* Main Layout: Case List & Detail Inspector */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* B. Assigned Cases Table */}
        <div className={`space-y-4 ${selectedCase ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
            {/* Table Filters & Search */}
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setStatusFilter('active')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    statusFilter === 'active'
                      ? 'bg-sky-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Active Queue ({activeQueueCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    statusFilter === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  All ({totalAssigned})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('submitted')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    statusFilter === 'submitted'
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Awaiting ({awaitingReviewCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('under_employee_review')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    statusFilter === 'under_employee_review'
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  In Review ({underReviewCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('completed')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    statusFilter === 'completed'
                      ? 'bg-emerald-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  History ({recommendedCount})
                </button>
              </div>

              <div className="w-full sm:w-56">
                <input
                  type="text"
                  placeholder="Filter by ref, doc, customer..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-hidden"
                />
              </div>
            </div>

            {/* Cases Table */}
            <div className="overflow-x-auto">
              {isLoading && assignedCases.length === 0 ? (
                <div className="py-16 text-center text-xs text-slate-500">
                  <RefreshIcon className="w-5 h-5 mx-auto mb-2 animate-spin text-blue-600" />
                  Loading assigned cases...
                </div>
              ) : filteredCases.length === 0 ? (
                <div className="py-16 text-center text-slate-500">
                  <p className="text-sm font-semibold text-slate-700">No Assigned Cases Found</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {searchQuery || statusFilter !== 'all'
                      ? 'No cases match your active filter.'
                      : 'There are currently no KYC verification cases assigned to your officer account.'}
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="pb-3 pr-3">Submission Ref</th>
                      <th className="pb-3 pr-3">Applicant</th>
                      <th className="pb-3 pr-3">Doc Type</th>
                      <th className="pb-3 pr-3">Ver</th>
                      <th className="pb-3 pr-3">Status</th>
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
                            isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <td className="py-3 pr-3 font-mono text-xs font-bold text-slate-900">
                            {c.submission_ref}
                          </td>
                          <td className="py-3 pr-3 text-xs text-slate-600">
                            {c.customer_id ? `Customer #${c.customer_id}` : 'Applicant'}
                          </td>
                          <td className="py-3 pr-3 text-xs text-slate-700 font-medium">
                            {c.current_version?.document_type || 'Identity Dossier'}
                          </td>
                          <td className="py-3 pr-3 font-mono text-xs text-slate-600">
                            v{c.current_version?.version_number ?? 1}
                          </td>
                          <td className="py-3 pr-3">
                            <EmployeeStatusBadge status={c.status} />
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
                                  ? 'bg-blue-600 text-white'
                                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              Examine
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

        {/* C, D, E, F. Case Examination & Recommendation Inspector */}
        {selectedCase && (
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
              {/* Header */}
              <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Case Dossier Inspector
                  </span>
                  <div className="flex items-center gap-2">
                    <h4 className="font-mono text-base font-bold text-slate-900">
                      {selectedCase.submission_ref}
                    </h4>
                    {isLoadingDetail && (
                      <RefreshIcon className="w-3.5 h-3.5 animate-spin text-blue-600" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Assigned: Officer #{selectedCase.assigned_employee_id} Â· Registered: {new Date(selectedCase.created_at).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCase(null)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                  title="Close inspector"
                >
                  âœ•
                </button>
              </div>

              {/* Action Notifications */}
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

              {/* Status and Action Buttons */}
              <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3.5 border border-slate-100 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="text-[10px] uppercase font-semibold text-slate-400">Workflow Stage</span>
                  <div className="mt-1">
                    <EmployeeStatusBadge status={selectedCase.status} />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* D. Start Review Button */}
                  {selectedCase.status === 'submitted' && (
                    <button
                      type="button"
                      onClick={handleStartReview}
                      disabled={isStartingReview}
                      className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition disabled:opacity-50"
                    >
                      {isStartingReview ? 'Initiating...' : 'Start Review'}
                    </button>
                  )}

                  {/* E. Record Recommendation Button */}
                  {(selectedCase.status === 'submitted' || selectedCase.status === 'under_employee_review') && (
                    <button
                      type="button"
                      onClick={() => {
                        setRecError(null)
                        setIsRecModalOpen(true)
                      }}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 transition"
                    >
                      Submit Recommendation
                    </button>
                  )}
                </div>
              </div>

              {/* F. Case Post-Recommendation State Notice */}
              {['pending_manager_decision', 'approved', 'rejected', 'correction_requested'].includes(
                selectedCase.status
              ) && (
                <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3.5 text-xs text-blue-900 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <CheckCircleIcon className="w-4 h-4 text-blue-700" />
                    <span>Officer Recommendation Routed</span>
                  </div>
                  <p className="text-[11px] text-blue-800 leading-relaxed">
                    This dossier has completed officer-level review and is pending or finalized by Bank Management. Binding decisions are exclusively issued by Bank Managers.
                  </p>
                </div>
              )}

              {/* C. Current Document Version & Validation Details */}
              <div className="space-y-2">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Dossier Document Version
                </h5>
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Version:</span>
                    <span className="font-mono font-bold text-slate-900">
                      v{selectedCase.current_version?.version_number ?? 1} (Active)
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Document Type:</span>
                    <span className="font-semibold text-slate-800">
                      {selectedCase.current_version?.document_type || 'Identity Dossier'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Machine Validation:</span>
                    <AutoValidationBadge
                      status={selectedCase.current_version?.auto_validation_status || 'unassessed'}
                    />
                  </div>
                  <div className="border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                    Registered: {selectedCase.current_version?.created_at
                      ? new Date(selectedCase.current_version.created_at).toLocaleString()
                      : 'â€”'}
                  </div>
                </div>
              </div>

              {/* C. Review History Log (Internal Notes Visible to Staff) */}
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Compliance Review History
                  </h5>
                  <span className="text-[10px] text-indigo-700 font-bold uppercase tracking-wider">
                    Staff Restricted
                  </span>
                </div>

                {isLoadingReviews ? (
                  <div className="p-4 text-center text-xs text-slate-500">
                    <RefreshIcon className="w-4 h-4 mx-auto mb-1 animate-spin text-blue-600" />
                    Retrieving review logs...
                  </div>
                ) : reviewsError ? (
                  <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-500">
                    {reviewsError}
                  </div>
                ) : reviews.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-center text-xs text-slate-500">
                    No compliance reviews recorded for this dossier yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reviews.map((rev) => (
                      <div
                        key={rev.id}
                        className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">
                              {rev.reviewer_role === 'bank_manager' ? 'Bank Manager' : 'Bank Employee'}
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

                        {/* Confidential Internal Notes */}
                        {rev.internal_notes && (
                          <div className="rounded-lg bg-white p-2.5 border border-slate-200/80">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                              Confidential Assessment Notes (Staff Only)
                            </span>
                            <p className="text-slate-800 text-xs leading-relaxed font-mono whitespace-pre-wrap">
                              {rev.internal_notes}
                            </p>
                          </div>
                        )}

                        {/* Customer-Facing Notes (if manager entered them) */}
                        {rev.customer_notes && (
                          <div className="rounded-lg bg-blue-50/60 p-2 border border-blue-100">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 block mb-0.5">
                              Customer Notice Attached:
                            </span>
                            <p className="text-blue-900 text-xs leading-relaxed">
                              {rev.customer_notes}
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

                {/* Confidentiality Notice */}
                <div className="flex items-start gap-2 rounded-lg bg-slate-100/90 p-2.5 text-[11px] text-slate-600">
                  <CpuChipIcon className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                  <span>
                    <strong>Confidential Banking Log:</strong> Assessment deliberations and internal risk rationale are accessible only to authorized Bank Employees and Managers. They are excluded from customer-facing decision views.
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* E. Recommendation Submission Modal */}
      {isRecModalOpen && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Record Employee Recommendation</h3>
                <p className="text-xs text-slate-500">Case Ref: {selectedCase.submission_ref}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsRecModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                âœ•
              </button>
            </div>

            <form onSubmit={handleSubmitRecommendation} className="mt-4 space-y-4">
              {recError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-medium">
                  {recError}
                </div>
              )}

              {/* Action Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Compliance Recommendation
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setRecommendAction('recommend_approve')}
                    className={`rounded-xl border p-2.5 text-center text-xs font-semibold transition ${
                      recommendAction === 'recommend_approve'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-200'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Recommend Approval
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecommendAction('request_correction')}
                    className={`rounded-xl border p-2.5 text-center text-xs font-semibold transition ${
                      recommendAction === 'request_correction'
                        ? 'border-orange-500 bg-orange-50 text-orange-800 ring-2 ring-orange-200'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Request Correction
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecommendAction('recommend_reject')}
                    className={`rounded-xl border p-2.5 text-center text-xs font-semibold transition ${
                      recommendAction === 'recommend_reject'
                        ? 'border-rose-500 bg-rose-50 text-rose-800 ring-2 ring-rose-200'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Recommend Rejection
                  </button>
                </div>
              </div>

              {/* Internal Notes Input */}
              <div>
                <label htmlFor="internalNotes" className="block text-xs font-semibold text-slate-700">
                  Confidential Internal Notes <span className="text-rose-500">*</span>
                </label>
                <p className="text-[11px] text-slate-500 mb-1.5">
                  Detailed compliance rationale visible exclusively to Bank Employees and Managers.
                </p>
                <textarea
                  id="internalNotes"
                  rows={4}
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  placeholder="Record your compliance assessment, document checks performed, risk flags, or justification for recommended action..."
                  required
                  className="w-full rounded-xl border border-slate-200 p-3 text-xs text-slate-900 focus:border-blue-600 focus:outline-hidden leading-relaxed"
                />
              </div>

              {/* Backend Scope Transparency Notice */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 space-y-1">
                <div className="font-semibold text-slate-800">Workflow Boundary Notice:</div>
                <p>
                  Employee recommendations route the dossier to a Bank Manager for final binding determination. Direct customer-facing messages can only be issued by Bank Managers upon final disposition.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsRecModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRec}
                  className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition disabled:opacity-50"
                >
                  {isSubmittingRec ? 'Submitting...' : 'Confirm & Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ----------------- Helper Components -----------------

function EmployeeStatusBadge({ status }: { status: KYCSubmissionStatus | string }) {
  switch (status) {
    case 'submitted':
      return (
        <span className="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
          Awaiting Review
        </span>
      )
    case 'under_employee_review':
      return (
        <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
          Under Review
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
