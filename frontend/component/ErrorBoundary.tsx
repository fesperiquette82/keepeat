import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";

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
    console.error("ErrorBoundary caught:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.error) {
      return (
        <ScrollView style={styles.container}>
          <Text style={styles.title}>🚨 JavaScript Error</Text>

          <Text style={styles.label}>Message:</Text>
          <Text style={styles.text}>
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
