import { Redirect } from 'expo-router';
import { useSession } from '../lib/session';

/**
 * Entry route: sends the user where the session allows. Redirecting straight to a guarded screen (e.g. `/home` while
 * signed out) leaves a blank screen on a cold launch, because `Stack.Protected` refuses it.
 */
export default function Index() {
  const { status, needsHomeLocation } = useSession();
  // The root layout draws the spinner (loading) and the No connection screen (offline) on top.
  if (status === 'loading' || status === 'offline') return null;
  if (status === 'signed-out') return <Redirect href="/sign-in" />;
  return <Redirect href={needsHomeLocation ? '/onboarding/home-location' : '/home'} />;
}
