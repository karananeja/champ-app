import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAppConfig } from '@/lib/config';
import { AuthLayout } from './auth-layout';
import { LoginForm } from './login-form';

export function LoginPage() {
  const { status, login, loginWithGoogle } = useAuth();
  const { data: config } = useAppConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const [googleError, setGoogleError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? '/';
  if (status === 'authenticated') return <Navigate to={from} replace />;

  const handleGoogle = async (idToken: string) => {
    setGoogleError(null);
    try {
      await loginWithGoogle(idToken);
      navigate(from, { replace: true });
    } catch (err) {
      setGoogleError(err instanceof ApiError ? err.message : 'Google sign-in failed.');
    }
  };

  return (
    <AuthLayout title="Sign in" description="Use your Champ account to continue.">
      <div className="grid grid-cols-1 gap-6">
        <LoginForm
          onSubmit={async (values) => {
            await login(values);
            navigate(from, { replace: true });
          }}
        />
        {config?.googleClientId && (
          <>
            <div className="relative text-center text-xs uppercase text-muted-foreground">
              <span className="relative z-10 bg-card px-2">or</span>
              <div className="absolute inset-x-0 top-1/2 border-t" />
            </div>
            {googleError && (
              <Alert variant="destructive">
                <AlertDescription>{googleError}</AlertDescription>
              </Alert>
            )}
            <GoogleSignInButton clientId={config.googleClientId} onCredential={handleGoogle} />
          </>
        )}
      </div>
    </AuthLayout>
  );
}
