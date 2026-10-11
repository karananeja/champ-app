import { useEffect, useRef } from 'react';

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (r: GoogleCredentialResponse) => void }): void;
      renderButton(el: HTMLElement, options: Record<string, unknown>): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let gisLoader: Promise<void> | null = null;

function loadGoogleIdentityServices(): Promise<void> {
  gisLoader ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoader = null;
      reject(new Error('Failed to load Google sign-in'));
    };
    document.head.appendChild(script);
  });
  return gisLoader;
}

interface Props {
  clientId: string;
  text?: 'signin_with' | 'continue_with';
  onCredential: (idToken: string) => void;
}

/** Renders the Google Identity Services button and reports the ID token. */
export function GoogleSignInButton({ clientId, text = 'signin_with', onCredential }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCredential);

  useEffect(() => {
    callbackRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleIdentityServices()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => callbackRef.current(response.credential),
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          theme: 'outline',
          size: 'large',
          text,
          width: containerRef.current.offsetWidth || 320,
        });
      })
      .catch(() => {
        // The password form still works; nothing else to do.
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, text]);

  return <div ref={containerRef} className="flex w-full justify-center" data-testid="google-signin" />;
}
