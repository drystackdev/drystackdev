import React, { ReactNode } from "react";
import { isNotFoundError } from "./not-found";

type ErrorBoundaryProps = {
  fallback: ReactNode | ((message: string) => ReactNode);
  children: ReactNode;
  // Changing any value in this array (e.g. after a "reset entry data" action
  // fixes the underlying cause) clears a caught error and lets `children`
  // mount again - without this, a thrown error permanently unmounts
  // `children`, so nothing children do (retrying a fetch, refreshing data)
  // can ever recover the boundary on its own.
  resetKeys?: readonly unknown[];
};

type ErrorBoundaryState = {
  message: string | null;
};

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { message: null };
  }

  static getDerivedStateFromError(err: unknown) {
    if (isNotFoundError(err)) {
      throw err;
    }
    return { message: String(err) };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (
      this.state.message !== null &&
      prevProps.resetKeys?.length === this.props.resetKeys?.length &&
      prevProps.resetKeys?.some((key, i) => key !== this.props.resetKeys![i])
    ) {
      this.setState({ message: null });
    }
  }

  render() {
    if (this.state.message) {
      return typeof this.props.fallback === "function"
        ? this.props.fallback(this.state.message)
        : this.props.fallback;
    }
    return this.props.children;
  }
}
