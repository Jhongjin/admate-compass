"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 글로벌 에러를 로깅 서비스에 전송
    console.error("Global application error:", error);
  }, [error]);

  return (
    <html>
      <body>
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4">
          <Card className="w-full max-w-md bg-white/10 backdrop-blur-sm border-white/20 shadow-2xl">
            <CardHeader className="text-center">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
              <CardTitle className="text-2xl font-bold text-white font-nanum">
                심각한 오류가 발생했습니다
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center">
                <p className="text-gray-300 font-nanum mb-2">
                  애플리케이션에 심각한 오류가 발생했습니다.
                </p>
                <p className="text-sm text-gray-400 font-nanum">
                  페이지를 새로고침하거나 잠시 후 다시 시도해주세요.
                </p>
              </div>

              {process.env.NODE_ENV === "development" && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                  <h3 className="text-red-400 font-semibold mb-2 font-nanum">
                    개발 모드 - 글로벌 에러 상세 정보:
                  </h3>
                  <pre className="text-xs text-red-300 whitespace-pre-wrap break-words font-mono">
                    {error.message}
                  </pre>
                  {error.digest && (
                    <p className="text-xs text-red-400 mt-2 font-nanum">
                      에러 ID: {error.digest}
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-col space-y-3">
                <Button
                  onClick={reset}
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-nanum"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  다시 시도
                </Button>
                
                <Button
                  onClick={() => window.location.href = '/'}
                  variant="outline"
                  className="w-full border-white/30 text-white hover:bg-white/10 font-nanum"
                >
                  <Home className="w-4 h-4 mr-2" />
                  홈으로 돌아가기
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </body>
    </html>
  );
}

