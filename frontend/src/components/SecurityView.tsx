import type { FC } from 'react'
import {
  CheckCircleIcon,
  ClockIcon,
  CpuChipIcon,
  SecurityIcon,
} from './Icons'

export const SecurityView: FC = () => {
  const implementedControls = [
    {
      title: 'Cryptographic Password Hashing',
      component: 'backend/app/security.py',
      detail:
        'Passwords hashed using pwdlib with Argon2id recommended parameters. Raw passwords and plain credentials are never persisted to the database or emitted in API payloads.',
      status: 'Implemented & Verified',
    },
    {
      title: 'JWT Bearer Token Authentication',
      component: 'backend/app/security.py',
      detail:
        'Signed JSON Web Tokens (HS256) with 30-minute expiration. Authenticates client calls across protected endpoints and conveys user context securely.',
      status: 'Implemented & Verified',
    },
    {
      title: 'Role-Based Authorization (RBAC)',
      component: 'backend/app/routers/admin.py',
      detail:
        'Enforced by backend dependency guards (require_admin). Public registration strictly constrains new accounts to the "user" role, preventing privilege escalation.',
      status: 'Implemented & Verified',
    },
    {
      title: 'Multi-Tenant Workload Isolation',
      component: 'backend/app/routers/transactions.py, kyc.py',
      detail:
        'Ordinary users are cryptographically constrained to querying only their own transaction and KYC records. Cross-account data leaks are prohibited by database foreign keys.',
      status: 'Implemented & Verified',
    },
    {
      title: 'PostgreSQL Connection Health Monitoring',
      component: 'backend/app/database.py, main.py',
      detail:
        'Health endpoints (/health, /db-health) monitor active connection pools with pre-ping validation, returning 503 Service Unavailable upon database disconnections.',
      status: 'Implemented & Verified',
    },
  ]

  const plannedTEEFeatures = [
    {
      title: 'Trusted Execution Environment (TEE Enclaves)',
      technology: 'Intel SGX / AMD SEV',
      detail:
        'Future hardware-isolated memory regions (enclaves) to protect sensitive banking operations while in-use, ensuring host OS and hypervisor admins cannot read memory.',
      status: 'Planned Objective',
    },
    {
      title: 'Remote Attestation & Measurement',
      technology: 'DCAP / EPID Attestation Services',
      detail:
        'Cryptographic verification of enclave identity and codebase integrity prior to dispatching customer financial secrets.',
      status: 'Planned Objective',
    },
    {
      title: 'Confidential Key Provisioning',
      technology: 'Hardware Security Module (HSM) Enclave Binding',
      detail:
        'Secure key derivation and sealing directly inside processor silicon without leaving the cryptographic boundary.',
      status: 'Planned Objective',
    },
    {
      title: 'Side-Channel & Microarchitectural Defenses',
      technology: 'Constant-time execution & cache partition',
      detail:
        'Mitigations against speculative execution and cache-timing attacks on high-value confidential financial transactions.',
      status: 'Planned Objective',
    },
  ]

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Intro Header */}
      <div>
        <div className="flex items-center gap-2">
          <SecurityIcon className="w-6 h-6 text-blue-700" />
          <h3 className="text-xl font-bold tracking-tight text-slate-900">
            Security & Confidential Computing Architecture
          </h3>
        </div>
        <p className="mt-1 text-xs sm:text-sm text-slate-600 max-w-3xl leading-5">
          PrivacyMesh is designed to evaluate confidential computing principles for sensitive banking and KYC workloads. Below is an academic audit distinguishing currently verified controls from future hardware-backed enclave milestones.
        </p>
      </div>

      {/* Distinction Alert */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-5 shadow-xs">
        <div className="flex items-start gap-3">
          <CpuChipIcon className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-bold text-blue-900">
              Academic Demonstration Scope & Hardware Enclave Distinction
            </h4>
            <p className="mt-1 text-xs text-blue-800 leading-5">
              The application layer currently implements robust cryptographic authentication, role separation, and tenant isolation in software. True hardware-enforced confidential computing requires dedicated cloud or on-premise TEE support (such as Intel SGX or AMD SEV confidential virtual machines), which represents the project&apos;s next research phase.
            </p>
          </div>
        </div>
      </div>

      {/* Implemented Controls Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-base font-bold text-slate-900">Implemented Security Controls</h4>
            <p className="text-xs text-slate-500">
              Fully active, configured, and covered by automated integration test verification.
            </p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
            5 Controls Active
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {implementedControls.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs hover:border-slate-300 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircleIcon className="w-4 h-4 text-emerald-600 shrink-0" />
                  <h5 className="text-sm font-bold text-slate-900">{item.title}</h5>
                </div>
                <span className="shrink-0 rounded-sm bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  {item.status}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">{item.detail}</p>
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                <span>Location:</span>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                  {item.component}
                </code>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Planned TEE Architecture Roadmap */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-base font-bold text-slate-900">
              Future Objective: Confidential Computing Enclave (TEE)
            </h4>
            <p className="text-xs text-slate-500">
              Hardware-isolated execution roadmap for sensitive banking workloads.
            </p>
          </div>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 border border-amber-200">
            Research Roadmap
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {plannedTEEFeatures.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-5 shadow-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ClockIcon className="w-4 h-4 text-amber-600 shrink-0" />
                  <h5 className="text-sm font-bold text-slate-800">{item.title}</h5>
                </div>
                <span className="shrink-0 rounded-sm bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  {item.status}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">{item.detail}</p>
              <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-500">
                <span>Target Hardware:</span>
                <span className="font-semibold text-slate-700">{item.technology}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
