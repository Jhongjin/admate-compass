import { NextRequest } from 'next/server';
import { buildCompassAnswerResponse, type CompassAnswerPhaseEmitter } from '@/lib/server/compassAnswerHandler';

export const dynamic = 'force-dynamic';

type StreamEvent =
  | {
      type: 'phase';
      phase: Parameters<CompassAnswerPhaseEmitter>[0]['phase'];
      message?: string;
      queryType?: string;
      sourceCount?: number;
      verifiedSourceCount?: number;
    }
  | {
      type: 'final';
      status: number;
      payload: Record<string, unknown>;
    }
  | {
      type: 'delta';
      content: string;
    }
  | {
      type: 'error';
      message: string;
    };

const encoder = new TextEncoder();
const ANSWER_DELTA_SIZE = 28;
const ANSWER_DELTA_DELAY_MS = 22;

function encodeEvent(event: StreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

function getAnswerContent(payload: Record<string, unknown>) {
  const response = payload.response && typeof payload.response === 'object'
    ? payload.response as Record<string, unknown>
    : undefined;
  const content = response?.message || response?.content;
  return typeof content === 'string' ? content : '';
}

function waitForDeltaFrame() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ANSWER_DELTA_DELAY_MS);
  });
}

export async function POST(request: NextRequest) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encodeEvent(event));
      };

      try {
        const result = await buildCompassAnswerResponse(request, (event) => {
          send({ type: 'phase', ...event });
        });

        const status = result.status || 200;
        const answerContent = status < 400 ? getAnswerContent(result.body) : '';
        for (let index = 0; index < answerContent.length; index += ANSWER_DELTA_SIZE) {
          send({
            type: 'delta',
            content: answerContent.slice(index, index + ANSWER_DELTA_SIZE),
          });
          await waitForDeltaFrame();
        }

        send({
          type: 'final',
          status,
          payload: result.body,
        });
      } catch (error) {
        console.error('Compass answer stream failed', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        send({
          type: 'error',
          message: 'Compass 답변 스트림을 처리하는 중 문제가 발생했습니다.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
