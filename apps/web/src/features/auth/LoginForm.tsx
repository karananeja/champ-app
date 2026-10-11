import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { loginSchema, type LoginInput } from '@champ/shared';
import { FieldError } from '@/components/FieldError';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/PasswordInput';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';

interface Props {
  onSubmit: (values: LoginInput) => Promise<unknown>;
}

export function LoginForm({ onSubmit }: Props) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  });

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4">
      {serverError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@intellicar.in"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
          {...register('email')}
        />
        <FieldError id="email-error" message={errors.email?.message} />
      </div>
      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'password-error' : undefined}
          {...register('password')}
        />
        <FieldError id="password-error" message={errors.password?.message} />
      </div>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" />}
        Sign in
      </Button>
    </form>
  );
}
