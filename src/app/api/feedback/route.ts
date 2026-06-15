import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { resolveCompassApiOwner, type CompassApiOwner } from '@/lib/auth/compassApiOwner';
import { createCompassServiceClient, getCompassDbSchema } from '@/lib/supabase/compass';

const HERMES_LEARNING_BUCKET = process.env.COMPASS_HERMES_LEARNING_BUCKET || 'compass-hermes-learning-feedback';
const MAX_SOURCE_COUNT = 8;
const MAX_TEXT_LENGTH = 5000;

let supabase: any = null;
let learningBucketReady = false;

type FeedbackOwner = CompassApiOwner;

type FeedbackPayload = {
  userId: string;
  userEmail?: string;
  userName?: string;
  conversationId: string;
  messageId: string;
  helpful: boolean;
  question?: string;
  answer?: string;
  sources?: unknown[];
  model?: string;
  confidence?: number;
  reviewPipeline?: unknown;
};

type LearningCandidate = {
  id: string;
  product: 'compass';
  eventType: 'answer_feedback';
  feedbackKey: string;
  ownerSubjectHash: string;
  userEmail?: string;
  userName?: string;
  conversationId: string;
  messageId: string;
  helpful: boolean;
  question: string;
  answer: string;
  sources: Array<Record<string, unknown>>;
  model?: string;
  confidence?: number;
  reviewPipeline?: unknown;
  learningTarget: 'hermes';
  learningStatus: 'candidate';
  governance: {
    directModelUpdate: false;
    requiresHumanReview: true;
    smokeTest: false;
  };
  createdAt: string;
};

function getSupabaseClient() {
  if (supabase) return supabase;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return null;
  }

  supabase = createCompassServiceClient();
  return supabase;
}

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function truncate(value: unknown, maxLength = MAX_TEXT_LENGTH) {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function sanitizeSources(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];

  return value
    .filter((source) => source && typeof source === 'object')
    .slice(0, MAX_SOURCE_COUNT)
    .map((source, index) => {
      const item = source as Record<string, unknown>;
      return {
        id: String(item.id || item.chunkId || item.documentId || `source-${index + 1}`),
        title: truncate(item.title || item.originalTitle || `출처 문서 ${index + 1}`, 180),
        url: typeof item.url === 'string' ? item.url : undefined,
        excerpt: truncate(item.excerpt || item.content, 900),
        sourceType: typeof item.sourceType === 'string' ? item.sourceType : undefined,
        sourceVendor: typeof item.sourceVendor === 'string' ? item.sourceVendor : undefined,
        retrievalMethod: typeof item.retrievalMethod === 'string' ? item.retrievalMethod : undefined,
      };
    });
}

function isMissingTableOrColumn(error: any) {
  return Boolean(
    error?.code === 'PGRST205'
    || error?.code === 'PGRST204'
    || error?.message?.includes('Could not find the table')
    || error?.message?.includes('Could not find')
    || error?.message?.includes('schema cache')
    || error?.message?.includes('The schema must be one of')
  );
}

function buildFeedbackKey(ownerSubject: string, messageId: string) {
  return hashToken(`${ownerSubject}:${messageId}`).slice(0, 40);
}

function learningStoragePrefix(ownerSubject: string) {
  return `owners/${hashToken(ownerSubject).slice(0, 32)}/feedback`;
}

function learningStoragePath(ownerSubject: string, messageId: string) {
  return `${learningStoragePrefix(ownerSubject)}/${hashToken(messageId).slice(0, 32)}.json`;
}

function buildLearningCandidate(payload: FeedbackPayload, owner: FeedbackOwner): LearningCandidate {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    product: 'compass',
    eventType: 'answer_feedback',
    feedbackKey: buildFeedbackKey(owner.ownerSubject, payload.messageId),
    ownerSubjectHash: hashToken(owner.ownerSubject).slice(0, 32),
    userEmail: payload.userEmail,
    userName: payload.userName,
    conversationId: payload.conversationId,
    messageId: payload.messageId,
    helpful: payload.helpful,
    question: truncate(payload.question),
    answer: truncate(payload.answer),
    sources: sanitizeSources(payload.sources),
    model: payload.model,
    confidence: typeof payload.confidence === 'number' ? payload.confidence : undefined,
    reviewPipeline: payload.reviewPipeline,
    learningTarget: 'hermes',
    learningStatus: 'candidate',
    governance: {
      directModelUpdate: false,
      requiresHumanReview: true,
      smokeTest: false,
    },
    createdAt: now,
  };
}

async function ensureLearningStorageBucket(client: any) {
  if (learningBucketReady) return true;

  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) {
    console.warn('Hermes 학습 후보 Storage bucket 확인 실패:', listError.message);
    return false;
  }

  if (Array.isArray(buckets) && buckets.some((bucket: any) => bucket.name === HERMES_LEARNING_BUCKET)) {
    learningBucketReady = true;
    return true;
  }

  const { error: createError } = await client.storage.createBucket(HERMES_LEARNING_BUCKET, {
    public: false,
    fileSizeLimit: 1024 * 1024,
  });

  if (createError) {
    if (/already exists|exist/i.test(createError.message || '')) {
      learningBucketReady = true;
      return true;
    }

    console.warn('Hermes 학습 후보 Storage bucket 생성 실패:', createError.message);
    return false;
  }

  learningBucketReady = true;
  return true;
}

async function saveLearningCandidateToStorage(client: any, ownerSubject: string, candidate: LearningCandidate) {
  const bucketReady = await ensureLearningStorageBucket(client);
  if (!bucketReady) {
    return {
      queued: false,
      persistence: null,
      message: 'Hermes 학습 후보 Storage fallback을 사용할 수 없습니다.',
    };
  }

  const path = learningStoragePath(ownerSubject, candidate.messageId);
  const { error } = await client.storage
    .from(HERMES_LEARNING_BUCKET)
    .upload(path, JSON.stringify(candidate, null, 2), {
      contentType: 'application/json',
      upsert: true,
    });

  if (error) {
    console.warn('Hermes 학습 후보 Storage 저장 실패:', error.message);
    return {
      queued: false,
      persistence: null,
      message: 'Hermes 학습 후보 Storage 저장에 실패했습니다.',
    };
  }

  return {
    queued: true,
    persistence: 'storage-hermes-learning',
    message: 'Hermes 학습 후보가 Storage 큐에 기록되었습니다.',
  };
}

async function saveFeedbackRecord(client: any, owner: FeedbackOwner, payload: FeedbackPayload, candidate: LearningCandidate) {
  const now = new Date().toISOString();
  const preferredRecord = {
    user_id: isUuid(owner.ownerSubject) ? owner.ownerSubject : null,
    owner_subject: owner.ownerSubject,
    user_email: payload.userEmail || null,
    user_name: payload.userName || null,
    conversation_id: payload.conversationId,
    message_id: payload.messageId,
    helpful: payload.helpful,
    question: candidate.question,
    answer: candidate.answer,
    sources: candidate.sources,
    model: payload.model || null,
    confidence: typeof payload.confidence === 'number' ? payload.confidence : null,
    review_pipeline: payload.reviewPipeline || null,
    learning_target: 'hermes',
    learning_status: 'candidate',
    updated_at: now,
  };

  const preferred = await client
    .from('feedback')
    .upsert(preferredRecord, { onConflict: 'owner_subject,message_id' })
    .select()
    .single();

  if (!preferred.error) {
    return {
      saved: true,
      feedback: preferred.data,
      persistence: `${getCompassDbSchema()}.feedback`,
    };
  }

  if (!isMissingTableOrColumn(preferred.error)) {
    console.warn('Compass feedback 저장 실패:', preferred.error.message);
  }

  if (!isUuid(owner.ownerSubject)) {
    return {
      saved: false,
      feedback: null,
      persistence: null,
      message: preferred.error?.message || 'UUID 기반 legacy feedback 테이블에 저장할 수 없는 사용자입니다.',
    };
  }

  const { data: existingFeedback } = await client
    .from('feedback')
    .select('*')
    .eq('user_id', owner.ownerSubject)
    .eq('message_id', payload.messageId)
    .maybeSingle();

  const legacyQuery = existingFeedback
    ? client
      .from('feedback')
      .update({
        helpful: payload.helpful,
        updated_at: now,
      })
      .eq('user_id', owner.ownerSubject)
      .eq('message_id', payload.messageId)
      .select()
      .single()
    : client
      .from('feedback')
      .insert({
        user_id: owner.ownerSubject,
        conversation_id: payload.conversationId,
        message_id: payload.messageId,
        helpful: payload.helpful,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

  const legacy = await legacyQuery;
  if (legacy.error) {
    console.warn('Legacy feedback 저장 실패:', legacy.error.message);
    return {
      saved: false,
      feedback: null,
      persistence: null,
      message: legacy.error.message,
    };
  }

  return {
    saved: true,
    feedback: legacy.data,
    persistence: 'legacy-feedback',
  };
}

async function saveLearningCandidateRecord(client: any, owner: FeedbackOwner, candidate: LearningCandidate) {
  const record = {
    owner_subject: owner.ownerSubject,
    product: candidate.product,
    event_type: candidate.eventType,
    feedback_key: candidate.feedbackKey,
    conversation_id: candidate.conversationId,
    message_id: candidate.messageId,
    helpful: candidate.helpful,
    question: candidate.question,
    answer: candidate.answer,
    sources: candidate.sources,
    model: candidate.model || null,
    confidence: typeof candidate.confidence === 'number' ? candidate.confidence : null,
    review_pipeline: candidate.reviewPipeline || null,
    learning_target: candidate.learningTarget,
    learning_status: candidate.learningStatus,
    learning_payload: candidate,
  };

  const { data, error } = await client
    .from('learning_feedback')
    .insert(record)
    .select()
    .single();

  if (!error) {
    return {
      queued: true,
      record: data,
      persistence: `${getCompassDbSchema()}.learning_feedback`,
      message: 'Hermes 학습 후보가 DB 큐에 기록되었습니다.',
    };
  }

  if (!isMissingTableOrColumn(error)) {
    console.warn('Hermes learning_feedback 저장 실패:', error.message);
  }

  return saveLearningCandidateToStorage(client, owner.ownerSubject, candidate);
}

async function readFeedbackFromStorage(client: any, ownerSubject: string, conversationId?: string | null, messageId?: string | null) {
  const bucketReady = await ensureLearningStorageBucket(client);
  if (!bucketReady) return [];

  const paths = messageId
    ? [learningStoragePath(ownerSubject, messageId)]
    : [];

  if (paths.length === 0) {
    const { data: objects, error } = await client.storage
      .from(HERMES_LEARNING_BUCKET)
      .list(learningStoragePrefix(ownerSubject), {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' },
      });

    if (error) {
      console.warn('Hermes 학습 후보 Storage 목록 조회 실패:', error.message);
      return [];
    }

    paths.push(...(objects || [])
      .filter((object: any) => typeof object.name === 'string' && object.name.endsWith('.json'))
      .map((object: any) => `${learningStoragePrefix(ownerSubject)}/${object.name}`));
  }

  const feedback: Array<Record<string, unknown>> = [];

  for (const path of paths) {
    const { data, error } = await client.storage
      .from(HERMES_LEARNING_BUCKET)
      .download(path);

    if (error || !data) continue;

    try {
      const candidate = JSON.parse(await data.text()) as LearningCandidate;
      if (conversationId && candidate.conversationId !== conversationId) continue;
      feedback.push({
        id: candidate.feedbackKey,
        conversation_id: candidate.conversationId,
        message_id: candidate.messageId,
        helpful: candidate.helpful,
        learning_status: candidate.learningStatus,
        learning_target: candidate.learningTarget,
        persistence: 'storage-hermes-learning',
        created_at: candidate.createdAt,
      });
    } catch {
      // Ignore corrupted fallback entries and keep the user-facing route stable.
    }
  }

  return feedback;
}

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    if (!client) {
      return NextResponse.json(
        { error: '서비스가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const payload = body as FeedbackPayload;
    const { userId, conversationId, messageId, helpful } = payload;
    const owner = await resolveCompassApiOwner(request, userId);

    if (!owner || !conversationId || !messageId || typeof helpful !== 'boolean') {
      return NextResponse.json(
        { error: '필수 필드가 누락되었습니다.' },
        { status: 400 }
      );
    }

    const candidate = buildLearningCandidate(payload, owner);
    const feedbackResult = await saveFeedbackRecord(client, owner, payload, candidate);
    const learningResult = await saveLearningCandidateRecord(client, owner, candidate);
    const success = Boolean(feedbackResult.saved || learningResult.queued);

    if (!success) {
      return NextResponse.json(
        {
          success: false,
          error: '피드백과 Hermes 학습 후보를 저장하지 못했습니다.',
          feedbackMessage: feedbackResult.message,
          hermesMessage: learningResult.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      feedback: feedbackResult.feedback,
      feedbackPersistence: feedbackResult.persistence,
      hermesLearning: {
        queued: learningResult.queued,
        status: 'candidate',
        target: 'hermes',
        persistence: learningResult.persistence,
        message: learningResult.message,
      },
      governance: candidate.governance,
      message: learningResult.queued
        ? '피드백이 Hermes 학습 후보로 기록되었습니다.'
        : '피드백은 저장되었지만 Hermes 학습 후보 큐 상태 확인이 필요합니다.',
    });

  } catch (error) {
    console.error('피드백 API 오류:', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: '피드백 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    if (!client) {
      return NextResponse.json(
        { error: '서비스가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const conversationId = searchParams.get('conversationId');
    const messageId = searchParams.get('messageId');
    const owner = await resolveCompassApiOwner(request, userId);

    if (!owner) {
      return NextResponse.json(
        { error: '사용자 ID가 필요합니다.' },
        { status: 400 }
      );
    }

    let query = client
      .from('feedback')
      .select('*')
      .eq('owner_subject', owner.ownerSubject);

    if (conversationId) query = query.eq('conversation_id', conversationId);
    if (messageId) query = query.eq('message_id', messageId);

    const { data: feedback, error } = await query.order('created_at', { ascending: false });

    if (!error) {
      return NextResponse.json({
        success: true,
        feedback: feedback || [],
        persistence: `${getCompassDbSchema()}.feedback`,
      });
    }

    if (!isMissingTableOrColumn(error)) {
      console.warn('피드백 조회 오류:', error.message);
    }

    const fallbackFeedback = await readFeedbackFromStorage(client, owner.ownerSubject, conversationId, messageId);
    return NextResponse.json({
      success: true,
      feedback: fallbackFeedback,
      persistence: fallbackFeedback.length > 0 ? 'storage-hermes-learning' : null,
      message: fallbackFeedback.length > 0
        ? 'Hermes 학습 후보 Storage에서 피드백 상태를 확인했습니다.'
        : '저장된 피드백이 없습니다.',
    });

  } catch (error) {
    console.error('피드백 조회 API 오류:', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: '피드백 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    if (!client) {
      return NextResponse.json(
        { error: '서비스가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const messageId = searchParams.get('messageId');
    const owner = await resolveCompassApiOwner(request, userId);

    if (!owner || !messageId) {
      return NextResponse.json(
        { error: '사용자 ID와 메시지 ID가 필요합니다.' },
        { status: 400 }
      );
    }

    const { error } = await client
      .from('feedback')
      .delete()
      .eq('owner_subject', owner.ownerSubject)
      .eq('message_id', messageId);

    if (error && !isMissingTableOrColumn(error)) {
      console.warn('피드백 삭제 오류:', error.message);
    }

    const bucketReady = await ensureLearningStorageBucket(client);
    if (bucketReady) {
      await client.storage
        .from(HERMES_LEARNING_BUCKET)
        .remove([learningStoragePath(owner.ownerSubject, messageId)]);
    }

    return NextResponse.json({
      success: true,
      message: '피드백이 삭제되었습니다.',
    });

  } catch (error) {
    console.error('피드백 삭제 API 오류:', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: '피드백 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
