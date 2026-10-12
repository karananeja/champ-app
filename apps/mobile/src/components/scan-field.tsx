import { extractTextFromImage } from 'expo-text-extractor';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { discardFile, type SourceImage } from '../lib/photo-pipeline';
import { textCandidates } from '../lib/text-candidates';
import { useTheme } from '../theme/use-theme';
import { CameraModal } from './camera-modal';
import { Button, TextField } from './ui';

/**
 * A text field with *Scan* (F10B §6.1, D-023). *Scan* opens the camera: the first barcode or QR code read is offered
 * for confirmation; *Read text* takes a picture and lists the id-like lines it recognised to pick from. The chosen
 * value goes into the field (and `onBlur` fires, so a form that saves on blur saves it); it stays editable.
 */
export function ScanField({
  label,
  value,
  onChange,
  onBlur,
  required,
  error,
  disabled,
  testID = 'scan-field',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [reading, setReading] = useState(false);

  const close = () => {
    setOpen(false);
    setCode(null);
    setCandidates(null);
  };

  const accept = (v: string) => {
    close();
    onChange(v);
    // Let the parent's state take the new value before its save-on-blur runs.
    if (onBlur) setTimeout(onBlur, 0);
  };

  const readText = async (pic: SourceImage) => {
    setReading(true);
    try {
      const lines = await extractTextFromImage(pic.uri);
      setCandidates(textCandidates(lines));
    } catch {
      setCandidates([]);
    } finally {
      discardFile(pic.uri);
      setReading(false);
    }
  };

  return (
    <View testID={testID}>
      <TextField
        testID={`${testID}-input`}
        label={required ? `${label} *` : label}
        value={value}
        onChangeText={onChange}
        onBlur={onBlur}
        editable={!disabled}
        autoCapitalize="characters"
        autoCorrect={false}
        error={error}
        right={
          disabled ? undefined : (
            <Pressable
              testID={`${testID}-scan`}
              accessibilityRole="button"
              accessibilityLabel={`Scan ${label.toLowerCase()}`}
              onPress={() => setOpen(true)}
              hitSlop={8}
              style={styles.scan}
            >
              <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>Scan</Text>
            </Pressable>
          )
        }
      />

      <CameraModal
        visible={open}
        mode="scan"
        onClose={close}
        onBarcode={setCode}
        onPicture={(pic) => void readText(pic)}
        paused={code != null || candidates != null}
        busy={reading}
        testID={`${testID}-camera`}
        overlay={
          code != null ? (
            <View testID={`${testID}-confirm`} style={styles.panel}>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
                Use this code?
              </Text>
              <Text selectable style={[styles.code, { color: colors.foreground }]}>
                {code}
              </Text>
              <Button title="Use code" onPress={() => accept(code)} testID={`${testID}-use-code`} />
              <Button title="Scan again" variant="ghost" onPress={() => setCode(null)} testID={`${testID}-scan-again`} />
            </View>
          ) : candidates != null ? (
            <ScrollView testID={`${testID}-candidates`} contentContainerStyle={styles.panel}>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
                {candidates.length ? 'Pick the id' : 'No id found'}
              </Text>
              {candidates.length ? (
                candidates.map((c, i) => (
                  <Pressable
                    key={c}
                    testID={`${testID}-candidate-${i}`}
                    accessibilityRole="button"
                    onPress={() => accept(c)}
                    style={[styles.candidate, { borderColor: colors.border }]}
                  >
                    <Text style={[styles.candidateText, { color: colors.foreground }]}>{c}</Text>
                  </Pressable>
                ))
              ) : (
                <Text style={{ color: colors.mutedForeground }}>
                  No id-like text was read. Hold the label flat and well lit, then try again.
                </Text>
              )}
              <Button title="Try again" variant="ghost" onPress={() => setCandidates(null)} testID={`${testID}-try-again`} />
            </ScrollView>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scan: { paddingLeft: 12, paddingVertical: 8 },
  panel: { gap: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  code: { fontSize: 20, fontWeight: '700' },
  candidate: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12 },
  candidateText: { fontSize: 17, fontWeight: '600', letterSpacing: 0.5 },
});
