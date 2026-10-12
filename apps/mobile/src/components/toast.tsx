import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/use-theme';

const ToastContext = createContext<(message: string) => void>(() => {});

/** A small toast-style banner for server errors (5xx) and short notices. */
export function ToastProvider({ children, bindShow }: { children: ReactNode; bindShow?: (show: (m: string) => void) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMessage(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 4000);
  }, []);
  useEffect(() => {
    bindShow?.(show);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [bindShow, show]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message ? <ToastView message={message} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ message }: { message: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 24 }]}>
      <View accessibilityRole="alert" style={[styles.toast, { backgroundColor: colors.foreground }]}>
        <Text style={{ color: colors.background, fontSize: 14 }}>{message}</Text>
      </View>
    </View>
  );
}

export const useToast = (): ((message: string) => void) => useContext(ToastContext);

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, maxWidth: 480 },
});
