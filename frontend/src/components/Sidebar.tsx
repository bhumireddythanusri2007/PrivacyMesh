import type { FC, ReactNode } from 'react'
import type { UserRole } from '../types'
import {
  DashboardIcon,
  TransactionsIcon,
  KYCIcon,
  SecurityIcon,
  AdminIcon,
  LogoutIcon,
  CpuChipIcon,
  ActivityIcon,
} from './Icons'

export type NavigationPage =
  | 'Dashboard'
  | 'My KYC'
  | 'Assigned Cases'
  | 'Case Management'
  | 'User Management'
  | 'Security'
  | 'Monitoring'
  | 'Transactions'
  | 'KYC Records'
  | 'Admin'

interface SidebarProps {
  activePage: NavigationPage
  setActivePage: (page: NavigationPage) => void
  user: { id: number; username: string; role: UserRole } | null
  onLogout: () => void
  isOpenMobile: boolean
  setIsOpenMobile: (open: boolean) => void
}

interface NavItem {
  name: NavigationPage
  icon: ReactNode
  badge?: string
}

const getNavItemsForRole = (role?: UserRole): NavItem[] => {
  switch (role) {
    case 'customer':
      return [
        { name: 'Dashboard', icon: <DashboardIcon /> },
        { name: 'My KYC', icon: <KYCIcon /> },
        { name: 'Security', icon: <SecurityIcon /> },
        { name: 'Monitoring', icon: <ActivityIcon /> },
      ]
    case 'bank_employee':
      return [
        { name: 'Dashboard', icon: <DashboardIcon /> },
        { name: 'Assigned Cases', icon: <KYCIcon /> },
        { name: 'Security', icon: <SecurityIcon /> },
        { name: 'Monitoring', icon: <ActivityIcon /> },
      ]
    case 'bank_manager':
      return [
        { name: 'Dashboard', icon: <DashboardIcon /> },
        { name: 'Case Management', icon: <KYCIcon /> },
        { name: 'Security', icon: <SecurityIcon /> },
        { name: 'Monitoring', icon: <ActivityIcon /> },
      ]
    case 'system_admin':
      return [
        { name: 'Dashboard', icon: <DashboardIcon /> },
        { name: 'User Management', icon: <AdminIcon />, badge: 'Admin' },
        { name: 'Security', icon: <SecurityIcon /> },
        { name: 'Monitoring', icon: <ActivityIcon /> },
      ]
    case 'admin':
      // Legacy admin compatibility
      return [
        { name: 'Dashboard', icon: <DashboardIcon /> },
        { name: 'User Management', icon: <AdminIcon />, badge: 'Admin' },
        { name: 'Security', icon: <SecurityIcon /> },
        { name: 'Monitoring', icon: <ActivityIcon /> },
      ]
    case 'user':
      // Legacy user compatibility
      return [
        { name: 'Dashboard', icon: <DashboardIcon /> },
        { name: 'Transactions', icon: <TransactionsIcon /> },
        { name: 'Security', icon: <SecurityIcon /> },
        { name: 'Monitoring', icon: <ActivityIcon /> },
      ]
    default:
      // Guest or unsupported role: safe baseline navigation only
      return [
        { name: 'Dashboard', icon: <DashboardIcon /> },
        { name: 'Security', icon: <SecurityIcon /> },
        { name: 'Monitoring', icon: <ActivityIcon /> },
      ]
  }
}

const formatRoleLabel = (role: UserRole): string => {
  switch (role) {
    case 'customer':
      return 'Customer'
    case 'bank_employee':
      return 'Bank Employee'
    case 'bank_manager':
      return 'Bank Manager'
    case 'system_admin':
      return 'System Admin'
    case 'admin':
      return 'Admin'
    case 'user':
      return 'User'
    case 'pending_review':
      return 'Pending Review'
    default:
      return String(role).replace(/_/g, ' ')
  }
}

const getRoleBadgeClass = (role: UserRole): string => {
  switch (role) {
    case 'system_admin':
    case 'admin':
      return 'text-purple-600'
    case 'bank_manager':
      return 'text-indigo-600'
    case 'bank_employee':
      return 'text-blue-600'
    case 'customer':
      return 'text-emerald-600'
    default:
      return 'text-slate-500'
  }
}

export const Sidebar: FC<SidebarProps> = ({
  activePage,
  setActivePage,
  user,
  onLogout,
  isOpenMobile,
  setIsOpenMobile,
}) => {
  const visibleNavItems = getNavItemsForRole(user?.role)

  const handleNavClick = (page: NavigationPage) => {
    setActivePage(page)
    setIsOpenMobile(false)
  }

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Brand Header */}
      <div className="flex h-20 items-center gap-3 border-b border-slate-100 px-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-700 text-xl font-bold text-white shadow-sm shadow-blue-500/30">
          P
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-slate-900">PrivacyMesh</h1>
          <p className="text-xs font-medium text-slate-500">Confidential Banking</p>
        </div>
      </div>

      {/* Nav List */}
      <div className="px-4 pt-6">
        <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Workspace
        </p>
        <nav className="space-y-1">
          {visibleNavItems.map((item) => {
            const isActive = activePage === item.name
            return (
              <button
                key={item.name}
                type="button"
                onClick={() => handleNavClick(item.name)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold shadow-xs'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className={`w-5 ${isActive ? 'text-blue-700' : 'text-slate-400'}`}>
                  {item.icon}
                </span>
                <span className="flex-1">{item.name}</span>
                {item.name === 'Security' && (
                  <span className="h-2 w-2 rounded-full bg-emerald-500" title="Security controls active" />
                )}
                {item.badge && (
                  <span className="rounded-sm bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 uppercase">
                    {item.badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Footer Info Box & User Badge */}
      <div className="mt-auto p-4 space-y-4">
        <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
          <div className="mb-1.5 flex items-center gap-2 text-xs font-bold text-blue-900">
            <CpuChipIcon className="w-4 h-4 text-blue-600" />
            <span>Confidential Computing</span>
          </div>
          <p className="text-[11px] leading-4 text-blue-800">
            Application security controls include authentication, role-based access, and account-level data isolation. Hardware TEE integration is planned.
          </p>
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Application Controls Active
          </div>
        </div>

        {user ? (
          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
                {user.username.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-800">{user.username}</p>
                <span className={`inline-block text-[10px] uppercase font-bold tracking-wider ${getRoleBadgeClass(user.role)}`}>
                  {formatRoleLabel(user.role)}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
              title="Sign out"
            >
              <LogoutIcon className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="border-t border-slate-100 pt-3 text-center">
            <p className="text-xs text-slate-500">Not authenticated</p>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-slate-200 bg-white lg:block">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Overlay */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs lg:hidden"
          onClick={() => setIsOpenMobile(false)}
        >
          <div
            className="fixed inset-y-0 left-0 w-64 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  )
}
