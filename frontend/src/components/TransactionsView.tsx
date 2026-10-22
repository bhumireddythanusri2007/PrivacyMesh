import { useEffect, useState, type FC, type FormEvent } from 'react'
import type { CreateTransactionPayload, Transaction, TransactionType, UserRole } from '../types'
import { createTransaction, fetchTransactions } from '../api'
import { formatCurrency } from '../utils'
import {
  CheckCircleIcon,
  PlusIcon,
  RefreshIcon,
  TransactionsIcon,
} from './Icons'

interface TransactionsViewProps {
  user: { id: number; username: string; role: UserRole } | null
  onOpenAuth: () => void
}

export const TransactionsView: FC<TransactionsViewProps> = ({ user, onOpenAuth }) => {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Creation form modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [txnType, setTxnType] = useState<TransactionType>('deposit')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const loadTransactions = async () => {
    if (!user) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchTransactions()
      setTransactions(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve transactions.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!user) return

    let active = true
    const fetchData = async () => {
      try {
        const data = await fetchTransactions()
        if (!active) return
        setTransactions(data)
      } catch (err: unknown) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to retrieve transactions.')
      }
    }
    void fetchData()

    return () => {
      active = false
    }
  }, [user])

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const trimmedAcc = accountId.trim()
    if (!trimmedAcc) {
      setFormError('Account identifier is required.')
      return
    }

    const parsedAmount = parseFloat(amount)
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setFormError('Amount must be a positive number greater than zero.')
      return
    }

    setIsSubmitting(true)
    try {
      const payload: CreateTransactionPayload = {
        account_id: trimmedAcc,
        amount: parsedAmount,
        transaction_type: txnType,
      }
      await createTransaction(payload)
      // Reset form and refresh list
      setAccountId('')
      setAmount('')
      setTxnType('deposit')
      setIsModalOpen(false)
      await loadTransactions()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Transaction submission failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!user) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center max-w-xl mx-auto shadow-xs">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
          <TransactionsIcon className="w-6 h-6" />
        </div>
        <h3 className="mt-4 text-base font-bold text-slate-900">Authentication Required</h3>
        <p className="mt-1.5 text-xs text-slate-600 leading-5">
          You must be authenticated with a valid JWT token to review or execute banking transactions.
        </p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="mt-5 rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition"
        >
          Sign In
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-slate-900">Banking Transactions</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Securely record and process deposit, withdrawal, and transfer workloads.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadTransactions}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
          >
            <RefreshIcon className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setFormError(null)
              setIsModalOpen(true)
            }}
            className="flex items-center gap-1.5 rounded-xl bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 transition"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            New Transaction
          </button>
        </div>
      </div>

      {/* Global Error Banner */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={loadTransactions} className="underline font-bold">
            Retry
          </button>
        </div>
      )}

      {/* Transactions Table Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="overflow-x-auto">
          {isLoading && transactions.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-500">Loading transactions...</div>
          ) : transactions.length === 0 ? (
            <div className="py-16 text-center text-slate-500">
              <p className="text-sm font-semibold text-slate-700">No Transactions Found</p>
              <p className="mt-1 text-xs text-slate-500">
                You have not initiated any transactions yet. Use the button above to record your first transaction.
              </p>
            </div>
          ) : (
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="pb-3 pr-4">Reference</th>
                  <th className="pb-3 pr-4">Account ID</th>
                  <th className="pb-3 pr-4">Type</th>
                  <th className="pb-3 pr-4">Amount</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map((txn) => (
                  <tr key={txn.id} className="hover:bg-slate-50/50 transition">
                    <td className="py-3.5 pr-4 font-mono text-xs font-bold text-slate-900">
                      TXN-{txn.id}
                    </td>
                    <td className="py-3.5 pr-4 text-xs font-medium text-slate-700">
                      {txn.account_id}
                    </td>
                    <td className="py-3.5 pr-4 text-xs capitalize text-slate-600">
                      {txn.transaction_type}
                    </td>
                    <td className="py-3.5 pr-4 text-xs font-bold text-slate-900">
                      <span className={txn.transaction_type === 'withdrawal' ? 'text-rose-600' : 'text-emerald-700'}>
                        {txn.transaction_type === 'withdrawal' ? '-' : '+'}
                        {formatCurrency(txn.amount)}
                      </span>
                    </td>
                    <td className="py-3.5 pr-4">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        <CheckCircleIcon className="w-3 h-3 text-emerald-600" />
                        {txn.status}
                      </span>
                    </td>
                    <td className="py-3.5 text-xs text-slate-400">
                      {new Date(txn.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-base font-bold text-slate-900">Record Transaction</h4>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Account Identifier
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ACC-1094-BANK"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Amount
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Transaction Type
                </label>
                <select
                  value={txnType}
                  onChange={(e) => setTxnType(e.target.value as TransactionType)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-hidden"
                >
                  <option value="deposit">Deposit</option>
                  <option value="withdrawal">Withdrawal</option>
                  <option value="transfer">Transfer</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 disabled:opacity-60 transition"
                >
                  {isSubmitting ? 'Recording...' : 'Submit Transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
