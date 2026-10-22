import { useState, type FC, type FormEvent } from 'react'
import { ApiError, loginUser, registerUser, tokenStorage, userStorage, getCurrentUser } from '../api'
import type { UserRole } from '../types'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (user: { id: number; username: string; role: UserRole }) => void
}

export const AuthModal: FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  if (!isOpen) return null

  const resetForm = () => {
    setUsername('')
    setPassword('')
    setConfirmPassword('')
    setError(null)
    setSuccessMsg(null)
  }

  const handleSwitchMode = (newMode: 'login' | 'register') => {
    setMode(newMode)
    resetForm()
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMsg(null)

    const trimmedUsername = username.trim()
    if (!trimmedUsername || trimmedUsername.length < 3) {
      setError('Username must be at least 3 characters long.')
      return
    }

    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }

    if (mode === 'register' && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setIsLoading(true)

    try {
      if (mode === 'register') {
        await registerUser(trimmedUsername, password)
        setSuccessMsg('Account registered successfully! Signing in...')
        // Auto sign-in after registration
        const authData = await loginUser(trimmedUsername, password)
        tokenStorage.set(authData.access_token)

        const me = await getCurrentUser()
        userStorage.set(me.user)
        onSuccess(me.user)
        onClose()
      } else {
        const authData = await loginUser(trimmedUsername, password)
        tokenStorage.set(authData.access_token)

        const me = await getCurrentUser()
        userStorage.set(me.user)
        onSuccess(me.user)
        onClose()
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.detail)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('An unexpected error occurred. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              {mode === 'login' ? 'Sign in to PrivacyMesh' : 'Create an Account'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {mode === 'login'
                ? 'Enter your credentials to access protected workloads'
                : 'Register as a standard banking workload participant'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Tab switch */}
        <div className="mt-5 flex rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => handleSwitchMode('login')}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
              mode === 'login'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => handleSwitchMode('register')}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
              mode === 'register'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Register
          </button>
        </div>

        {/* Notifications */}
        {error && (
          <div className="mt-4 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-medium text-rose-800">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-medium text-emerald-800">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Username
            </label>
            <input
              type="text"
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. alice_banking"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500 transition"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Confirm Password
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500 transition"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Notice: Public registration creates standard user accounts. Administrator permissions cannot be self-assigned.
              </p>
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-xl bg-blue-700 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-60 transition"
            >
              {isLoading ? 'Processing...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
