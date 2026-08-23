import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { navigationStyles as styles } from './styles';

export function CenteredMessage({
  title,
  detail,
  loading = false,
  children,
}: {
  title: string;
  detail?: string;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.centered}>
      {loading ? <ActivityIndicator size="large" color="#0a67c7" /> : null}
      <Text style={styles.messageTitle}>{title}</Text>
      {detail ? <Text style={styles.messageDetail}>{detail}</Text> : null}
      {children}
    </View>
  );
}
