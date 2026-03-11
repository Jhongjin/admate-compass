"use client";

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

interface UseAnswerSummaryProps {
  aiResponse: string;
  userQuestion: string;
  sources: Array<{
    id: string;
    title: string;
    excerpt: string;
    sourceType?: 'file' | 'url';
  }>;
}

interface AnswerSummaryData {
  keyPoints: string[];
  documentHighlights: string[];
  confidence: number;
}

export function useAnswerSummary({ aiResponse, userQuestion, sources }: UseAnswerSummaryProps) {
  const [summaryData, setSummaryData] = useState<AnswerSummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSummary = async (): Promise<AnswerSummaryData> => {
    try {
      console.log('📝 요약 생성 요청 시작');

      const response = await fetch('/api/chat/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json', // JSON 응답만 받도록 명시
        },
        body: JSON.stringify({
          userQuestion,
          aiResponse,
          sources: sources.map(s => ({
            title: s.title,
            excerpt: s.excerpt,
            sourceType: s.sourceType
          }))
        }),
      });

      console.log('📝 요약 API 응답 수신:', {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        url: response.url
      });

      // Content-Type 확인 (응답 본문을 읽기 전에)
      const contentType = response.headers.get('content-type') || '';

      // SSE 형식 Content-Type인지 확인
      if (contentType.includes('text/event-stream')) {
        console.error('❌ SSE 형식 Content-Type을 받았습니다:', contentType);
        throw new Error('서버가 SSE 형식으로 응답했습니다. JSON 형식이 필요합니다.');
      }

      // 응답 본문을 텍스트로 먼저 읽기 (한 번만 읽을 수 있으므로)
      const responseText = await response.text();

      console.log('📝 응답 본문 길이:', responseText.length);
      console.log('📝 응답 본문 시작:', responseText.substring(0, 100));

      if (!response.ok) {
        console.error('❌ 요약 API 오류:', response.status, responseText.substring(0, 200));
        throw new Error(`요약 생성에 실패했습니다. (${response.status})`);
      }

      // SSE 형식인지 확인 (응답 본문이 "data: "로 시작하는지)
      const trimmedText = responseText.trim();
      if (trimmedText.startsWith('data: ')) {
        console.error('❌ SSE 형식 응답을 받았습니다. JSON 응답이어야 합니다.');
        console.error('❌ 응답 Content-Type:', contentType);
        console.error('❌ 응답 내용 (처음 500자):', responseText.substring(0, 500));

        // Fallback: SSE 형식에서 JSON 추출 시도
        try {
          const lines = responseText.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6).trim();
              if (jsonStr && jsonStr.startsWith('{')) {
                const data = JSON.parse(jsonStr);
                console.log('✅ SSE 형식에서 JSON 추출 성공');
                return data;
              }
            }
          }
        } catch (extractError) {
          console.error('❌ SSE에서 JSON 추출 실패:', extractError);
        }

        throw new Error('서버 응답 형식 오류: SSE 형식이 아닌 JSON 형식이 필요합니다.');
      }

      // JSON 파싱 시도
      let data;
      try {
        // 빈 응답 체크
        if (!trimmedText) {
          throw new Error('응답 본문이 비어있습니다.');
        }

        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('❌ JSON 파싱 오류:', parseError);
        console.error('❌ 응답 Content-Type:', contentType);
        console.error('❌ 응답 상태:', response.status, response.statusText);
        console.error('❌ 응답 URL:', response.url);
        console.error('❌ 응답 내용 (처음 500자):', responseText.substring(0, 500));
        console.error('❌ 응답 내용 (전체):', responseText);

        // Fallback 응답 반환
        return {
          keyPoints: [
            aiResponse.split('.')[0]?.trim() || '답변의 첫 번째 핵심 내용',
            aiResponse.split('.')[1]?.trim() || '답변의 두 번째 핵심 내용',
            aiResponse.split('.')[2]?.trim() || '답변의 세 번째 핵심 내용'
          ].filter(point => point && point.length > 10).slice(0, 5),
          documentHighlights: sources?.slice(0, 2).map((source: any) =>
            source.excerpt.substring(0, 80) + '...'
          ) || [],
          confidence: 0.7
        };
      }

      // 데이터 검증
      if (!data || typeof data !== 'object') {
        console.error('❌ 잘못된 응답 형식:', data);
        throw new Error('서버 응답 형식 오류');
      }

      console.log('✅ 요약 생성 성공:', {
        keyPointsCount: data.keyPoints?.length || 0,
        highlightsCount: data.documentHighlights?.length || 0,
        confidence: data.confidence
      });

      return data;
    } catch (error) {
      console.error('❌ 요약 생성 오류:', error);

      // 네트워크 오류나 파싱 오류인 경우 Fallback 반환
      if (error instanceof SyntaxError || error instanceof TypeError) {
        console.error('❌ JSON 파싱 오류:', error.message);
        // Fallback 응답 반환 (에러를 throw하지 않음)
        return {
          keyPoints: [
            aiResponse.split('.')[0]?.trim() || '답변의 첫 번째 핵심 내용',
            aiResponse.split('.')[1]?.trim() || '답변의 두 번째 핵심 내용',
            aiResponse.split('.')[2]?.trim() || '답변의 세 번째 핵심 내용'
          ].filter(point => point && point.length > 10).slice(0, 5),
          documentHighlights: sources?.slice(0, 2).map((source: any) =>
            source.excerpt.substring(0, 80) + '...'
          ) || [],
          confidence: 0.7
        };
      }

      // 다른 오류는 그대로 throw
      throw error;
    }
  };

  const { data, isLoading: queryLoading, error: queryError } = useQuery({
    queryKey: ['answerSummary', userQuestion, aiResponse],
    queryFn: generateSummary,
    enabled: !!aiResponse && !!userQuestion && aiResponse.trim().length > 0,
    staleTime: 5 * 60 * 1000, // 5분간 캐시
    retry: 2,
  });

  useEffect(() => {
    if (data) {
      setSummaryData(data);
      setIsLoading(false);
      setError(null);
    } else if (queryError) {
      setError(queryError.message);
      setIsLoading(false);
    } else if (queryLoading) {
      setIsLoading(true);
      setError(null);
    }
  }, [data, queryError, queryLoading]);

  return {
    summaryData,
    isLoading,
    error,
    refetch: () => {
      setIsLoading(true);
      setError(null);
    }
  };
}
