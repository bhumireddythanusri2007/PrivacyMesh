export type UserRole = 'customer' | 'bank_employee' | 'bank_manager' | 'system_admin' | 'pending_review' | 'user' | 'admin'

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

export interface MonitoringStatusResponse {
  status: string
  cpu_percent: number
  memory_percent: number
  memory_total_mb: number
  metrics_endpoint: string
  note?: string
}

export interface ParsedEndpointMetric {
  method: string
  endpoint: string
  status: string
  count: number
}

export interface ParsedPrometheusMetrics {
  totalRequests: number | null
  successRequests: number | null
  errorRequests: number | null
  avgLatencyMs: number | null
  endpointBreakdown: ParsedEndpointMetric[]
  rawMetricsAvailable: boolean
}

export type ActivePage = 'Dashboard' | 'Transactions' | 'KYC Records' | 'Security' | 'Monitoring' | 'Admin'

// ============================================================================
// Modern Multi-Role KYC Workflow Schemas
// ============================================================================

export type KYCSubmissionStatus =
  | 'draft'
  | 'submitted'
  | 'under_employee_review'
  | 'pending_manager_decision'
  | 'approved'
  | 'rejected'
  | 'correction_requested'
  | 'legacy_verified'
  | 'legacy_unresolved'

export type KYCAutoValidationStatus = 'unassessed' | 'passed' | 'failed' | 'warning'

export type KYCEmployeeAction = 'recommend_approve' | 'recommend_reject' | 'request_correction'
export type KYCManagerAction = 'approve' | 'reject' | 'manager_request_correction'
export type KYCReviewAction = KYCEmployeeAction | KYCManagerAction

export interface KYCVersionCreate {
  document_type: string
}

export interface KYCVersionResponse {
  id: number
  submission_id: number
  version_number: number
  is_current: boolean
  document_type: string
  auto_validation_status: KYCAutoValidationStatus | string
  auto_validation_results?: unknown | null
  created_at: string
}

export interface KYCSubmissionCreate {
  submission_ref: string
  document_type: string
}

export interface KYCSubmissionResponse {
  id: number
  customer_id?: number | null
  submission_ref: string
  status: KYCSubmissionStatus | string
  is_archived: boolean
  archived_at?: string | null
  archived_by_id?: number | null
  assigned_employee_id?: number | null
  assigned_manager_id?: number | null
  created_at: string
  updated_at: string
  current_version?: KYCVersionResponse | null
}

export interface KYCDecisionResponse {
  id: number
  submission_id: number
  version_id: number
  action: string
  customer_notes?: string | null
  created_at: string
}

export interface KYCEmployeeRecommendationRequest {
  action: KYCEmployeeAction
  internal_notes: string
}

export interface KYCManagerDecisionRequest {
  action: KYCManagerAction
  customer_notes: string
  internal_notes?: string | null
}

export interface KYCAssignEmployeeRequest {
  assigned_employee_id: number
}

export interface KYCReviewResponse {
  id: number
  submission_id: number
  version_id: number
  reviewer_id: number
  reviewer_role: string
  action: KYCReviewAction | string
  internal_notes?: string | null
  customer_notes?: string | null
  created_at: string
}
