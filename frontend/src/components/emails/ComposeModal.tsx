'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Upload, Users, User, ChevronDown, AlertCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { cn } from '@/lib/utils';
import { parseCsv, scheduleSingleEmail, scheduleBulkEmails, fetchSenders, createSender } from '@/lib/api';
import { EmailSender } from '@/types';
import { showToast } from '@/components/ui/Toaster';
import { Spinner } from '@/components/ui/Spinner';

const schema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  recipientEmail: z.string().email('Invalid email').optional().or(z.literal('')),
  scheduledAt: z.string().min(1, 'Schedule time is required'),
  senderId: z.string().optional(),
  delayBetweenEmailsMs: z.number().min(0).default(2000),
  hourlyLimit: z.number().min(1).optional(),
});

type FormValues = z.infer<typeof schema>;

type RecipientMode = 'single' | 'bulk';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ComposeModal({ open, onClose, onSuccess }: Props) {
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('single');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsedEmails, setParsedEmails] = useState<string[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [senders, setSenders] = useState<EmailSender[]>([]);
  const [isCreatingSender, setIsCreatingSender] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      delayBetweenEmailsMs: 2000,
      hourlyLimit: 50,
    },
  });

  // Load senders on open
  useEffect(() => {
    if (open) {
      fetchSenders()
        .then(setSenders)
        .catch(() => {});
    }
  }, [open]);

  // Compute minimum datetime (now + 1 minute)
  const minDatetime = new Date(Date.now() + 60000).toISOString().slice(0, 16);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFile(file);
    setIsParsing(true);

    try {
      const result = await parseCsv(file);
      setParsedEmails(result.emails);
      if (result.count === 0) {
        showToast('No valid email addresses found in the file', 'error');
      } else {
        showToast(`Found ${result.count} email address${result.count !== 1 ? 'es' : ''}`, 'success');
      }
    } catch {
      showToast('Failed to parse CSV file', 'error');
      setCsvFile(null);
    } finally {
      setIsParsing(false);
    }
  };

  const handleCreateSender = async () => {
    setIsCreatingSender(true);
    try {
      const newSender = await createSender({});
      setSenders((prev) => [...prev, newSender]);
      setValue('senderId', newSender.id);
      showToast(`New sender created: ${newSender.email}`, 'success');
    } catch {
      showToast('Failed to create sender', 'error');
    } finally {
      setIsCreatingSender(false);
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (recipientMode === 'bulk' && parsedEmails.length === 0) {
      showToast('Please upload a CSV with at least one email address', 'error');
      return;
    }

    if (recipientMode === 'single' && !values.recipientEmail) {
      showToast('Please enter a recipient email address', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      if (recipientMode === 'single') {
        await scheduleSingleEmail({
          recipientEmail: values.recipientEmail!,
          subject: values.subject,
          body: values.body,
          scheduledAt: new Date(values.scheduledAt).toISOString(),
          senderId: values.senderId,
        });
        showToast('Email scheduled successfully', 'success');
      } else {
        const formData = new FormData();
        formData.append('subject', values.subject);
        formData.append('body', values.body);
        formData.append('startTime', new Date(values.scheduledAt).toISOString());
        formData.append('delayBetweenEmailsMs', values.delayBetweenEmailsMs.toString());
        if (values.hourlyLimit) {
          formData.append('hourlyLimit', values.hourlyLimit.toString());
        }
        if (values.senderId) {
          formData.append('senderId', values.senderId);
        }
        if (csvFile) {
          formData.append('csv', csvFile);
        } else {
          formData.append('recipients', JSON.stringify(parsedEmails));
        }

        const result = await scheduleBulkEmails(formData);
        showToast(
          `Bulk campaign created: ${result.campaign.scheduled_count} emails scheduled`,
          'success'
        );
      }

      reset();
      setCsvFile(null);
      setParsedEmails([]);
      onSuccess();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to schedule email';
      showToast(msg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    reset();
    setCsvFile(null);
    setParsedEmails([]);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Compose email"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-[#12172b] rounded-2xl border border-white/10 shadow-2xl overflow-y-auto max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <h2 className="text-xl font-semibold text-white">Compose Email</h2>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="text-white/40 hover:text-white/70 transition-colors p-1 rounded"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">
          {/* Recipient mode toggle */}
          <div>
            <label className="label">Recipients</label>
            <div className="flex gap-2 p-1 bg-white/5 rounded-xl">
              <button
                type="button"
                onClick={() => setRecipientMode('single')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors duration-200',
                  recipientMode === 'single'
                    ? 'bg-indigo-600 text-white'
                    : 'text-white/50 hover:text-white/70'
                )}
              >
                <User className="w-4 h-4" />
                Single
              </button>
              <button
                type="button"
                onClick={() => setRecipientMode('bulk')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors duration-200',
                  recipientMode === 'bulk'
                    ? 'bg-indigo-600 text-white'
                    : 'text-white/50 hover:text-white/70'
                )}
              >
                <Users className="w-4 h-4" />
                Bulk CSV
              </button>
            </div>
          </div>

          {/* Single recipient */}
          {recipientMode === 'single' && (
            <div>
              <label htmlFor="recipientEmail" className="label">To</label>
              <input
                id="recipientEmail"
                type="email"
                placeholder="recipient@example.com"
                className="input"
                {...register('recipientEmail')}
              />
              {errors.recipientEmail && (
                <FieldError message={errors.recipientEmail.message} />
              )}
            </div>
          )}

          {/* Bulk CSV upload */}
          {recipientMode === 'bulk' && (
            <div>
              <label className="label">Upload CSV</label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
                  csvFile
                    ? 'border-indigo-500/50 bg-indigo-500/5'
                    : 'border-white/10 hover:border-white/20'
                )}
              >
                {isParsing ? (
                  <div className="flex flex-col items-center gap-2">
                    <Spinner />
                    <p className="text-white/50 text-sm">Parsing emails...</p>
                  </div>
                ) : csvFile ? (
                  <div className="space-y-1">
                    <p className="text-white font-medium text-sm">{csvFile.name}</p>
                    <p className="text-indigo-400 text-sm font-medium">
                      {parsedEmails.length} valid email{parsedEmails.length !== 1 ? 's' : ''} detected
                    </p>
                    {parsedEmails.length > 0 && (
                      <p className="text-white/30 text-xs">
                        Preview: {parsedEmails.slice(0, 3).join(', ')}
                        {parsedEmails.length > 3 && ` +${parsedEmails.length - 3} more`}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="w-8 h-8 text-white/20 mx-auto" />
                    <p className="text-white/50 text-sm">
                      Click to upload a CSV file
                    </p>
                    <p className="text-white/25 text-xs">
                      CSV with an "email" column, or a plain list of addresses
                    </p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            </div>
          )}

          {/* Subject */}
          <div>
            <label htmlFor="subject" className="label">Subject</label>
            <input
              id="subject"
              type="text"
              placeholder="Your email subject"
              className="input"
              {...register('subject')}
            />
            {errors.subject && <FieldError message={errors.subject.message} />}
          </div>

          {/* Body */}
          <div>
            <label htmlFor="body" className="label">Message</label>
            <textarea
              id="body"
              rows={5}
              placeholder="Write your email body here. HTML is supported."
              className="input resize-none"
              {...register('body')}
            />
            {errors.body && <FieldError message={errors.body.message} />}
          </div>

          {/* Schedule time */}
          <div>
            <label htmlFor="scheduledAt" className="label">
              {recipientMode === 'bulk' ? 'Start sending at' : 'Send at'}
            </label>
            <input
              id="scheduledAt"
              type="datetime-local"
              min={minDatetime}
              className="input"
              {...register('scheduledAt')}
            />
            {errors.scheduledAt && <FieldError message={errors.scheduledAt.message} />}
          </div>

          {/* Bulk-only options */}
          {recipientMode === 'bulk' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="delayBetweenEmailsMs" className="label">
                  Delay between sends (ms)
                </label>
                <input
                  id="delayBetweenEmailsMs"
                  type="number"
                  min={0}
                  step={500}
                  className="input"
                  {...register('delayBetweenEmailsMs', { valueAsNumber: true })}
                />
                <p className="text-white/30 text-xs mt-1">Min 2000ms recommended</p>
              </div>
              <div>
                <label htmlFor="hourlyLimit" className="label">
                  Hourly limit (per sender)
                </label>
                <input
                  id="hourlyLimit"
                  type="number"
                  min={1}
                  className="input"
                  {...register('hourlyLimit', { valueAsNumber: true })}
                />
                <p className="text-white/30 text-xs mt-1">Overflow is queued next hour</p>
              </div>
            </div>
          )}

          {/* Sender selection */}
          <div>
            <label className="label">Send from</label>
            <div className="flex gap-2">
              <select
                className="input flex-1"
                {...register('senderId')}
              >
                <option value="">Default Ethereal account</option>
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.email})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleCreateSender}
                disabled={isCreatingSender}
                className="btn-secondary text-sm py-2 px-3 whitespace-nowrap"
              >
                {isCreatingSender ? <Spinner size="sm" /> : '+ New'}
              </button>
            </div>
            <p className="text-white/30 text-xs mt-1">
              Each sender is a separate Ethereal test account
            </p>
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (recipientMode === 'bulk' && parsedEmails.length === 0)}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Spinner size="sm" />
                  Scheduling...
                </>
              ) : (
                `Schedule${recipientMode === 'bulk' && parsedEmails.length > 0 ? ` (${parsedEmails.length})` : ''}`
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1 text-red-400 text-xs mt-1">
      <AlertCircle className="w-3 h-3" />
      {message}
    </p>
  );
}
