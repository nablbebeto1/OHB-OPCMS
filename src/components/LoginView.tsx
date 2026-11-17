import React, {useState} from 'react';
import {AlertCircle, Lock, ShieldCheck, UserCheck} from 'lucide-react';
import {apiRequest, ApiError} from '../lib/api';
import type {UserProfile} from '../types/opcms';

interface LoginResponse {
  access_token: string;
  token_type: string;
  user: UserProfile;
}

const DEMO_ACCOUNTS = [
  {
    username: 'admin.ohb',
    role: 'Regional System Administrator',
    scope: 'Full Oromia Region · Users, Hierarchy, Reopen Locked Reports',
  },
  {
    username: 'coord.ohb',
    role: 'Regional Coordination Team',
    scope: 'Full Oromia Region · Review, Approve, Formula Audit Sign-Off',
  },
  {
    username: 'zone.eastshewa',
    role: 'Zone Administrator',
    scope: 'East Shewa Zone (13 Woredas) · Review & Approve Zone Reports',
  },
  {
    username: 'woreda.adama',
    role: 'Woreda Reporting Officer',
    scope: 'Adama Woreda (East Shewa) · Daily Data Entry & Submission',
  },
  {
    username: 'monitor.ohb',
    role: 'Monitoring Officer (Read-Only)',
    scope: 'Regional Oversight · Read-Only Dashboards & Audit Logs',
  },
];

interface LoginViewProps {
  onLoginSuccess: (token: string, user: UserProfile) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({onLoginSuccess}) => {
  const [username, setUsername] = useState('admin.ohb');
  const [password, setPassword] = useState('OhbPolio@2026');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performLogin = async (uname: string, pwd: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({username: uname.trim(), password: pwd}),
      });
      onLoginSuccess(res.access_token, res.user);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Unable to connect to OPCMS server. Verify connectivity.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void performLogin(username, password);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      <header className="bg-[#485EA9] text-white border-b border-[#3A99CF]/40">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-white/10 border border-white/25 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-sky-200 tracking-wide">Oromia Health Bureau (OHB)</p>
              <h1 className="text-base font-bold text-white leading-tight">
                OHB Polio Campaign Management System
              </h1>
            </div>
          </div>
          <span className="hidden sm:inline text-xs text-sky-100">
            2026 Round 1 nOPV2 &amp; bOPV Co-administration SIA
          </span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left: Sign-In Form */}
          <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-8 flex flex-col justify-between">
            <div>
              <p className="text-xs font-bold text-[#485EA9]">Institutional Access</p>
              <h2 className="mt-1 text-2xl font-bold text-slate-900">Sign in to OPCMS</h2>
              <p className="mt-2 text-sm text-slate-600">
                Access regional, zonal, and woreda polio immunization reporting and quality control workflows.
              </p>

              {error && (
                <div className="mt-5 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="username" className="block text-xs font-bold text-slate-700 mb-1.5">
                    Username
                  </label>
                  <input
                    id="username"
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. admin.ohb"
                    className="w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#3A99CF] focus:outline-none focus:ring-2 focus:ring-[#3A99CF]/20"
                  />
                </div>
                <div>
                  <label htmlFor="password" className="block text-xs font-bold text-slate-700 mb-1.5">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#3A99CF] focus:outline-none focus:ring-2 focus:ring-[#3A99CF]/20"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-[#3A99CF] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#3185b5] disabled:opacity-60 transition-colors cursor-pointer"
                >
                  <Lock className="w-4 h-4" />
                  {loading ? 'Authenticating...' : 'Sign In'}
                </button>
              </form>
            </div>

            <div className="mt-6 pt-5 border-t border-slate-200 text-xs text-slate-500">
              Offline-ready PWA · IndexedDB local draft storage · Independent deployment without external AI dependencies.
            </div>
          </section>

          {/* Right: Role-Based Access Demonstration */}
          <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-8 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold text-[#D29441]">Role-Based Access Control (RBAC)</p>
                  <h2 className="mt-1 text-xl font-bold text-slate-900">
                    Authorized OHB Campaign Roles
                  </h2>
                </div>
                <span className="text-xs text-slate-500 tabular-nums">5 Standard Roles</span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Select any pre-configured account below to evaluate strict regional, zonal, and woreda data isolation. Default password: <code className="font-mono text-xs text-slate-800">OhbPolio@2026</code>
              </p>

              <div className="mt-5 divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
                {DEMO_ACCOUNTS.map((acct) => (
                  <div
                    key={acct.username}
                    className="p-3.5 bg-white hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <span>{acct.role}</span>
                        <span className="text-slate-400" aria-hidden="true">·</span>
                        <span className="font-mono text-xs font-normal text-[#485EA9]">{acct.username}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-600">{acct.scope}</p>
                    </div>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        setUsername(acct.username);
                        setPassword('OhbPolio@2026');
                        void performLogin(acct.username, 'OhbPolio@2026');
                      }}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#3A99CF] bg-white px-3 py-1.5 text-xs font-bold text-[#3A99CF] hover:bg-[#3A99CF] hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      Sign in as Role
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>Source Baseline: Day 1 CSV Template (28 Zones · 261 Woredas)</span>
              <span>Workflow: Draft → Submitted → Under Review → Approved / Returned</span>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white px-6 py-3 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2 max-w-full">
        <span>Oromia Health Bureau (OHB) · Polio Eradication Initiative</span>
        <span>OPCMS Foundation · November 2026 Campaign</span>
      </footer>
    </div>
  );
};
