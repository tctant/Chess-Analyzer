// catches render errors in any child subtree. used to wrap each dashboard
// card so a malformed pgn or chart edge case doesnt blank the whole page.
// react needs this as a class component - hooks cant catch render errors.

import { Component } from 'react';

export class ErrorBoundary extends Component {

    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {

        // log to console so we can grep later. could pipe to sentry here
        // if it ever becomes worth the dependency.
        console.error('ErrorBoundary caught:', error, info);
    }

    reset = () => { this.setState({ error: null }); }

    render() {

        if (this.state.error) {
            return (
                <div className="error-boundary">
                    <div className="error-boundary-title">
                        {this.props.label || 'Something went wrong here'}
                    </div>
                    <div className="error-boundary-msg">
                        {this.state.error.message || String(this.state.error)}
                    </div>
                    <button className="error-boundary-retry" onClick={this.reset}>
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
