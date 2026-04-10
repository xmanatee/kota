import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDaemon } from '../context/DaemonContext';

type SettingsScreenProps = {
  navigation?: { goBack: () => void };
};

export function SettingsScreen({ navigation }: SettingsScreenProps) {
  const { state, saveSettings, setPushNotificationsEnabled } = useDaemon();
  const [url, setUrl] = useState(state.daemonUrl);
  const [token, setToken] = useState(state.token);
  const [saving, setSaving] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  useEffect(() => {
    setUrl(state.daemonUrl);
    setToken(state.token);
  }, [state.daemonUrl, state.token]);

  async function handleSave() {
    const trimmedUrl = url.trim().replace(/\/$/, '');
    const trimmedToken = token.trim();
    if (!trimmedUrl) {
      Alert.alert('Missing URL', 'Please enter the daemon URL.');
      return;
    }
    if (!trimmedToken) {
      Alert.alert('Missing Token', 'Please enter the auth token.');
      return;
    }
    setSaving(true);
    try {
      await saveSettings(trimmedUrl, trimmedToken);
      Alert.alert('Saved', 'Settings saved. Reconnecting…');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleScanPress() {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera Permission', 'Camera access is required to scan the QR code.');
        return;
      }
    }
    setScanned(false);
    setScannerOpen(true);
  }

  async function handleBarcodeScanned({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true);
    setScannerOpen(false);

    let parsed: { url?: string; token?: string } | null = null;
    try {
      parsed = JSON.parse(data) as { url?: string; token?: string };
    } catch {
      Alert.alert('Invalid QR Code', 'The scanned code is not a valid KOTA daemon QR code.');
      return;
    }

    if (!parsed?.url || !parsed?.token) {
      Alert.alert('Invalid QR Code', 'The scanned code is missing the daemon URL or token.');
      return;
    }

    const scannedUrl = parsed.url.trim().replace(/\/$/, '');
    const scannedToken = parsed.token.trim();
    setUrl(scannedUrl);
    setToken(scannedToken);

    setSaving(true);
    try {
      await saveSettings(scannedUrl, scannedToken);
      navigation?.goBack();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.qrButton} onPress={() => void handleScanPress()}>
          <Text style={styles.qrButtonText}>Scan QR Code</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          Run <Text style={styles.code}>kota daemon qr</Text> in your terminal to display the QR code.
        </Text>

        <Text style={styles.label}>Daemon URL</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="http://192.168.1.10:49251"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.hint}>
          Find this in .kota/daemon-control.json under &quot;port&quot;.
        </Text>

        <Text style={styles.label}>Auth Token</Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          placeholder="Paste token from daemon-control.json"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <Text style={styles.hint}>
          The token is stored in the OS secure keychain.
        </Text>

        <TouchableOpacity
          style={[styles.button, saving && styles.buttonDisabled]}
          onPress={() => void handleSave()}
          disabled={saving}
        >
          <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Push notifications for approvals</Text>
            <Text style={styles.rowHint}>Receive alerts when a workflow needs approval.</Text>
          </View>
          <Switch
            value={state.pushNotificationsEnabled}
            onValueChange={(v) => void setPushNotificationsEnabled(v)}
          />
        </View>
      </ScrollView>

      <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
        <View style={styles.scannerContainer}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanned ? undefined : (result) => void handleBarcodeScanned(result)}
          />
          <View style={styles.scannerOverlay}>
            <Text style={styles.scannerLabel}>Point at the QR code from kota daemon qr</Text>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setScannerOpen(false)}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  content: { padding: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#6c6c70', marginBottom: 6, marginTop: 20 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: '#1c1c1e',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c6c6c8',
  },
  hint: { fontSize: 12, color: '#8e8e93', marginTop: 6 },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  button: {
    backgroundColor: '#007aff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 32,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  qrButton: {
    backgroundColor: '#34c759',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  qrButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#6c6c70', marginBottom: 8, marginTop: 32 },
  row: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c6c6c8',
  },
  rowText: { flex: 1, marginRight: 12 },
  rowLabel: { fontSize: 15, color: '#1c1c1e' },
  rowHint: { fontSize: 12, color: '#8e8e93', marginTop: 2 },
  scannerContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  scannerOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 32,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  scannerLabel: { color: '#fff', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  cancelButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  cancelButtonText: { color: '#1c1c1e', fontWeight: '600', fontSize: 16 },
});
