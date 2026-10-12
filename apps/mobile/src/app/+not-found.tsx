import { Redirect } from 'expo-router';

/** Unknown deep links go home; the guards in the root layout send signed-out users to sign-in. */
export default function NotFound() {
  return <Redirect href="/home" />;
}
