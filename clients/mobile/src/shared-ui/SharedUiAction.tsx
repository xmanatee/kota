import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDaemon } from '../context/DaemonContext';
import type {
  UiAction,
  UiFormField,
  UiJsonValue,
} from '../daemon/ui-surface.generated';
import {
  initialFieldValues,
  readActionParameters,
  type UiFieldValues,
} from './action-parameters';
import { assertNever } from './graph';
import {
  readinessMessage,
} from './presentation';
import { actionStyles as styles } from './action-styles';
import { SharedUiActionField } from './SharedUiActionField';

export function SharedUiAction({
  action,
  fields = action.parameters?.fields ?? [],
  initialParameters = {},
  expanded = false,
  highlighted = false,
}: {
  action: UiAction;
  fields?: readonly UiFormField[];
  initialParameters?: Readonly<Record<string, UiJsonValue>>;
  expanded?: boolean;
  highlighted?: boolean;
}) {
  const { executeUiAction } = useDaemon();
  const visibleFields = useMemo(
    () => fields.filter((field) => initialParameters[field.id] === undefined),
    [fields, initialParameters],
  );
  const [isExpanded, setExpanded] = useState(
    expanded || highlighted || visibleFields.length === 0,
  );
  const [values, setValues] = useState<UiFieldValues>(() =>
    initialFieldValues(action, visibleFields),
  );
  const [pendingParameters, setPendingParameters] = useState<
    Readonly<Record<string, UiJsonValue>> | undefined | null
  >(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (highlighted) setExpanded(true);
  }, [highlighted]);

  const updateValue = (id: string, value: string | boolean) => {
    setValues((current) => ({ ...current, [id]: value }));
  };

  const collectParameters = () =>
    readActionParameters(action, visibleFields, values, initialParameters);

  const run = async (
    parameters: Readonly<Record<string, UiJsonValue>> | undefined,
  ) => {
    setWorking(true);
    setError(null);
    setResult(null);
    try {
      const response = await executeUiAction(action, parameters);
      setResult(response.message);
      if (!response.ok) setError(response.message);
      setPendingParameters(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWorking(false);
    }
  };

  const submit = () => {
    setError(null);
    setResult(null);
    try {
      const parameters = collectParameters();
      switch (action.confirmation.mode) {
        case 'none':
          void run(parameters);
          return;
        case 'required':
          setPendingParameters(parameters ?? {});
          return;
        default:
          assertNever(action.confirmation);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const disabled = action.readiness.state !== 'ready' || working;
  const availability = readinessMessage(action);

  return (
    <View
      style={[styles.card, highlighted && styles.highlighted]}
      testID={`ui-action-${action.actionId}`}
      accessibilityLabel={`${action.label} action`}
    >
      {visibleFields.length > 0 && !isExpanded ? (
        <TouchableOpacity
          style={styles.expandButton}
          accessibilityRole="button"
          accessibilityLabel={`Configure ${action.label}`}
          onPress={() => setExpanded(true)}
        >
          <Text style={styles.expandLabel}>{action.label}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.body}>
          {visibleFields.map((field) => (
            <SharedUiActionField
              key={field.id}
              action={action}
              field={field}
              value={values[field.id] ?? ''}
              onChange={(value) => updateValue(field.id, value)}
            />
          ))}

          <TouchableOpacity
            style={[styles.button, disabled && styles.buttonDisabled]}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            accessibilityLabel={action.label}
            disabled={disabled}
            onPress={submit}
          >
            {working ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonLabel}>{action.label}</Text>
            )}
          </TouchableOpacity>

          {availability ? (
            <Text
              style={
                action.readiness.state === 'ready'
                  ? styles.hint
                  : styles.unavailable
              }
            >
              {availability}
            </Text>
          ) : null}

          {pendingParameters !== null &&
          action.confirmation.mode === 'required' ? (
            <View
              style={styles.confirmation}
              accessibilityRole="alert"
              testID={`ui-confirm-${action.actionId}`}
            >
              <Text style={styles.confirmTitle}>
                {action.confirmation.title}
              </Text>
              <Text style={styles.confirmDetail}>
                {action.confirmation.detail}
              </Text>
              <View style={styles.confirmButtons}>
                <TouchableOpacity
                  style={[
                    styles.button,
                    action.confirmation.risk === 'high' && styles.dangerButton,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={action.confirmation.confirmLabel}
                  onPress={() => void run(pendingParameters)}
                >
                  <Text style={styles.buttonLabel}>
                    {action.confirmation.confirmLabel}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                  onPress={() => setPendingParameters(null)}
                >
                  <Text style={styles.secondaryLabel}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : result ? (
            <Text style={styles.success} accessibilityRole="text">
              {result}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}
