'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { getMe } from '@/lib/api';
import { storeAuthData } from '@/lib/auth';

export default function AuthCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { login } = useAuth();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');

    if (!token) {
      setStatus('error');
      setErrorMsg('No token received from server.');
      return;
    }

    // Store token temporarily so the API client can use it
    localStorage.setItem('auth_token', token);

    // Fetch full user profile with the new token
    getMe()
      .then((user) => {
        storeAuthData(token, user);
        login(token, user);
        router.replace('/dashboard');
      })
      .catch((err) => {
        console.error('Failed to fetch user after OAuth:', err);
        localStorage.removeItem('auth_token');
        setStatus('error');
        setErrorMsg('Could not verify your session. Please try again.');
      });
  }, [searchParams, login, router]);

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <p className="text-red-400">{errorMsg}</p>
          <button
            onClick={() => router.push('/login')}
            className="btn-primary"
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-white/50 text-sm">Completing sign-in...</p>
      </div>
    </div>
  );
}
