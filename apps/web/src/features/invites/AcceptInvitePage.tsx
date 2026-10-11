import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { z } from 'zod';
import {
  ROLE_LABELS,
  nameSchema,
  passwordSchema,
  phoneSchema,
  type AuthResponse,
  type InviteLookupResponse,
} from '@champ/shared';
import { FieldError } from '@/components/FieldError';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { PasswordInput } from '@/components/PasswordInput';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAppConfig } from '@/lib/config';
import { AuthLayout } from '../auth/AuthLayout';

const formSchema = z
  .object({
    name: nameSchema,
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
type FormValues = z.infer<typeof formSchema>;

const INVITE_ERRORS: Record<string, { title: string; message: string }> = {
  INVITE_EXPIRED: {
    title: 'This invite has expired',
    message: 'Invite links are valid for 72 hours. Ask the person who invited you to send a new one.',
  },
  INVITE_USED: {
    title: 'This invite has already been used',
    message: 'An account was already created with this link. Sign in instead.',
  },
  INVITE_INVALID: {
    title: 'This invite link is not valid',
    message: 'The link may be incomplete or was replaced by a newer invite. Ask for a new one.',
  },
};

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const lookup = useQuery({
    queryKey: ['invite-lookup', token],
    queryFn: () => api<InviteLookupResponse>('/invites/lookup', { query: { token } }),
    enabled: !!token,
    retry: false,
  });

  if (!token) return <InviteError code="INVITE_INVALID" />;
  if (lookup.isPending) return <FullPageSpinner />;
  if (lookup.isError) {
    const code = lookup.error instanceof ApiError ? lookup.error.code : 'INVITE_INVALID';
    return <InviteError code={code} />;
  }
  return <AcceptInviteForm token={token} invite={lookup.data} />;
}

function InviteError({ code }: { code: string }) {
  const error = INVITE_ERRORS[code] ?? {
    title: 'Could not open this invite',
    message: 'Please try again in a moment.',
  };
  return (
    <AuthLayout title="Accept invite">
      <div className="grid grid-cols-1 gap-4">
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertTitle>{error.title}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </div>
    </AuthLayout>
  );
}

function AcceptInviteForm({ token, invite }: { token: string; invite: InviteLookupResponse }) {
  const navigate = useNavigate();
  const { startSession } = useAuth();
  const { data: config } = useAppConfig();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    // Technician invites carry the name and phone entered by the inviter.
    defaultValues: { name: invite.name ?? '', phone: invite.phone ?? '', password: '', confirmPassword: '' },
  });

  const finish = (session: AuthResponse) => {
    startSession(session);
    navigate('/', { replace: true });
  };

  const handleError = (err: unknown) => {
    if (err instanceof ApiError) {
      for (const [field, messages] of Object.entries(err.fieldErrors)) {
        if (messages?.[0]) setError(field as keyof FormValues, { message: messages[0] });
      }
      setServerError(err.message);
    } else {
      setServerError('Something went wrong. Please try again.');
    }
  };

  const submit = handleSubmit(async ({ name, phone, password }) => {
    setServerError(null);
    try {
      finish(await api<AuthResponse>('/invites/accept', { method: 'POST', body: { token, name, phone, password } }));
    } catch (err) {
      handleError(err);
    }
  });

  const acceptWithGoogle = async (idToken: string) => {
    setServerError(null);
    try {
      finish(await api<AuthResponse>('/invites/accept/google', { method: 'POST', body: { token, idToken } }));
    } catch (err) {
      handleError(err);
    }
  };

  const field = (name: keyof FormValues) => ({
    id: name,
    'aria-invalid': !!errors[name],
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
    ...register(name),
  });

  return (
    <AuthLayout
      title="Set up your account"
      description={
        <>
          {invite.inviterName} invited <span className="font-medium text-foreground">{invite.email}</span> to join
          Champ as {ROLE_LABELS[invite.role]}.
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4">
        {serverError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-2">
          <Label htmlFor="name">Full name</Label>
          <Input autoComplete="name" {...field('name')} />
          <FieldError id="name-error" message={errors.name?.message} />
        </div>
        <div className="grid grid-cols-1 gap-2">
          <Label htmlFor="phone">Phone</Label>
          <Input type="tel" autoComplete="tel" placeholder="+91 98765 43210" {...field('phone')} />
          <FieldError id="phone-error" message={errors.phone?.message} />
        </div>
        <div className="grid grid-cols-1 gap-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput autoComplete="new-password" {...field('password')} />
          <p className="text-xs text-muted-foreground">At least 8 characters, with a letter and a number.</p>
          <FieldError id="password-error" message={errors.password?.message} />
        </div>
        <div className="grid grid-cols-1 gap-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <PasswordInput autoComplete="new-password" {...field('confirmPassword')} />
          <FieldError id="confirmPassword-error" message={errors.confirmPassword?.message} />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          Create account
        </Button>
        {config?.googleClientId && (
          <>
            <div className="relative text-center text-xs uppercase text-muted-foreground">
              <span className="relative z-10 bg-card px-2">or</span>
              <div className="absolute inset-x-0 top-1/2 border-t" />
            </div>
            <GoogleSignInButton clientId={config.googleClientId} text="continue_with" onCredential={acceptWithGoogle} />
          </>
        )}
      </form>
    </AuthLayout>
  );
}
