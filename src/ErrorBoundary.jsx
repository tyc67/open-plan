import { Component } from 'react';

// Catches render errors below it, so one failing view does not unmount the whole app.
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error(error, info.componentStack); }
  render() { return this.state.error ? this.props.fallback(this.state.error) : this.props.children; }
}
