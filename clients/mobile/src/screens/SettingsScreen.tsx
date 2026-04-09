import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
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

export function SettingsScreen() {
  const { state, saveSettings, setPushNotificationsEnabled } = useDaemon();
  const [url, setUrl] = useState(state.daemonUrl);
  const [token, setToken] = useState(state.token);
  const [saving, setSaving] = useState(false);

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

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
  button: {
    backgroundColor: '#007aff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 32,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
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
});
