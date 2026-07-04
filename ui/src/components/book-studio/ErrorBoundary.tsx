/**
 * ErrorBoundary — simple React error boundary for Book Studio.
 * Catches unhandled errors from generate/chat/image-gen calls.
 */

import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Book Studio error boundary caught:", error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex items-center justify-center h-full bg-gray-950">
          <div className="text-center p-8">
            <div className="flex justify-center mb-4">
              <AlertTriangle className="w-10 h-10 text-yellow-500 opacity-60" />
            </div>
            <h2 className="text-lg font-semibold text-gray-200 mb-2">
              Something went wrong
            </h2>
            <p className="text-sm text-gray-500 mb-6 max-w-sm">
              {this.state.error?.message || "An unexpected error occurred in Book Studio."}
            </p>
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              <RotateCcw className="w-4 h-4" /> Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
