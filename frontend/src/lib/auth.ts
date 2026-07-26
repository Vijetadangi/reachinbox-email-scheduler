import { User } from '@/types';

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

export function getStoredUser(): User | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function storeAuthData(token: string, user: User): void {
  localStorage.setItem('auth_token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

export function clearAuthData(): void {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('user');
}

export function isAuthenticated(): boolean {
  return !!getStoredToken();
}
