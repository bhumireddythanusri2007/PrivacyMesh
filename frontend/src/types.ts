export type UserRole = 'user' | 'admin'

export interface User {
  id: number
  username: string
  role: UserRole
  created_at: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
}

export interface ProtectedUserResponse {
  message: string
  user: {
    id: number
    username: string
    role: UserRole
  }
}

export type TransactionType = 'deposit' | 'withdrawal' | 'transfer'
export type TransactionStatus = 'completed' | 'pending' | 'failed'

export interface Transaction {
  id: number
  user_id: number
  account_id: string
  amount: string | number
  transaction_type: TransactionType
  status: TransactionStatus
  created_at: string
}

export interface CreateTransactionPayload {
  account_id: string
  amount: number
  transaction_type: TransactionType
}

export interface KYCRecord {
  id: number
  user_id?: number | null
  customer_ref: string
  document_type: string
  verification_status: string
  risk_category: string
  created_at: string
}

export interface AdminSummary {
  total_users: number
  total_transactions: number
  total_kyc_records: number
}

export interface HealthStatus {
  status: string
  database?: string
}

export type ActivePage = 'Dashboard' | 'Transactions' | 'KYC Records' | 'Security' | 'Admin'
