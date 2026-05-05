import { buildOllamaApiUrl, getOllamaEndpointStatus } from './ollamaEndpoint';

// 디버깅을 위한 로그
console.log('🔧 Ollama 서비스 초기화:', {
  env: process.env.NODE_ENV,
  endpoint: getOllamaEndpointStatus(),
});

export interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  done_reason: string;
  context: number[];
  total_duration: number;
  load_duration: number;
  prompt_eval_count: number;
  prompt_eval_duration: number;
  eval_count: number;
  eval_duration: number;
}

export interface OllamaModel {
  name: string;
  id: string;
  size: number;
  modified_at: string;
}

export interface OllamaTagsResponse {
  models: OllamaModel[];
}

export async function generateResponse(
  prompt: string, 
  model: string = 'tinyllama:1.1b'
): Promise<string> {
  try {
    console.log('🚀 Ollama API 호출 시작:', { model, promptLength: prompt.length });
    
    // 프롬프트 길이 제한 (성능 최적화)
    const maxPromptLength = 2000;
    const truncatedPrompt = prompt.length > maxPromptLength 
      ? prompt.substring(0, maxPromptLength) + '...'
      : prompt;
    
    const response = await fetch(buildOllamaApiUrl('/api/generate'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: truncatedPrompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 500 // 응답 길이 제한
        }
      }),
      signal: AbortSignal.timeout(5000) // 5초 타임아웃
    });

    console.log('📡 Ollama API 응답 상태:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Ollama API 오류 응답:', errorText);
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data: OllamaResponse = await response.json();
    console.log('✅ Ollama API 응답 성공:', { responseLength: data.response?.length });
    
    if (!data.response || data.response.trim().length === 0) {
      throw new Error('Ollama API returned empty response');
    }
    
    return data.response.trim();
  } catch (error) {
    console.error('❌ Ollama API 오류 상세:', error);
    
    // 에러 타입별 처리
    if (error instanceof Error) {
      if (error.name === 'TimeoutError') {
        throw new Error('Ollama 서버 응답 시간 초과 (5초)');
      } else if (error.name === 'AbortError') {
        throw new Error('Ollama 서버 요청이 중단되었습니다');
      } else if (error.message.includes('fetch')) {
        throw new Error('Ollama 서버에 연결할 수 없습니다');
      }
    }
    
    throw new Error(`Ollama API 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

export async function getAvailableModels(): Promise<OllamaModel[]> {
  try {
    const response = await fetch(buildOllamaApiUrl('/api/tags'));
    
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data: OllamaTagsResponse = await response.json();
    
    // 안전한 배열 반환
    if (data && data.models && Array.isArray(data.models)) {
      return data.models;
    } else {
      console.warn('⚠️ Ollama API 응답에 models 배열이 없습니다:', data);
      return [];
    }
  } catch (error) {
    console.error('Ollama API error:', error);
    // 오류 발생 시 빈 배열 반환
    return [];
  }
}

export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const response = await fetch(buildOllamaApiUrl('/api/tags'));
    return response.ok;
  } catch (error) {
    console.error('Ollama health check failed:', error);
    return false;
  }
}
