import React from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  label?: string;
}

interface State {
  hasError: boolean;
}

export class SafeSection extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(err: unknown, info: unknown) {
    console.error('SafeSection caught error', this.props.label, err, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            Couldn't load{this.props.label ? ` ${this.props.label}` : ''} — refresh and try again.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default SafeSection;
