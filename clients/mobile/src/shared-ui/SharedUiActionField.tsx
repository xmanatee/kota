import React from 'react';
import { Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type {
  UiAction,
  UiFormField,
} from '../daemon/ui-surface.generated';
import { actionStyles as styles } from './action-styles';
import { assertNever } from './graph';

export function SharedUiActionField({
  action,
  field,
  value,
  onChange,
}: {
  action: UiAction;
  field: UiFormField;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}) {
  const schema = field.schema ?? action.parameters?.schema.properties[field.id];
  const label = `${field.label}${field.required ? ' *' : ''}`;
  const options =
    field.options ??
    (schema?.type === 'string'
      ? schema.enum?.map((option) => ({ label: option, value: option }))
      : undefined);

  switch (field.input) {
    case 'boolean':
      return (
        <View style={styles.booleanField}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <Switch
            accessibilityLabel={field.label}
            value={value === true}
            onValueChange={onChange}
          />
        </View>
      );
    case 'select':
      return (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <View style={styles.options} accessibilityRole="radiogroup">
            {options?.map((option) => {
              const selected = value === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.option, selected && styles.optionSelected]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${field.label}: ${option.label}`}
                  onPress={() => onChange(option.value)}
                >
                  <Text
                    style={[
                      styles.optionLabel,
                      selected && styles.optionLabelSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {schema?.description ? (
            <Text style={styles.hint}>{schema.description}</Text>
          ) : null}
        </View>
      );
    case 'number':
    case 'secret':
    case 'path':
    case 'url':
    case 'multiline':
    case 'text': {
      const structured = schema?.type === 'array' || schema?.type === 'object';
      return (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <TextInput
            style={[
              styles.input,
              (field.input === 'multiline' || structured) && styles.multiline,
            ]}
            accessibilityLabel={field.label}
            value={typeof value === 'string' ? value : ''}
            onChangeText={onChange}
            multiline={field.input === 'multiline' || structured}
            secureTextEntry={field.input === 'secret'}
            keyboardType={
              field.input === 'number'
                ? 'numeric'
                : field.input === 'url'
                  ? 'url'
                  : 'default'
            }
            autoCapitalize={field.input === 'url' ? 'none' : 'sentences'}
            autoCorrect={field.input !== 'secret' && field.input !== 'url'}
          />
          {schema?.description ? (
            <Text style={styles.hint}>{schema.description}</Text>
          ) : null}
        </View>
      );
    }
    default:
      return assertNever(field.input);
  }
}
