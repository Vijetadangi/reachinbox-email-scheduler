'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Mail, Zap, Shield, BarChart3 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      const messages: Record<string, string> = {
        oauth_denied: 'Google sign-in was cancelled.',
        invalid_code: 'Invalid authorization code.',
        token_exchange_failed: 'Could not complete sign-in. Please try again.',
        server_error: 'Something went wrong. Please try again.',
      };
      setError(messages[errorParam] || 'An error occurred during sign-in.');
    }
  }, [searchParams]);

  const handleGoogleLogin = () => {
    window.location.href = `${API_URL}/api/auth/google`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1117] flex">
      {/* Left: Branding panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-gradient-to-br from-indigo-900/40 via-purple-900/20 to-[#0d1117] border-r border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Mail className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-semibold text-white">ReachInbox</span>
        </div>

        <div className="space-y-8">
          <div>
            <h1 className="text-4xl font-bold text-white leading-tight mb-4">
              Scale your cold
              <br />
              email outreach
            </h1>
            <p className="text-white/50 text-lg leading-relaxed">
              Schedule, send, and track emails at scale with a production-grade
              queue backed by BullMQ and Redis.
            </p>
          </div>

          <div className="space-y-4">
            {[
              { icon: Zap, title: 'Reliable scheduling', desc: 'BullMQ delayed jobs survive server restarts' },
              { icon: Shield, title: 'Rate limiting built-in', desc: 'Per-sender and global limits with Redis counters' },
              { icon: BarChart3, title: 'Full visibility', desc: 'Track every email from scheduled to delivered' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3">
                <div className="w-8 h-8 bg-indigo-600/20 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <p className="text-white font-medium text-sm">{title}</p>
                  <p className="text-white/40 text-sm mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-white/20 text-sm">
          Built for the ReachInbox engineering assignment
        </p>
      </div>

      {/* Right: Login form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Mail className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-semibold text-white">ReachInbox</span>
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-bold text-white mb-2">Welcome back</h2>
            <p className="text-white/50">Sign in to your dashboard to get started.</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <button
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white text-gray-800 font-medium py-3 px-6 rounded-xl hover:bg-gray-50 transition-colors duration-200 shadow-lg"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <p className="mt-6 text-center text-white/30 text-xs">
            By continuing, you agree to our terms of service.
            <br />
            Emails are sent via Ethereal (fake SMTP — nothing is actually delivered).
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}
