import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { resolveCompassApiOwner, type CompassApiOwner } from '@/lib/auth/compassApiOwner';
import { createCompassServiceClient, getCompassDbSchema } from '@/lib/supabase/compass';

type ConversationOwner = CompassApiOwner;

let supabase: any = null;
let historyBucketReady = false;

const HISTORY_STORAGE_BUCKET = process.env.COMPASS_HISTORY_STORAGE_BUCKET || 'compass-conversation-history';

type StoredConversation = {
  id: string;
  conversation_id: string;
  user_message: string;
  ai_response: string;
  sources: unknown[];
  created_at: string;
  updated_at: string;
  owner_subject_hash: string;
  persistence: 'storage-fallback';
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

function clampPagination(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMissingConversationTable(error: any) {
  return error?.code === 'PGRST205' || error?.message?.includes('Could not find the table');
}

function isMissingOwnerSubjectColumn(error: any) {
  return error?.code === 'PGRST204' || error?.message?.includes('owner_subject');
}

function buildHistoryMigrationMessage() {
  return `${getCompassDbSchema()}.conversations.owner_subject 마이그레이션이 필요합니다.`;
}

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function storageOwnerPrefix(ownerSubject: string) {
  return `owners/${hashToken(ownerSubject).slice(0, 32)}`;
}

function storageConversationPath(ownerSubject: string, conversationId: string) {
  return `${storageOwnerPrefix(ownerSubject)}/${hashToken(conversationId).slice(0, 32)}.json`;
}

async function ensureHistoryStorageBucket(client: any) {
  if (historyBucketReady) return true;

  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) {
    console.warn('히스토리 Storage bucket 확인 실패:', listError.message);
    return false;
  }

  if (Array.isArray(buckets) && buckets.some((bucket: any) => bucket.name === HISTORY_STORAGE_BUCKET)) {
    historyBucketReady = true;
    return true;
  }

  const { error: createError } = await client.storage.createBucket(HISTORY_STORAGE_BUCKET, {
    public: false,
    fileSizeLimit: 1024 * 1024,
  });

  if (createError) {
    if (/already exists|exist/i.test(createError.message || '')) {
      historyBucketReady = true;
      return true;
    }

    console.warn('히스토리 Storage bucket 생성 실패:', createError.message);
    return false;
  }

  historyBucketReady = true;
  return true;
}

async function readHistoryFromStorage(client: any, ownerSubject: string, limit: number, offset: number) {
  const bucketReady = await ensureHistoryStorageBucket(client);
  if (!bucketReady) {
    return { success: false, conversations: [], total: 0, message: '히스토리 Storage fallback을 사용할 수 없습니다.' };
  }

  const prefix = storageOwnerPrefix(ownerSubject);
  const { data: objects, error } = await client.storage
    .from(HISTORY_STORAGE_BUCKET)
    .list(prefix, {
      limit: Math.min(Math.max(limit + offset, 1), 100),
      offset: 0,
      sortBy: { column: 'created_at', order: 'desc' },
    });

  if (error) {
    console.warn('히스토리 Storage 조회 실패:', error.message);
    return { success: false, conversations: [], total: 0, message: '히스토리 Storage fallback 조회에 실패했습니다.' };
  }

  const files = (objects || [])
    .filter((object: any) => typeof object.name === 'string' && object.name.endsWith('.json'))
    .slice(offset, offset + limit);

  const conversations: StoredConversation[] = [];

  for (const file of files) {
    const path = `${prefix}/${file.name}`;
    const { data, error: downloadError } = await client.storage
      .from(HISTORY_STORAGE_BUCKET)
      .download(path);

    if (downloadError || !data) {
      console.warn('히스토리 Storage 파일 다운로드 실패:', downloadError?.message || path);
      continue;
    }

    try {
      const parsed = JSON.parse(await data.text());
      conversations.push(parsed);
    } catch (parseError) {
      console.warn('히스토리 Storage 파일 파싱 실패:', path);
    }
  }

  conversations.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return {
    success: true,
    conversations,
    total: objects?.length || conversations.length,
    persistence: 'storage-fallback' as const,
    message: buildHistoryMigrationMessage(),
  };
}

async function saveHistoryToStorage(
  client: any,
  ownerSubject: string,
  conversationId: string,
  userMessage: string,
  aiResponse: string,
  sources: unknown[]
) {
  const bucketReady = await ensureHistoryStorageBucket(client);
  if (!bucketReady) {
    return { success: false, conversation: null, message: '히스토리 Storage fallback을 사용할 수 없습니다.' };
  }

  const path = storageConversationPath(ownerSubject, conversationId);
  const now = new Date().toISOString();
  const conversation: StoredConversation = {
    id: hashToken(`${ownerSubject}:${conversationId}`).slice(0, 32),
    conversation_id: conversationId,
    user_message: userMessage,
    ai_response: aiResponse,
    sources,
    created_at: now,
    updated_at: now,
    owner_subject_hash: hashToken(ownerSubject).slice(0, 32),
    persistence: 'storage-fallback',
  };

  const { error } = await client.storage
    .from(HISTORY_STORAGE_BUCKET)
    .upload(path, JSON.stringify(conversation, null, 2), {
      contentType: 'application/json',
      upsert: true,
    });

  if (error) {
    console.warn('히스토리 Storage 저장 실패:', error.message);
    return { success: false, conversation: null, message: '히스토리 Storage fallback 저장에 실패했습니다.' };
  }

  return {
    success: true,
    conversation,
    persistence: 'storage-fallback' as const,
    message: buildHistoryMigrationMessage(),
  };
}

async function deleteHistoryFromStorage(client: any, ownerSubject: string, conversationId: string) {
  const bucketReady = await ensureHistoryStorageBucket(client);
  if (!bucketReady) {
    return { success: false, message: '히스토리 Storage fallback을 사용할 수 없습니다.' };
  }

  const { error } = await client.storage
    .from(HISTORY_STORAGE_BUCKET)
    .remove([storageConversationPath(ownerSubject, conversationId)]);

  if (error) {
    console.warn('히스토리 Storage 삭제 실패:', error.message);
    return { success: false, message: '히스토리 Storage fallback 삭제에 실패했습니다.' };
  }

  return {
    success: true,
    persistence: 'storage-fallback' as const,
    message: '대화 히스토리가 삭제되었습니다.',
  };
}

// 대화 히스토리 조회 API
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();

    if (!supabase) {
      return NextResponse.json(
        { error: '서비스가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const owner = await resolveCompassApiOwner(request, searchParams.get('userId'));
    const limit = clampPagination(searchParams.get('limit'), 50, 1, 100);
    const offset = clampPagination(searchParams.get('offset'), 0, 0, 10000);

    if (!owner) {
      return NextResponse.json(
        { error: '로그인 세션이 필요합니다.' },
        { status: 401 }
      );
    }

    // 대화 히스토리 조회
    const { data: conversations, error } = await supabase
      .from('conversations')
      .select('id, conversation_id, user_message, ai_response, sources, created_at, updated_at')
      .eq('owner_subject', owner.ownerSubject)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('대화 히스토리 조회 오류:', error);
      
      // 테이블이 존재하지 않는 경우 빈 배열 반환
      if (isMissingConversationTable(error)) {
        console.warn('conversations 테이블이 존재하지 않습니다. Storage fallback을 조회합니다.');
        return NextResponse.json(await readHistoryFromStorage(supabase, owner.ownerSubject, limit, offset));
      }

      if (isMissingOwnerSubjectColumn(error)) {
        console.warn(`${buildHistoryMigrationMessage()} Storage fallback을 조회합니다.`);
        return NextResponse.json(await readHistoryFromStorage(supabase, owner.ownerSubject, limit, offset));
      }
      
      return NextResponse.json(
        { error: '대화 히스토리를 조회하는 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      conversations: conversations || [],
      total: conversations?.length || 0
    });

  } catch (error) {
    console.error('대화 히스토리 API 오류:', error);
    return NextResponse.json(
      { error: '대화 히스토리 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 대화 히스토리 저장 API
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();

    if (!supabase) {
      return NextResponse.json(
        { error: '서비스가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { userId, userMessage, aiResponse, sources, conversationId } = body;
    const owner = await resolveCompassApiOwner(request, userId);

    if (!owner) {
      return NextResponse.json(
        { error: '로그인 세션이 필요합니다.' },
        { status: 401 }
      );
    }

    if (!userMessage || !aiResponse) {
      return NextResponse.json(
        { error: '필수 필드가 누락되었습니다.' },
        { status: 400 }
      );
    }

    const safeConversationId = typeof conversationId === 'string' && conversationId.trim()
      ? conversationId.trim()
      : `conv_${Date.now()}`;

    // 중복 체크: 같은 conversation_id가 이미 존재하는지 확인
    const { data: existingConversation, error: existingConversationError } = await supabase
      .from('conversations')
      .select('id, conversation_id, user_message, ai_response, sources, created_at, updated_at')
      .eq('conversation_id', safeConversationId)
      .eq('owner_subject', owner.ownerSubject)
      .maybeSingle();

    if (existingConversationError && (isMissingConversationTable(existingConversationError) || isMissingOwnerSubjectColumn(existingConversationError))) {
      console.warn(`${buildHistoryMigrationMessage()} Storage fallback으로 저장합니다.`);
      return NextResponse.json(await saveHistoryToStorage(
        supabase,
        owner.ownerSubject,
        safeConversationId,
        userMessage,
        aiResponse,
        Array.isArray(sources) ? sources : []
      ));
    }

    if (existingConversation) {
      console.log('이미 존재하는 대화입니다. 중복 저장을 건너뜁니다.');
      return NextResponse.json({
        success: false,
        conversation: existingConversation,
        message: '이미 존재하는 대화입니다.'
      });
    }

    // 대화 히스토리 저장
    const { data, error } = await supabase
      .from('conversations')
      .insert({
        user_id: isUuid(owner.ownerSubject) ? owner.ownerSubject : null,
        owner_subject: owner.ownerSubject,
        conversation_id: safeConversationId,
        user_message: userMessage,
        ai_response: aiResponse,
        sources: sources || [],
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('대화 히스토리 저장 오류:', error);
      
      // 테이블이 존재하지 않는 경우 실패로 처리
      if (isMissingConversationTable(error)) {
        console.warn('conversations 테이블이 존재하지 않습니다. Storage fallback으로 저장합니다.');
        return NextResponse.json(await saveHistoryToStorage(
          supabase,
          owner.ownerSubject,
          safeConversationId,
          userMessage,
          aiResponse,
          Array.isArray(sources) ? sources : []
        ));
      }

      if (isMissingOwnerSubjectColumn(error)) {
        console.warn(`${buildHistoryMigrationMessage()} Storage fallback으로 저장합니다.`);
        return NextResponse.json(await saveHistoryToStorage(
          supabase,
          owner.ownerSubject,
          safeConversationId,
          userMessage,
          aiResponse,
          Array.isArray(sources) ? sources : []
        ));
      }
      
      return NextResponse.json(
        { error: '대화 히스토리를 저장하는 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      conversation: data
    });

  } catch (error) {
    console.error('대화 히스토리 저장 API 오류:', error);
    return NextResponse.json(
      { error: '대화 히스토리 저장 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 대화 히스토리 삭제 API
export async function DELETE(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();

    if (!supabase) {
      return NextResponse.json(
        { error: '서비스가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');
    const owner = await resolveCompassApiOwner(request, searchParams.get('userId'));

    if (!owner) {
      return NextResponse.json(
        { error: '로그인 세션이 필요합니다.' },
        { status: 401 }
      );
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: '대화 ID가 필요합니다.' },
        { status: 400 }
      );
    }

    // 대화 히스토리 삭제
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('owner_subject', owner.ownerSubject);

    if (error) {
      console.error('대화 히스토리 삭제 오류:', error);
      
      // 테이블이 존재하지 않는 경우 성공으로 처리
      if (isMissingConversationTable(error)) {
        console.warn('conversations 테이블이 존재하지 않습니다. Storage fallback에서 삭제합니다.');
        return NextResponse.json(await deleteHistoryFromStorage(supabase, owner.ownerSubject, conversationId));
      }

      if (isMissingOwnerSubjectColumn(error)) {
        console.warn(`${buildHistoryMigrationMessage()} Storage fallback에서 삭제합니다.`);
        return NextResponse.json(await deleteHistoryFromStorage(supabase, owner.ownerSubject, conversationId));
      }
      
      return NextResponse.json(
        { error: '대화 히스토리를 삭제하는 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '대화 히스토리가 삭제되었습니다.'
    });

  } catch (error) {
    console.error('대화 히스토리 삭제 API 오류:', error);
    return NextResponse.json(
      { error: '대화 히스토리 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
