import { Component } from 'react'
import { ErrorMessage } from './ui.jsx'

/** Shows a way forward instead of a blank page if a screen crashes. */
export default class ErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <ErrorMessage
        error={{ message: 'Please reload the page. If it keeps happening, try again in a little while.' }}
        onRetry={() => window.location.reload()}
      />
    )
  }
}
