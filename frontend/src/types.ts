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

export interface HardwareDetectionReport {
  cpu_sgx_detected: boolean
  cpu_sev_detected: boolean
  sgx_device_nodes_found: string[]
  sev_device_nodes_found: string[]
  driver_initialized: boolean
  attestation_configured: boolean
  detection_summary: string
}

export interface DataTriadStatus {
  data_at_rest: string
  data_in_transit: string
  data_in_use: string
}

export interface TEEStatusResponse {
  status: 'simulation' | 'hardware_tee' | 'not_configured'
  mode_label: string
  operational_readiness: string
  is_hardware_enclave: boolean
  hardware_detection: HardwareDetectionReport
  data_triad: DataTriadStatus
  limitations: string[]
}

export interface SyntheticWorkloadInput {
  account_id: string
  monthly_income: number
  requested_credit_amount: number
  existing_obligations: number
  risk_tier: 'low' | 'medium' | 'high'
}

export interface WorkloadExecutionStep {
  step_number: number
  phase: string
  detail: string
  simulated_isolation_boundary: string
}

export interface SyntheticWorkloadResult {
  masked_account_id: string
  monthly_income: string | number
  requested_credit_amount: string | number
  debt_to_income_ratio: number
  credit_risk_score: number
  approved: boolean
  approved_limit: string | number
  recommendation: string
  execution_mode: string
  execution_trace: WorkloadExecutionStep[]
  timestamp: string
}

export type ActivePage = 'Dashboard' | 'Transactions' | 'KYC Records' | 'Security' | 'Admin'
