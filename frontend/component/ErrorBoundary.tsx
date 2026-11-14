import React from "react";
import { Text, ScrollView, StyleSheet, Platform } from "react-native";
import Constants from "expo-constants";
import { logger } from "../utils/logger";
import { reportCrash } from "../utils/crashReporting";
import { getErrorMessage } from "../utils/errorDetails";

interface Props {
  children?: React.ReactNode;
}

interface State {
  // `unknown` : un composant peut lever n'importe quelle valeur, pas seulement une Error.
  error: unknown;
  errorInfo: React.ErrorInfo | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = errorInfo?.componentStack ? String(errorInfo.componentStack) : undefined;
    logger.error("ErrorBoundary caught", { message, stack });
    this.setState({ error, errorInfo });
    void reportCrash({
      message,
      stack,
      appVersion: Constants.expoConfig?.version,
      platform: Platform.OS,
    });
  }

  render() {
    if (this.state.error !== null && this.state.error !== undefined) {
      return (
        <ScrollView style={styles.container}>
          <Text style={styles.title}>🚨 JavaScript Error</Text>

          <Text style={styles.label}>Message:</Text>
          <Text testID="backend-error-message" style={styles.text}>
            {getErrorMessage(this.state.error) || String(this.state.error)}
          </Text>

          <Text style={styles.label}>Stack:</Text>
          <Text style={styles.text}>
            {String(this.state.errorInfo?.componentStack)}
          </Text>
        </ScrollView>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    padding: 20,
  },
  title: {
    color: "#ff4444",
    fontSize: 24,
    marginBottom: 20,
    fontWeight: "bold",
  },
  label: {
    color: "#ffaa00",
    fontSize: 16,
    marginTop: 10,
  },
  text: {
    color: "#fff",
    fontSize: 14,
  },
});
