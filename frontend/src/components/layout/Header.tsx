'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Mail, LogOut, ChevronDown, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { logout as apiLogout } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Header() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await apiLogout();
    } catch {
      // Ignore API errors on logout
    } finally {
      logout();
      router.push('/login');
    }
  };

  return (
    <header className="bg-[#0d1117] border-b border-white/10 sticky top-0 z-40">
      <div className="container mx-auto px-4 max-w-7xl h-16 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Mail className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-semibold text-white">ReachInbox</span>
        </div>

        {/* User menu */}
        {user && (
          <div className="relative">
            <button
              onClick={() => setDropdownOpen((o) => !o)}
              className="flex items-center gap-3 hover:bg-white/5 rounded-xl px-3 py-2 transition-colors duration-200"
              aria-label="User menu"
            >
              {/* Avatar */}
              {user.avatarUrl ? (
                <Image
                  src={user.avatarUrl}
                  alt={user.name}
                  width={32}
                  height={32}
                  className="rounded-full ring-2 ring-indigo-500/30"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-indigo-600/30 flex items-center justify-center">
                  <User className="w-4 h-4 text-indigo-400" />
                </div>
              )}

              {/* Name + email */}
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium text-white leading-tight">{user.name}</p>
                <p className="text-xs text-white/40">{user.email}</p>
              </div>

              <ChevronDown
                className={cn(
                  'w-4 h-4 text-white/40 transition-transform duration-200',
                  dropdownOpen && 'rotate-180'
                )}
              />
            </button>

            {/* Dropdown */}
            {dropdownOpen && (
              <>
                {/* Backdrop */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setDropdownOpen(false)}
                />

                <div className="absolute right-0 top-full mt-2 w-56 card shadow-2xl z-20 overflow-hidden">
                  {/* User info */}
                  <div className="px-4 py-3 border-b border-white/10">
                    <p className="text-sm font-medium text-white truncate">{user.name}</p>
                    <p className="text-xs text-white/40 truncate">{user.email}</p>
                  </div>

                  {/* Actions */}
                  <div className="py-1">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors duration-200"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
