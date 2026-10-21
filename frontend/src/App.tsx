import { useState } from 'react'

const navigation = [
  { name: 'Dashboard', icon: '?' },
  { name: 'Transactions', icon: '?' },
  { name: 'KYC Records', icon: '?' },
  { name: 'Security', icon: '?' },
  { name: 'Admin', icon: '?' },
]

const demoTransactions = [
  { id: 'TXN-1004', account: 'ACC•••1001', type: 'Deposit', amount: '+?5,000.00', status: 'Completed', date: '21 Oct 2026' },
  { id: 'TXN-1003', account: 'ACC•••1002', type: 'Transfer', amount: '-?1,500.00', status: 'Completed', date: '21 Oct 2026' },
  { id: 'TXN-1002', account: 'ACC•••1004', type: 'Withdrawal', amount: '-?800.00', status: 'Pending', date: '20 Oct 2026' },
]

function App() {
  const [activePage, setActivePage] = useState('Dashboard')

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-20 items-center gap-3 border-b border-slate-100 px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-700 text-xl font-bold text-white">P</div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">PrivacyMesh</h1>
            <p className="text-xs text-slate-500">Confidential Banking</p>
          </div>
        </div>

        <div className="px-4 pt-7">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Workspace</p>
          <nav className="space-y-1">
            {navigation.map((item) => (
              <button
                key={item.name}
                onClick={() => setActivePage(item.name)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${
                  activePage === item.name
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="w-6 text-center text-lg">{item.icon}</span>
                {item.name}
                {item.name === 'Security' && (
                  <span className="ml-auto h-2 w-2 rounded-full bg-emerald-500" />
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto p-4">
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-900">
              <span>?</span> Confidential computing
            </div>
            <p className="text-xs leading-5 text-blue-800">Designed to protect sensitive workloads while they are being processed.</p>
            <div className="mt-3 flex items-center gap-2 text-xs font-medium text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              API connection checked separately
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-700">PM</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">PrivacyMesh User</p>
              <p className="text-xs text-slate-500">Demo interface</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="md:pl-64">
        <header className="sticky top-0 z-10 flex h-20 items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur sm:px-8">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">PrivacyMesh / Workspace</p>
            <h2 className="mt-1 text-xl font-bold">{activePage}</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 sm:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Backend health checked separately
            </span>
            <button
              onClick={() => setActivePage('Dashboard')}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Overview
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl p-5 sm:p-8">
          <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-medium text-blue-700">BANKING WORKLOAD PROTECTION</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                Secure operations overview
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                A central interface for transaction processing, KYC records, access controls and confidential-computing monitoring.
              </p>
            </div>
            <span className="w-fit rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              Preview · Demonstration data
            </span>
          </div>

          {activePage !== 'Dashboard' && (
            <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
              <strong>{activePage}</strong> is selected. This screen is a UI preview; its data and actions will be connected to the backend in the next implementation steps.
            </div>
          )}

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Total users', value: '—', note: 'Load from admin API', icon: '?', color: 'bg-blue-50 text-blue-700' },
              { label: 'Transactions', value: '—', note: 'Load from database', icon: '?', color: 'bg-violet-50 text-violet-700' },
              { label: 'KYC records', value: '—', note: 'Load from KYC API', icon: '?', color: 'bg-amber-50 text-amber-700' },
              { label: 'API health', value: 'Healthy*', note: '*Last terminal check passed', icon: '?', color: 'bg-emerald-50 text-emerald-700' },
            ].map((stat) => (
              <article key={stat.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-100/60">
                <div className="flex items-start justify-between">
                  <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg ${stat.color}`}>{stat.icon}</span>
                </div>
                <p className="mt-4 text-3xl font-bold tracking-tight">{stat.value}</p>
                <p className="mt-2 text-xs text-slate-500">{stat.note}</p>
              </article>
            ))}
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div>
                  <h3 className="text-base font-bold">Recent transactions</h3>
                  <p className="mt-1 text-sm text-slate-500">Illustrative records — not live database results</p>
                </div>
                <button onClick={() => setActivePage('Transactions')} className="w-fit rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  View transactions ?
                </button>
              </div>

              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[540px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs uppercase tracking-wider text-slate-400">
                      <th className="pb-3 pr-4 font-medium">Transaction</th>
                      <th className="pb-3 pr-4 font-medium">Type</th>
                      <th className="pb-3 pr-4 font-medium">Amount</th>
                      <th className="pb-3 pr-4 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {demoTransactions.map((transaction) => (
                      <tr key={transaction.id} className="border-b border-slate-50 last:border-0">
                        <td className="py-4 pr-4">
                          <p className="font-semibold text-slate-800">{transaction.id}</p>
                          <p className="mt-1 text-xs text-slate-400">{transaction.account}</p>
                        </td>
                        <td className="py-4 pr-4 text-slate-600">{transaction.type}</td>
                        <td className="py-4 pr-4 font-semibold text-slate-800">{transaction.amount}</td>
                        <td className="py-4 pr-4">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            transaction.status === 'Completed'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}>{transaction.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-bold">Security overview</h3>
              <p className="mt-1 text-sm text-slate-500">Project capabilities and implementation status</p>
              <div className="mt-6 space-y-5">
                {[
                  { title: 'Authentication', description: 'JWT-based API access', status: 'Implemented' },
                  { title: 'Role-based access', description: 'User and admin permissions', status: 'Implemented' },
                  { title: 'Database connection', description: 'PostgreSQL health endpoint', status: 'Tested' },
                  { title: 'Trusted execution environment', description: 'TEE integration', status: 'Planned' },
                ].map((item) => (
                  <div key={item.title} className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      item.status === 'Planned' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'
                    }`}>{item.status === 'Planned' ? '?' : '?'}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{item.title}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
                    </div>
                    <span className={`shrink-0 text-[11px] font-medium ${
                      item.status === 'Planned' ? 'text-slate-500' : 'text-emerald-700'
                    }`}>{item.status}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-700">Security note</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Confidential computing protection requires actual TEE infrastructure and configuration. This dashboard alone does not provide it.
                </p>
              </div>
            </article>
          </section>

          <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-slate-200 py-5 text-xs text-slate-400 sm:flex-row">
            <p>PrivacyMesh · Confidential Computing for Sensitive Data Workloads</p>
            <p>Research and academic prototype · Not a production banking system</p>
          </footer>
        </main>
      </div>
    </div>
  )
}

export default App

