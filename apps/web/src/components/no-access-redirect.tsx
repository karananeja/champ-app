import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';

export const NO_ACCESS_MESSAGE = "You don't have access to that page";

/** Sends the user to the dashboard with a "no access" toast (deduplicated by id, e.g. under StrictMode). */
export function NoAccessRedirect() {
  useEffect(() => {
    toast.error(NO_ACCESS_MESSAGE, { id: 'no-access' });
  }, []);
  return <Navigate to="/" replace />;
}
