import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { signup } from '@/api/auth';
import { Button } from '@/components/ui/Button';
import type { ApiErrorShape } from '@/api/types';

export function SignupPage() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string }>({ defaultValues: { email: '' } });

  const onSubmit = async ({ email }: { email: string }) => {
    setError(null);
    try {
      await signup(email.trim());
      setSubmitted(true);
    } catch (err) {
      setError((err as ApiErrorShape).message || 'Request failed.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#0E1116] text-white">
      <div className="w-full max-w-sm">
        <h2 className="text-2xl font-bold text-center mb-2">Request access</h2>
        <p className="text-sm text-white/60 text-center mb-8">
          Submit your work email. An admin will provision your account.
        </p>

        {submitted ? (
          <div className="bg-white/5 border border-white/10 rounded-lg p-5 text-sm">
            Your request has been submitted. An administrator will contact you once approved.
            <Link to="/login" className="mt-5 block text-primary hover:underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {error && (
              <div className="text-xs px-3 py-2 rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/30">
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs text-white/60 font-medium mb-1.5">Work email</label>
              <input
                type="email"
                placeholder="you@valerionhealth.com"
                className="w-full h-11 px-3.5 bg-white/5 border border-white/10 rounded-pill text-sm text-white placeholder:text-white/30 focus:border-primary focus:outline-none transition"
                {...register('email', {
                  required: 'Email required',
                  pattern: { value: /^\S+@\S+\.\S+$/, message: 'Invalid email' },
                })}
              />
              {errors.email && <p className="mt-1 text-xs text-rose-300">{errors.email.message}</p>}
            </div>
            <Button type="submit" loading={isSubmitting} className="w-full h-11">
              Request access
            </Button>
            <p className="text-[11px] text-white/40 text-center">
              Already have an account?{' '}
              <Link to="/login" className="text-primary hover:underline">Sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
