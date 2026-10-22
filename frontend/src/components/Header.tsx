import type { FC } from 'react'
import type { ActivePage, HealthStatus, UserRole } from '../types'
import { RefreshIcon } from './Icons'

interface HeaderProps {
  activePage: ActivePage
  user: { id: number; username: string; role: UserRole } | null
  health: HealthStatus | null
  dbHealth: HealthStatus | null
  isCheckingHealth: boolean
  onRefreshHealth: () => void
  onOpenMobileNav: () => void
  onOpenAuthModal?: () => void
}

export const Header: FC<HeaderProps> = ({
  activePage,
  user,
  health,
  dbHealth,
  isCheckingHealth,
  onRefreshHealth,
  onOpenMobileNav,
  onOpenAuthModal,
}) => {
  const isHealthy = health?.status === 'healthy' && dbHealth?.status === 'connected'

  return (
    <header className="sticky top-0 z-10 flex h-20 items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur-sm sm:px-8">
      <div className="flex items-center gap-3">
        {/* Mobile Hamburger Toggle */}
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="p-2 -ml-2 text-slate-600 hover:text-slate-900 md:hidden rounded-lg hover:bg-slate-100"
          aria-label="Open navigation menu"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            PrivacyMesh / Workspace
          </p>
          <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900">{activePage}</h2>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Real-time Backend & DB Health Indicator */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefreshHealth}
            disabled={isCheckingHealth}
            title="Refresh system health status"
            className="hidden sm:flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isCheckingHealth
                  ? 'bg-amber-400 animate-pulse'
                  : isHealthy
                  ? 'bg-emerald-500'
                  : 'bg-rose-500'
              }`}
            />
            <span>
              {isCheckingHealth
                ? 'Checking...'
                : isHealthy
                ? 'Backend: Healthy · DB: Connected'
                : 'API Unavailable'}
            </span>
            <RefreshIcon className={`w-3.5 h-3.5 text-slate-400 ${isCheckingHealth ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* User quick status or login button */}
        {!user && onOpenAuthModal && (
          <button
            type="button"
            onClick={onOpenAuthModal}
            className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-xs transition"
          >
            Sign In
          </button>
        )}
      </div>
    </header>
  )
}
