import type {
  AdminSummary,
  AuthResponse,
  CreateTransactionPayload,
  HealthStatus,
  KYCRecord,
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
