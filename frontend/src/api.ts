import type {
  AdminSummary,
  AuthResponse,
  CreateTransactionPayload,
  HealthStatus,
  KYCAssignEmployeeRequest,
  KYCDecisionResponse,
  KYCEmployeeRecommendationRequest,
  KYCManagerDecisionRequest,
  KYCRecord,
  KYCReviewResponse,
  KYCSubmissionCreate,
  KYCSubmissionResponse,
  KYCVersionCreate,
  KYCVersionResponse,
  MonitoringStatusResponse,
  ParsedPrometheusMetrics,
  ProtectedUserResponse,
  SyntheticWorkloadInput,
  SyntheticWorkloadResult,
  TEEStatusResponse,
  Transaction,
  User,
  UserRole,
} from './types'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const TOKEN_KEY = 'privacymesh_token'
const USER_KEY = 'privacymesh_user'

export class ApiError extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

// Session-scoped token management
export const tokenStorage = {
  get(): string | null {
    try {
      return sessionStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set(token: string): void {
    try {
      sessionStorage.setItem(TOKEN_KEY, token)
    } catch {
      // storage quota or private browsing error
    }
  },
  remove(): void {
    try {
      sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      // ignore
    }
  },
}

export const userStorage = {
  get(): { id: number; username: string; role: UserRole } | null {
    try {
      const data = sessionStorage.getItem(USER_KEY)
      return data ? JSON.parse(data) : null
    } catch {
      return null
    }
  },
  set(user: { id: number; username: string; role: UserRole }): void {
    try {
      sessionStorage.setItem(USER_KEY, JSON.stringify(user))
    } catch {
      // ignore
    }
  },
  remove(): void {
    try {
      sessionStorage.removeItem(USER_KEY)
    } catch {
      // ignore
    }
  },
}

/**
 * Base HTTP client that automatically includes Authorization header when authenticated
 * and parses structured FastAPI error messages.
 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  requiresAuth: boolean = false
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`
  const headers = new Headers(options.headers || {})

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }

  const token = tokenStorage.get()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  } else if (requiresAuth) {
    throw new ApiError(401, 'Authentication token missing. Please sign in.')
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`
    try {
      const errorJson = await response.json()
      if (typeof errorJson.detail === 'string') {
        detail = errorJson.detail
      } else if (Array.isArray(errorJson.detail)) {
        // FastAPI / Pydantic validation error list
        detail = errorJson.detail.map((err: { msg?: string }) => err.msg || 'Validation error').join('; ')
      }
    } catch {
      // Response body wasn't JSON
    }

    if (response.status === 401 && requiresAuth) {
      tokenStorage.remove()
      userStorage.remove()
      window.dispatchEvent(new CustomEvent('auth:expired'))
    }

    throw new ApiError(response.status, detail)
  }

  // Handle empty responses (e.g. 204 No Content)
  if (response.status === 204) {
    return {} as T
  }

  return response.json() as Promise<T>
}

// ----------------- Public & Auth API -----------------

export async function checkHealth(): Promise<HealthStatus> {
  return request<HealthStatus>('/health')
}

export async function checkDbHealth(): Promise<HealthStatus> {
  return request<HealthStatus>('/db-health')
}

export async function loginUser(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

export async function registerUser(username: string, password: string): Promise<User> {
  return request<User>('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

export async function getCurrentUser(): Promise<ProtectedUserResponse> {
  return request<ProtectedUserResponse>('/protected', {}, true)
}

// ----------------- Transactions API -----------------

export async function fetchTransactions(): Promise<Transaction[]> {
  return request<Transaction[]>('/transactions', {}, true)
}

export async function createTransaction(payload: CreateTransactionPayload): Promise<Transaction> {
  return request<Transaction>(
    '/transactions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    true
  )
}

// ----------------- KYC Records API -----------------

export async function fetchKYCRecords(): Promise<KYCRecord[]> {
  return request<KYCRecord[]>('/kyc', {}, true)
}

export async function createKYCRecord(customerRef: string, documentType: string): Promise<KYCRecord> {
  const queryParams = new URLSearchParams({
    customer_ref: customerRef.trim(),
    document_type: documentType.trim(),
  })
  return request<KYCRecord>(
    `/kyc?${queryParams.toString()}`,
    {
      method: 'POST',
    },
    true
  )
}

// ----------------- Admin API -----------------

export async function fetchAdminSummary(): Promise<AdminSummary> {
  return request<AdminSummary>('/admin/summary', {}, true)
}

export async function fetchAdminUsers(): Promise<User[]> {
  return request<User[]>('/admin/users', {}, true)
}

// ----------------- Confidential Computing API -----------------

export async function fetchTEEStatus(): Promise<TEEStatusResponse> {
  return request<TEEStatusResponse>('/confidential-computing/status')
}

export async function runConfidentialDemo(
  payload: SyntheticWorkloadInput
): Promise<SyntheticWorkloadResult> {
  return request<SyntheticWorkloadResult>(
    '/confidential-computing/run-demo',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    true
  )
}

// ----------------- Monitoring API -----------------

export async function fetchMonitoringStatus(): Promise<MonitoringStatusResponse> {
  return request<MonitoringStatusResponse>('/monitoring/status')
}

export async function fetchMetricsText(): Promise<string> {
  const url = `${API_BASE_URL}/metrics`
  const response = await fetch(url, {
    headers: {
      Accept: 'text/plain, */*',
    },
  })
  if (!response.ok) {
    throw new ApiError(response.status, `Failed to retrieve metrics (HTTP ${response.status})`)
  }
  return response.text()
}

/**
 * Safely parses Prometheus text-format metrics.
 * Extracts privacymesh_http_requests_total and duration histogram sums/counts.
 * If metrics are missing or unavailable, returns null for those values.
 */
export function parsePrometheusMetrics(text: string): ParsedPrometheusMetrics {
  let totalRequests = 0
  let successRequests = 0
  let errorRequests = 0
  let totalDurationSum = 0
  let totalDurationCount = 0
  let hasRequestsMetric = false
  const endpointMap = new Map<string, { method: string; endpoint: string; status: string; count: number }>()

  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // Parse privacymesh_http_requests_total counter
    const reqMatch = trimmed.match(/^privacymesh_http_requests_total\{([^}]+)\}\s+([0-9.eE+-]+)/)
    if (reqMatch) {
      hasRequestsMetric = true
      const labelsStr = reqMatch[1]
      const count = parseFloat(reqMatch[2]) || 0
      totalRequests += count

      const methodMatch = labelsStr.match(/method="([^"]+)"/)
      const endpointMatch = labelsStr.match(/endpoint="([^"]+)"/)
      const statusMatch = labelsStr.match(/status="([^"]+)"/)

      const method = methodMatch ? methodMatch[1] : 'UNKNOWN'
      const endpoint = endpointMatch ? endpointMatch[1] : 'UNKNOWN'
      const status = statusMatch ? statusMatch[1] : 'UNKNOWN'

      if (status.startsWith('2')) {
        successRequests += count
      } else if (status.startsWith('4') || status.startsWith('5')) {
        errorRequests += count
      }

      const key = `${method}:${endpoint}:${status}`
      const existing = endpointMap.get(key)
      if (existing) {
        existing.count += count
      } else {
        endpointMap.set(key, { method, endpoint, status, count })
      }
    }

    // Parse duration sum
    const sumMatch = trimmed.match(/^privacymesh_http_request_duration_seconds_sum\{([^}]+)\}\s+([0-9.eE+-]+)/)
    if (sumMatch) {
      totalDurationSum += parseFloat(sumMatch[2]) || 0
    }

    // Parse duration count
    const countMatch = trimmed.match(/^privacymesh_http_request_duration_seconds_count\{([^}]+)\}\s+([0-9.eE+-]+)/)
    if (countMatch) {
      totalDurationCount += parseFloat(countMatch[2]) || 0
    }
  }

  const avgLatencyMs =
    totalDurationCount > 0
      ? Math.round((totalDurationSum / totalDurationCount) * 1000 * 100) / 100
      : null

  const endpointBreakdown = Array.from(endpointMap.values()).sort((a, b) => b.count - a.count)

  return {
    totalRequests: hasRequestsMetric ? totalRequests : null,
    successRequests: hasRequestsMetric ? successRequests : null,
    errorRequests: hasRequestsMetric ? errorRequests : null,
    avgLatencyMs,
    endpointBreakdown,
    rawMetricsAvailable: text.length > 0,
  }
}

// ----------------- Modern Multi-Role KYC Workflow API -----------------

// Customer endpoints
export async function createKYCSubmission(payload: KYCSubmissionCreate): Promise<KYCSubmissionResponse> {
  return request<KYCSubmissionResponse>(
    '/kyc/workflow/submissions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    true
  )
}

export async function fetchMyKYCSubmissions(): Promise<KYCSubmissionResponse[]> {
  return request<KYCSubmissionResponse[]>('/kyc/workflow/submissions/my', {}, true)
}

export async function fetchKYCSubmissionDetail(submissionId: number): Promise<KYCSubmissionResponse> {
  return request<KYCSubmissionResponse>(
    `/kyc/workflow/submissions/${encodeURIComponent(submissionId)}`,
    {},
    true
  )
}

export async function createKYCVersion(
  submissionId: number,
  payload: KYCVersionCreate
): Promise<KYCVersionResponse> {
  return request<KYCVersionResponse>(
    `/kyc/workflow/submissions/${encodeURIComponent(submissionId)}/versions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    true
  )
}

export async function resubmitKYCCorrection(submissionId: number): Promise<KYCSubmissionResponse> {
  return request<KYCSubmissionResponse>(
    `/kyc/workflow/submissions/${encodeURIComponent(submissionId)}/resubmit`,
    {
      method: 'POST',
    },
    true
  )
}

export async function fetchCustomerKYCDecision(submissionId: number): Promise<KYCDecisionResponse> {
  return request<KYCDecisionResponse>(
    `/kyc/workflow/submissions/${encodeURIComponent(submissionId)}/decision`,
    {},
    true
  )
}

// Bank Employee endpoints
export async function fetchAssignedKYCCases(): Promise<KYCSubmissionResponse[]> {
  return request<KYCSubmissionResponse[]>('/kyc/workflow/employee/assigned', {}, true)
}

export async function startEmployeeKYCReview(submissionId: number): Promise<KYCSubmissionResponse> {
  return request<KYCSubmissionResponse>(
    `/kyc/workflow/submissions/${encodeURIComponent(submissionId)}/review-start`,
    {
      method: 'POST',
    },
    true
  )
}

export async function submitEmployeeKYCRecommendation(
  submissionId: number,
  payload: KYCEmployeeRecommendationRequest
): Promise<KYCSubmissionResponse> {
  return request<KYCSubmissionResponse>(
    `/kyc/workflow/submissions/${encodeURIComponent(submissionId)}/recommend`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    true
  )
}

export async function fetchKYCSubmissionReviews(submissionId: number): Promise<KYCReviewResponse[]> {
  return request<KYCReviewResponse[]>(
    `/kyc/workflow/submissions/${encodeURIComponent(submissionId)}/reviews`,
    {},
    true
  )
}

// Bank Manager endpoints
export async function fetchManagerKYCCases(statusFilter?: string): Promise<KYCSubmissionResponse[]> {
  const query = statusFilter ? `?status=${encodeURIComponent(statusFilter.trim())}` : ''
  return request<KYCSubmissionResponse[]>(`/kyc/workflow/manager/cases${query}`, {}, true)
}

export async function assignEmployeeToKYCCase(
  submissionId: number,
  payload: KYCAssignEmployeeRequest
): Promise<KYCSubmissionResponse> {
  return request<KYCSubmissionResponse>(
    `/kyc/workflow/submissions/${encodeURIComponent(submissionId)}/assign`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    true
  )
}

export async function finalizeManagerKYCDecision(
  submissionId: number,
  payload: KYCManagerDecisionRequest
): Promise<KYCSubmissionResponse> {
  return request<KYCSubmissionResponse>(
    `/kyc/workflow/submissions/${encodeURIComponent(submissionId)}/decision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    true
  )
}

export async function archiveKYCSubmission(submissionId: number): Promise<KYCSubmissionResponse> {
  return request<KYCSubmissionResponse>(
    `/kyc/workflow/submissions/${encodeURIComponent(submissionId)}/archive`,
    {
      method: 'POST',
    },
    true
  )
}
