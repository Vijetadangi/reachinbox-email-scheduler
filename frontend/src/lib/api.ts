import axios, { AxiosInstance, AxiosError } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: API_URL,
    timeout: 15000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Attach JWT from localStorage on every request
  client.interceptors.request.use((config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('auth_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  });

  // Handle 401 globally — clear token and redirect to login
  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      if (error.response?.status === 401) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('user');
          window.location.href = '/login';
        }
      }
      return Promise.reject(error);
    }
  );

  return client;
}

export const apiClient = createApiClient();

// ---- Auth ----

export async function getMe() {
  const res = await apiClient.get('/api/auth/me');
  return res.data;
}

export async function loginWithGoogleToken(idToken: string) {
  const res = await apiClient.post('/api/auth/google/token', { idToken });
  return res.data as { token: string; user: { id: string; email: string; name: string; avatarUrl: string | null } };
}

export async function logout() {
  await apiClient.post('/api/auth/logout');
}

// ---- Emails ----

export async function fetchScheduledEmails(page = 1, limit = 20) {
  const res = await apiClient.get(`/api/emails/scheduled?page=${page}&limit=${limit}`);
  return res.data;
}

export async function fetchSentEmails(page = 1, limit = 20) {
  const res = await apiClient.get(`/api/emails/sent?page=${page}&limit=${limit}`);
  return res.data;
}

export async function scheduleSingleEmail(data: {
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: string;
  senderId?: string;
}) {
  const res = await apiClient.post('/api/emails/schedule', data);
  return res.data;
}

export async function scheduleBulkEmails(formData: FormData) {
  const res = await apiClient.post('/api/emails/schedule/bulk', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

export async function parseCsv(file: File): Promise<{ emails: string[]; count: number; preview: string[] }> {
  const formData = new FormData();
  formData.append('csv', file);
  const res = await apiClient.post('/api/emails/parse-csv', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

export async function cancelEmail(jobId: string) {
  const res = await apiClient.delete(`/api/emails/${jobId}`);
  return res.data;
}

export async function getQueueStats() {
  const res = await apiClient.get('/api/emails/stats/queue');
  return res.data.stats;
}

// ---- Senders ----

export async function fetchSenders() {
  const res = await apiClient.get('/api/senders');
  return res.data.senders;
}

export async function createSender(data: { name?: string; email?: string }) {
  const res = await apiClient.post('/api/senders', data);
  return res.data.sender;
}

export async function deleteSender(senderId: string) {
  const res = await apiClient.delete(`/api/senders/${senderId}`);
  return res.data;
}
