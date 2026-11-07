import { useEffect, useState, type FC, type FormEvent } from 'react'
import type {
  KYCAutoValidationStatus,
  KYCDecisionResponse,
  KYCSubmissionResponse,
  KYCSubmissionStatus,
  UserRole,
} from '../types'
import {
  createKYCSubmission,
  createKYCVersion,
  fetchCustomerKYCDecision,
  fetchMyKYCSubmissions,
  fetchKYCSubmissionDetail,
  resubmitKYCCorrection,
} from '../api'
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  CpuChipIcon,
  KYCIcon,
  PlusIcon,
  RefreshIcon,
} from './Icons'

interface CustomerWorkflowViewProps {
  user: { id: number; username: string; role: UserRole } | null
  onOpenAuth: () => void
}

const DOCUMENT_TYPES = [
  'Passport',
  'National ID Card',
  'Driver\'s License',
  'Proof of Address',
  'Tax Identification Certificate',
]

export const CustomerWorkflowView: FC<CustomerWorkflowViewProps> = ({ user, onOpenAuth }) => {
  const [submissions, setSubmissions] = useState<KYCSubmissionResponse[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Selected submission for detail drawer/panel
  const [selectedSubmission, setSelectedSubmission] = useState<KYCSubmissionResponse | null>(null)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)

  // Decision receipt state for selected submission
  const [decision, setDecision] = useState<KYCDecisionResponse | null>(null)
  const [isLoadingDecision, setIsLoadingDecision] = useState(false)
  const [decisionError, setDecisionError] = useState<string | null>(null)

  // New submission modal state
  const [isNewModalOpen, setIsNewModalOpen] = useState(false)
  const [newRef, setNewRef] = useState('')
  const [newDocType, setNewDocType] = useState(DOCUMENT_TYPES[0])
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Correction & resubmission modal state
  const [isCorrectionModalOpen, setIsCorrectionModalOpen] = useState(false)
  const [correctionDocType, setCorrectionDocType] = useState(DOCUMENT_TYPES[0])
  const [isResubmitting, setIsResubmitting] = useState(false)
  const [correctionError, setCorrectionError] = useState<string | null>(null)

  const isCustomer = user?.role === 'customer' || user?.role === 'user'

  const loadSubmissions = async () => {
    if (!user || !isCustomer) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchMyKYCSubmissions()
      setSubmissions(data)
      if (selectedSubmission) {
        const updated = data.find((s) => s.id === selectedSubmission.id)
        if (updated) setSelectedSubmission(updated)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve your KYC submissions.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!user || !isCustomer) return
    let active = true

    const fetchInitial = async () => {
      setIsLoading(true)
      try {
        const data = await fetchMyKYCSubmissions()
        if (!active) return
        setSubmissions(data)
      } catch (err: unknown) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to retrieve your KYC submissions.')
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void fetchInitial()
    return () => {
      active = false
    }
  }, [user, isCustomer])

  // When a submission is selected, fetch full details and decision (if available)
  const handleSelectSubmission = async (sub: KYCSubmissionResponse) => {
    setSelectedSubmission(sub)
    setIsLoadingDetail(true)
    setDecision(null)
    setDecisionError(null)

    try {
      const detail = await fetchKYCSubmissionDetail(sub.id)
      setSelectedSubmission(detail)

      // If submission has reached a determination or correction request, load customer decision receipt
      if (['approved', 'rejected', 'correction_requested'].includes(detail.status)) {
        setIsLoadingDecision(true)
        try {
          const dec = await fetchCustomerKYCDecision(detail.id)
          setDecision(dec)
        } catch (decErr: unknown) {
          setDecisionError(decErr instanceof Error ? decErr.message : 'No decision receipt available.')
        } finally {
          setIsLoadingDecision(false)
        }
      }
    } catch {
      // Use fallback summary data
    } finally {
      setIsLoadingDetail(false)
    }
  }

  // Generate synthetic reference
  const handleGenerateRef = () => {
    const rand = Math.floor(1000 + Math.random() * 9000)
    setNewRef(`KYC-2026-${rand}`)
    setCreateError(null)
  }

  // Handle new submission creation
  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setCreateError(null)

    const ref = newRef.trim()
    const docType = newDocType.trim()

    if (!ref) {
      setCreateError('Submission reference is required.')
      return
    }
    if (!docType) {
      setCreateError('Document type is required.')
      return
    }

    setIsCreating(true)
    try {
      const created = await createKYCSubmission({
        submission_ref: ref,
        document_type: docType,
      })
      setIsNewModalOpen(false)
      setNewRef('')
      setNewDocType(DOCUMENT_TYPES[0])
      await loadSubmissions()
      setSelectedSubmission(created)
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create KYC application.')
    } finally {
      setIsCreating(false)
    }
  }

  // Handle correction upload and resubmission
  const handleResubmitCorrection = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedSubmission) return
    setCorrectionError(null)

    setIsResubmitting(true)
    try {
      // Step 1: Create next version of document
      await createKYCVersion(selectedSubmission.id, {
        document_type: correctionDocType.trim(),
      })

      // Step 2: Trigger backend resubmission workflow transition
      const updated = await resubmitKYCCorrection(selectedSubmission.id)
      setSelectedSubmission(updated)
      setIsCorrectionModalOpen(false)
      await loadSubmissions()
    } catch (err: unknown) {
      setCorrectionError(err instanceof Error ? err.message : 'Failed to submit corrected document.')
    } finally {
      setIsResubmitting(false)
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
          Please sign in to inspect your confidential KYC verification applications, upload correction documents, or track your verification status.
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
  if (!isCustomer) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-900 max-w-xl mx-auto shadow-xs">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
          <AlertIcon className="w-5 h-5" />
        </div>
        <h3 className="mt-3 text-base font-bold">Customer Portal Restricted</h3>
        <p className="mt-1 text-xs text-amber-700">
          The "My KYC" workflow is dedicated to bank customer applicants. Your current role is <strong>{user.role}</strong>. Please use your designated case management console in the sidebar.
        </p>
      </div>
    )
  }

  // Status metrics
  const totalCount = submissions.length
  const awaitingReviewCount = submissions.filter((s) =>
    ['submitted', 'under_employee_review', 'pending_manager_decision'].includes(s.status)
  ).length
  const correctionCount = submissions.filter((s) => s.status === 'correction_requested').length
  const finalizedCount = submissions.filter((s) =>
    ['approved', 'rejected', 'legacy_verified'].includes(s.status)
  ).length

  return (
    <div className="space-y-6">
      {/* Overview Header & Actions */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-slate-900">My KYC Applications</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Submit, track, and manage your confidential identity verification dossiers
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadSubmissions}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
          >
            <RefreshIcon className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setCreateError(null)
              handleGenerateRef()
              setIsNewModalOpen(true)
            }}
            className="flex items-center gap-1.5 rounded-xl bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            New Application
          </button>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={loadSubmissions} className="font-bold underline hover:text-rose-950">
            Retry
          </button>
        </div>
      )}

      {/* A. Customer Overview Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Submissions
            </p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700 font-bold text-xs">
              ALL
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            {isLoading ? '...' : totalCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">All registered KYC applications</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Awaiting Review
            </p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <ClockIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-amber-700">
            {isLoading ? '...' : awaitingReviewCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Under bank compliance evaluation</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Correction Needed
            </p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-700">
              <AlertIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-orange-700">
            {isLoading ? '...' : correctionCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Applicant action required</p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Final Determinations
            </p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <CheckCircleIcon className="w-4 h-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            {isLoading ? '...' : finalizedCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Approved or rejected applications</p>
        </article>
      </section>

      {/* Main Content Layout: Table & Detail Inspector */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* C. My Submissions Table */}
        <div className={`space-y-4 ${selectedSubmission ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900">Application History</h4>
              <span className="text-xs text-slate-400">Authenticated: {user.username}</span>
            </div>

            <div className="overflow-x-auto">
              {isLoading && submissions.length === 0 ? (
                <div className="py-16 text-center text-xs text-slate-500">
                  <RefreshIcon className="w-5 h-5 mx-auto mb-2 animate-spin text-blue-600" />
                  Loading your KYC records...
                </div>
              ) : submissions.length === 0 ? (
                <div className="py-16 text-center text-slate-500">
                  <p className="text-sm font-semibold text-slate-700">No Applications Found</p>
                  <p className="mt-1 text-xs text-slate-500">
                    You have not submitted any KYC applications yet.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      handleGenerateRef()
                      setIsNewModalOpen(true)
                    }}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition"
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                    Start First Application
                  </button>
                </div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="pb-3 pr-3">Ref</th>
                      <th className="pb-3 pr-3">Doc Type</th>
                      <th className="pb-3 pr-3">Version</th>
                      <th className="pb-3 pr-3">Status</th>
                      <th className="pb-3 pr-3">Submitted</th>
                      <th className="pb-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {submissions.map((sub) => {
                      const isSelected = selectedSubmission?.id === sub.id
                      return (
                        <tr
                          key={sub.id}
                          onClick={() => handleSelectSubmission(sub)}
                          className={`cursor-pointer transition ${
                            isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <td className="py-3 pr-3 font-mono text-xs font-bold text-slate-900">
                            {sub.submission_ref}
                          </td>
                          <td className="py-3 pr-3 text-xs text-slate-700 font-medium">
                            {sub.current_version?.document_type || 'Identity Dossier'}
                          </td>
                          <td className="py-3 pr-3 font-mono text-xs text-slate-600">
                            v{sub.current_version?.version_number ?? 1}
                          </td>
                          <td className="py-3 pr-3">
                            <StatusBadge status={sub.status} />
                          </td>
                          <td className="py-3 pr-3 text-xs text-slate-500">
                            {new Date(sub.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-3 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSelectSubmission(sub)
                              }}
                              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                                isSelected
                                  ? 'bg-blue-600 text-white'
                                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              Details
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

        {/* D, E, F. Submission Details & Decision Inspector */}
        {selectedSubmission && (
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
              {/* Header */}
              <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Application Inspector
                  </span>
                  <div className="flex items-center gap-2">
                    <h4 className="font-mono text-base font-bold text-slate-900">
                      {selectedSubmission.submission_ref}
                    </h4>
                    {isLoadingDetail && (
                      <RefreshIcon className="w-3.5 h-3.5 animate-spin text-blue-600" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Registered: {new Date(selectedSubmission.created_at).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSubmission(null)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                  title="Close inspector"
                >
                  âœ•
                </button>
              </div>

              {/* Status and Action banner */}
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 border border-slate-100">
                <div>
                  <span className="text-[10px] uppercase font-semibold text-slate-400">Current Status</span>
                  <div className="mt-1">
                    <StatusBadge status={selectedSubmission.status} />
                  </div>
                </div>

                {selectedSubmission.status === 'correction_requested' && (
                  <button
                    type="button"
                    onClick={() => {
                      setCorrectionError(null)
                      setCorrectionDocType(selectedSubmission.current_version?.document_type || DOCUMENT_TYPES[0])
                      setIsCorrectionModalOpen(true)
                    }}
                    className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-orange-700 transition"
                  >
                    Upload Correction
                  </button>
                )}
              </div>

              {/* D. Current Version & Automated Pre-screening */}
              <div className="space-y-2">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Current Document Version
                </h5>
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Version Number:</span>
                    <span className="font-mono font-bold text-slate-900">
                      Version {selectedSubmission.current_version?.version_number ?? 1}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Document Type:</span>
                    <span className="font-semibold text-slate-800">
                      {selectedSubmission.current_version?.document_type || 'Identity Dossier'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Automated Validation:</span>
                    <AutoValidationBadge
                      status={selectedSubmission.current_version?.auto_validation_status || 'unassessed'}
                    />
                  </div>
                  <div className="border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                    Registered at: {selectedSubmission.current_version?.created_at
                      ? new Date(selectedSubmission.current_version.created_at).toLocaleString()
                      : 'â€”'}
                  </div>
                </div>
              </div>

              {/* Status Timeline */}
              <div className="space-y-3">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Workflow Lifecycle Timeline
                </h5>
                <WorkflowTimeline status={selectedSubmission.status} />
              </div>

              {/* F. Decision Receipt */}
              {['approved', 'rejected', 'correction_requested'].includes(selectedSubmission.status) && (
                <div className="space-y-2 border-t border-slate-100 pt-4">
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Official Determination Receipt
                    </h5>
                    <span className="text-[10px] text-emerald-700 font-medium">Privacy-Isolated</span>
                  </div>

                  {isLoadingDecision ? (
                    <div className="p-4 text-center text-xs text-slate-500">
                      <RefreshIcon className="w-4 h-4 mx-auto mb-1 animate-spin text-blue-600" />
                      Retrieving formal decision receipt...
                    </div>
                  ) : decision ? (
                    <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">Determination:</span>
                        <span className={`text-xs font-bold uppercase tracking-wider ${
                          decision.action === 'approve'
                            ? 'text-emerald-700'
                            : decision.action === 'reject'
                            ? 'text-rose-700'
                            : 'text-orange-700'
                        }`}>
                          {decision.action.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div className="text-xs">
                        <span className="text-slate-500">Customer Notes:</span>
                        <p className="mt-1 rounded-lg bg-white p-2.5 text-xs text-slate-800 border border-slate-200/60 leading-5">
                          {decision.customer_notes || 'No customer remarks attached.'}
                        </p>
                      </div>

                      <div className="text-[10px] text-slate-400">
                        Determination issued: {new Date(decision.created_at).toLocaleString()}
                      </div>

                      {/* Security Confidentiality Notice */}
                      <div className="flex items-start gap-2 rounded-lg bg-slate-100/80 p-2.5 text-[11px] text-slate-600">
                        <CpuChipIcon className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                        <span>
                          <strong>Confidentiality Notice:</strong> In compliance with PrivacyMesh least-privilege architecture, internal reviewer deliberations and officer audit notes are excluded from customer records.
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-500">
                      {decisionError || 'No customer-facing decision receipt found.'}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* B. New Submission Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">New KYC Application</h3>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                âœ•
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4">
              {createError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-medium">
                  {createError}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="submissionRef" className="block text-xs font-semibold text-slate-700">
                    Submission Reference
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateRef}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-800"
                  >
                    Generate Ref
                  </button>
                </div>
                <input
                  id="submissionRef"
                  type="text"
                  value={newRef}
                  onChange={(e) => setNewRef(e.target.value)}
                  placeholder="e.g. KYC-2026-8942"
                  required
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-hidden"
                />
              </div>

              <div>
                <label htmlFor="documentType" className="block text-xs font-semibold text-slate-700">
                  Document Type
                </label>
                <select
                  id="documentType"
                  value={newDocType}
                  onChange={(e) => setNewDocType(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-hidden"
                >
                  {DOCUMENT_TYPES.map((dt) => (
                    <option key={dt} value={dt}>
                      {dt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Research prototype limitation notice */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-[11px] text-blue-900 leading-4">
                <strong>Backend Verification Scope:</strong> This prototype registers document classifications, reference hashes, and version sequences. Binary document payload storage is not implemented in the current backend.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition disabled:opacity-50"
                >
                  {isCreating ? 'Submitting...' : 'Submit Application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* E. Correction and Resubmission Modal */}
      {isCorrectionModalOpen && selectedSubmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Upload Corrected Document</h3>
              <button
                type="button"
                onClick={() => setIsCorrectionModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                âœ•
              </button>
            </div>

            <form onSubmit={handleResubmitCorrection} className="mt-4 space-y-4">
              {correctionError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-medium">
                  {correctionError}
                </div>
              )}

              {/* Display reason for correction */}
              {decision?.customer_notes && (
                <div className="rounded-xl border border-orange-200 bg-orange-50/80 p-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-orange-900">
                    Reviewer Instructions
                  </span>
                  <p className="mt-1 text-xs text-orange-800 leading-relaxed">
                    {decision.customer_notes}
                  </p>
                </div>
              )}

              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Submission Ref:</span>
                  <span className="font-mono font-bold text-slate-800">{selectedSubmission.submission_ref}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Target Version:</span>
                  <span className="font-mono font-bold text-blue-700">
                    Version {(selectedSubmission.current_version?.version_number ?? 1) + 1}
                  </span>
                </div>
              </div>

              <div>
                <label htmlFor="correctionDocType" className="block text-xs font-semibold text-slate-700">
                  Updated Document Type
                </label>
                <select
                  id="correctionDocType"
                  value={correctionDocType}
                  onChange={(e) => setCorrectionDocType(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-hidden"
                >
                  {DOCUMENT_TYPES.map((dt) => (
                    <option key={dt} value={dt}>
                      {dt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-[11px] text-blue-900 leading-4">
                Submitting this correction registers Version {(selectedSubmission.current_version?.version_number ?? 1) + 1} and transitions the case back to compliance review.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCorrectionModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isResubmitting}
                  className="rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-orange-700 transition disabled:opacity-50"
                >
                  {isResubmitting ? 'Resubmitting...' : 'Confirm & Resubmit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ----------------- Supporting Components -----------------

function StatusBadge({ status }: { status: KYCSubmissionStatus | string }) {
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
          In Review
        </span>
      )
    case 'pending_manager_decision':
      return (
        <span className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
          Pending Decision
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
    case 'legacy_verified':
      return (
        <span className="inline-flex items-center rounded-md border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">
          Legacy Verified
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

function WorkflowTimeline({ status }: { status: KYCSubmissionStatus | string }) {
  const steps = [
    {
      label: 'Application Registered',
      description: 'Dossier initialized with Version 1 metadata',
      isCompleted: true,
      isCurrent: false,
    },
    {
      label: 'Automated Sanity Check',
      description: 'Cryptographic hash and document type screening',
      isCompleted: status !== 'draft',
      isCurrent: false,
    },
    {
      label: 'Compliance Officer Review',
      description: 'Assigned employee evaluation and recommendation',
      isCompleted: ['pending_manager_decision', 'approved', 'rejected', 'correction_requested'].includes(status),
      isCurrent: status === 'under_employee_review',
    },
    {
      label: 'Final Decision',
      description: 'Management authorization or correction request',
      isCompleted: ['approved', 'rejected'].includes(status),
      isCurrent: status === 'pending_manager_decision' || status === 'correction_requested',
      isAlert: status === 'correction_requested',
    },
  ]

  return (
    <div className="space-y-3">
      {steps.map((step, idx) => (
        <div key={step.label} className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                step.isCompleted
                  ? 'bg-emerald-600 text-white'
                  : step.isAlert
                  ? 'bg-orange-500 text-white'
                  : step.isCurrent
                  ? 'bg-blue-600 text-white ring-2 ring-blue-100'
                  : 'bg-slate-200 text-slate-500'
              }`}
            >
              {step.isCompleted ? 'âœ“' : idx + 1}
            </span>
            {idx < steps.length - 1 && (
              <span className={`h-6 w-0.5 ${step.isCompleted ? 'bg-emerald-300' : 'bg-slate-200'}`} />
            )}
          </div>
          <div className="min-w-0 pb-1">
            <p className="text-xs font-semibold text-slate-800 leading-tight">{step.label}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{step.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
