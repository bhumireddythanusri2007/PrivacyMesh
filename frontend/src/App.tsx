import { useEffect, useState } from 'react'
import type { ActivePage, HealthStatus, UserRole } from './types'
import {
  checkDbHealth,
  checkHealth,
  getCurrentUser,
  tokenStorage,
  userStorage,
} from './api'
import { Sidebar } from './components/Sidebar'
import type { NavigationPage } from './components/Sidebar'
import { Header } from './components/Header'
import { AuthModal } from './components/AuthModal'
import { DashboardView } from './components/DashboardView'
import { TransactionsView } from './components/TransactionsView'
import { KYCView } from './components/KYCView'
import { AdminView } from './components/AdminView'
import { SecurityView } from './components/SecurityView'
import { MonitoringView } from './components/MonitoringView'
import { CustomerWorkflowView } from './components/CustomerWorkflowView'
import { EmployeeWorkflowView } from './components/EmployeeWorkflowView'
import { ManagerWorkflowView } from './components/ManagerWorkflowView'

function isPageAllowedForRole(page: NavigationPage, role?: UserRole): boolean {
  switch (role) {
    case 'customer':
      return page === 'Dashboard' || page === 'My KYC' || page === 'Security' || page === 'Monitoring'
    case 'bank_employee':
      return page === 'Dashboard' || page === 'Assigned Cases' || page === 'Security' || page === 'Monitoring'
    case 'bank_manager':
      return page === 'Dashboard' || page === 'Case Management' || page === 'Security' || page === 'Monitoring'
    case 'system_admin':
      return page === 'Dashboard' || page === 'User Management' || page === 'Security' || page === 'Monitoring'
    case 'admin':
      // Legacy admin compatibility
      return (
        page === 'Dashboard' ||
        page === 'User Management' ||
        page === 'Admin' ||
        page === 'Security' ||
        page === 'Monitoring'
      )
    case 'user':
      // Legacy user compatibility
      return (
        page === 'Dashboard' ||
        page === 'Transactions' ||
        page === 'Security' ||
        page === 'Monitoring'
      )
    default:
      // Unauthenticated, pending_review, or unknown roles only have access to public views
      return page === 'Dashboard' || page === 'Security' || page === 'Monitoring'
  }
}

function App() {
  const [activePage, setActivePage] = useState<NavigationPage>('Dashboard')
  const [user, setUser] = useState<{ id: number; username: string; role: UserRole } | null>(() => userStorage.get())
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)

  // Real-time backend & database health state
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [dbHealth, setDbHealth] = useState<HealthStatus | null>(null)
  const [isCheckingHealth, setIsCheckingHealth] = useState(false)

  const refreshHealth = async () => {
    setIsCheckingHealth(true)
    try {
      const [h, dbH] = await Promise.allSettled([checkHealth(), checkDbHealth()])
      if (h.status === 'fulfilled') setHealth(h.value)
      else setHealth({ status: 'unreachable' })

      if (dbH.status === 'fulfilled') setDbHealth(dbH.value)
      else setDbHealth({ status: 'disconnected' })
    } finally {
      setIsCheckingHealth(false)
    }
  }

  // Restore authenticated session on mount and listen for expiry
  useEffect(() => {
    let active = true

    const initHealth = async () => {
      try {
        const [h, dbH] = await Promise.allSettled([checkHealth(), checkDbHealth()])
        if (!active) return
        if (h.status === 'fulfilled') setHealth(h.value)
        else setHealth({ status: 'unreachable' })

        if (dbH.status === 'fulfilled') setDbHealth(dbH.value)
        else setDbHealth({ status: 'disconnected' })
      } catch {
        // ignore
      }
    }
    void initHealth()

    const token = tokenStorage.get()

    if (token) {
      getCurrentUser()
        .then((res) => {
          if (!active) return
          setUser(res.user)
          userStorage.set(res.user)
          setActivePage((prev) => (isPageAllowedForRole(prev, res.user.role) ? prev : 'Dashboard'))
        })
        .catch(() => {
          if (!active) return
          tokenStorage.remove()
          userStorage.remove()
          setUser(null)
          setActivePage('Dashboard')
        })
    }

    const handleExpired = () => {
      setUser(null)
      setActivePage('Dashboard')
      setIsAuthModalOpen(true)
    }

    window.addEventListener('auth:expired', handleExpired)
    return () => {
      active = false
      window.removeEventListener('auth:expired', handleExpired)
    }
  }, [])

  const handleLogout = () => {
    tokenStorage.remove()
    userStorage.remove()
    setUser(null)
    setActivePage('Dashboard')
  }

  const handleAuthSuccess = (authenticatedUser: { id: number; username: string; role: UserRole }) => {
    setUser(authenticatedUser)
    setActivePage((prev) => (isPageAllowedForRole(prev, authenticatedUser.role) ? prev : 'Dashboard'))
  }

  const handleNavigate = (page: NavigationPage) => {
    if (isPageAllowedForRole(page, user?.role)) {
      setActivePage(page)
    } else {
      setActivePage('Dashboard')
    }
  }

  // Derived effective page guarantees unauthorized views can never render
  const isPageAllowed = isPageAllowedForRole(activePage, user?.role)
  const effectivePage: NavigationPage = isPageAllowed ? activePage : 'Dashboard'

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Role-Specific Sidebar Navigation */}
      <Sidebar
        activePage={effectivePage}
        setActivePage={handleNavigate}
        user={user}
        onLogout={handleLogout}
        isOpenMobile={isMobileNavOpen}
        setIsOpenMobile={setIsMobileNavOpen}
      />

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <Header
          activePage={effectivePage as unknown as ActivePage}
          user={user}
          health={health}
          dbHealth={dbHealth}
          isCheckingHealth={isCheckingHealth}
          onRefreshHealth={refreshHealth}
          onOpenMobileNav={() => setIsMobileNavOpen(true)}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
        />

        <main className="flex-1 mx-auto w-full max-w-7xl p-5 sm:p-8">
          {/* Security Guard: Fallback UI if activePage is unauthorized for role */}
          {!isPageAllowed ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-900">
              <h3 className="text-base font-bold">Access Restricted</h3>
              <p className="mt-1 text-xs text-amber-700">
                Your current role ({user?.role || 'Guest'}) does not have permission to access the "{activePage}" module.
              </p>
              <button
                type="button"
                onClick={() => setActivePage('Dashboard')}
                className="mt-4 inline-flex items-center rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition"
              >
                Return to Dashboard
              </button>
            </div>
          ) : (
            <>
              {effectivePage === 'Dashboard' && (
                <DashboardView
                  user={user}
                  onNavigate={(page) => handleNavigate(page as NavigationPage)}
                  onOpenAuth={() => setIsAuthModalOpen(true)}
                />
              )}

              {/* Customer Workflow Module */}
              {effectivePage === 'My KYC' && (
                <CustomerWorkflowView
                  user={user}
                  onOpenAuth={() => setIsAuthModalOpen(true)}
                />
              )}

              {/* Bank Employee Workflow Module */}
              {effectivePage === 'Assigned Cases' && (
                <EmployeeWorkflowView
                  user={user}
                  onOpenAuth={() => setIsAuthModalOpen(true)}
                />
              )}

              {/* Bank Manager Workflow Module */}
              {effectivePage === 'Case Management' && (
                <ManagerWorkflowView
                  user={user}
                  onOpenAuth={() => setIsAuthModalOpen(true)}
                />
              )}

              {/* System Administrator / User Management */}
              {(effectivePage === 'User Management' || effectivePage === 'Admin') && (
                <AdminView
                  user={user}
                  onOpenAuth={() => setIsAuthModalOpen(true)}
                />
              )}

              {/* Legacy Transactions View (isolated from system_admin and modern workflow roles) */}
              {effectivePage === 'Transactions' && (
                <TransactionsView
                  user={user}
                  onOpenAuth={() => setIsAuthModalOpen(true)}
                />
              )}

              {/* Legacy KYC View (isolated from system_admin and modern workflow roles) */}
              {effectivePage === 'KYC Records' && (
                <KYCView
                  user={user}
                  onOpenAuth={() => setIsAuthModalOpen(true)}
                />
              )}

              {/* Security View (Confidential computing status and controls) */}
              {effectivePage === 'Security' && (
                <SecurityView
                  user={user}
                  onOpenAuth={() => setIsAuthModalOpen(true)}
                />
              )}

              {/* Monitoring View (System telemetry and metrics) */}
              {effectivePage === 'Monitoring' && <MonitoringView />}
            </>
          )}

          {/* Academic Footer */}
          <footer className="mt-12 flex flex-col justify-between gap-2 border-t border-slate-200 py-6 text-xs text-slate-400 sm:flex-row">
            <p>PrivacyMesh Â· Confidential Computing for Sensitive Data Workloads</p>
            <p>Academic Design & Research Prototype Â· Not a Production Financial System</p>
          </footer>
        </main>
      </div>

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />
    </div>
  )
}

export default App
