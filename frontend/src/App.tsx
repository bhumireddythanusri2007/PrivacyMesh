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
import { Header } from './components/Header'
import { AuthModal } from './components/AuthModal'
import { DashboardView } from './components/DashboardView'
import { TransactionsView } from './components/TransactionsView'
import { KYCView } from './components/KYCView'
import { AdminView } from './components/AdminView'
import { SecurityView } from './components/SecurityView'

function App() {
  const [activePage, setActivePage] = useState<ActivePage>('Dashboard')
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

  // Restore authenticated session on mount
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
        })
        .catch(() => {
          if (!active) return
          tokenStorage.remove()
          userStorage.remove()
          setUser(null)
        })
    }

    const handleExpired = () => {
      setUser(null)
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
    if (activePage === 'Admin') {
      setActivePage('Dashboard')
    }
  }

  const handleAuthSuccess = (authenticatedUser: { id: number; username: string; role: UserRole }) => {
    setUser(authenticatedUser)
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Sidebar Navigation */}
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
        user={user}
        onLogout={handleLogout}
        isOpenMobile={isMobileNavOpen}
        setIsOpenMobile={setIsMobileNavOpen}
      />

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 flex flex-col min-w-0">
        <Header
          activePage={activePage}
          user={user}
          health={health}
          dbHealth={dbHealth}
          isCheckingHealth={isCheckingHealth}
          onRefreshHealth={refreshHealth}
          onOpenMobileNav={() => setIsMobileNavOpen(true)}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
        />

        <main className="flex-1 mx-auto w-full max-w-7xl p-5 sm:p-8">
          {activePage === 'Dashboard' && (
            <DashboardView
              user={user}
              onNavigate={(page) => setActivePage(page)}
              onOpenAuth={() => setIsAuthModalOpen(true)}
            />
          )}

          {activePage === 'Transactions' && (
            <TransactionsView
              user={user}
              onOpenAuth={() => setIsAuthModalOpen(true)}
            />
          )}

          {activePage === 'KYC Records' && (
            <KYCView
              user={user}
              onOpenAuth={() => setIsAuthModalOpen(true)}
            />
          )}

          {activePage === 'Security' && (
            <SecurityView
              user={user}
              onOpenAuth={() => setIsAuthModalOpen(true)}
            />
          )}

          {activePage === 'Admin' && (
            <AdminView
              user={user}
              onOpenAuth={() => setIsAuthModalOpen(true)}
            />
          )}

          {/* Academic Footer */}
          <footer className="mt-12 flex flex-col justify-between gap-2 border-t border-slate-200 py-6 text-xs text-slate-400 sm:flex-row">
            <p>PrivacyMesh · Confidential Computing for Sensitive Data Workloads</p>
            <p>Academic Design & Research Prototype · Not a Production Financial System</p>
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
