'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { getMe } from '@/lib/api';
import { storeAuthData } from '@/lib/auth';

export default function AuthCallbackPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    // Read token from URL without useSearchParams (avoids Suspense requirement)
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setError('No token received from server.');
      return;
    }

    localStorage.setItem('auth_token', token);

    getMe()
      .then((user) => {
        storeAuthData(token, user);
        login(token, user);
        router.replace('/dashboard');
      })
      .catch(() => {
        localStorage.removeItem('auth_token');
        setError('Could not verify your session. Please try again.');
      });
  }, [login, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <p className="text-red-400">{error}</p>
          <button onClick={() => router.push('/login')} className="btn-primary">
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
