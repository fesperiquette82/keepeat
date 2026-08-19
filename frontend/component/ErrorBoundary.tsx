import React from "react";
import { Text, ScrollView, StyleSheet, Platform } from "react-native";
import Constants from "expo-constants";
import { logger } from "../utils/logger";
import { reportCrash } from "../utils/crashReporting";

interface State {
  error: any;
  errorInfo: any;
}

export default class ErrorBoundary extends React.Component<any, State> {
  constructor(props: any) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  componentDidCatch(error: any, errorInfo: any) {
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
    if (this.state.error) {
      return (
        <ScrollView style={styles.container}>
          <Text style={styles.title}>🚨 JavaScript Error</Text>

          <Text style={styles.label}>Message:</Text>
          <Text testID="backend-error-message" style={styles.text}>
            {String(this.state.error?.message || this.state.error)}
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
