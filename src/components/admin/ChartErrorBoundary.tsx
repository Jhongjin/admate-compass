"use client";

import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ChartErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ChartErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export class ChartErrorBoundary extends React.Component<ChartErrorBoundaryProps, ChartErrorBoundaryState> {
  constructor(props: ChartErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ChartErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Chart Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="h-64 flex flex-col items-center justify-center text-gray-400 bg-gray-700/50 rounded-lg">
          <AlertTriangle className="w-8 h-8 mb-2 text-yellow-500" />
          <p className="text-sm">차트를 불러올 수 없습니다</p>
          <p className="text-xs text-gray-500 mt-1">페이지를 새로고침해주세요</p>
        </div>
      );
    }

    return this.props.children;
  }
}


