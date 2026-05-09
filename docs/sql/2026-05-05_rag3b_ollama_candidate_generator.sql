-- Gate RAG-3B: ollama_document_chunks candidate generator.
-- Run in Admate-Vision SQL Editor only.
-- SELECT-only. Do not execute INSERT/UPDATE/DELETE/TRUNCATE/DROP/ALTER.
-- Purpose: find balanced, high-quality candidate chunks from compass.document_chunks
-- for a future data-only compass.ollama_document_chunks expansion.

with
base_chunks as (
  select
    c.id,
    c.document_id,
    c.chunk_id,
    c.content,
    c.metadata,
    coalesce(nullif(c.metadata->>'title', ''), nullif(c.metadata->>'source', ''), d.title, '') as source_title,
    coalesce(nullif(c.metadata->>'source_url', ''), nullif(c.metadata->>'document_url', ''), d.document_url, d.url, '') as source_url,
    d.title as parent_title,
    d.document_url as parent_document_url,
    d.url as parent_url,
    lower(
      concat_ws(
        ' ',
        c.id::text,
        c.document_id::text,
        c.chunk_id::text,
        coalesce(c.metadata->>'title', ''),
        coalesce(c.metadata->>'source', ''),
        coalesce(d.title, ''),
        coalesce(c.content, ''),
        coalesce(c.metadata::text, '')
      )
    ) as haystack
  from compass.document_chunks c
  left join compass.documents d on d.id = c.document_id
  where c.content is not null
),
classified as (
  select
    *,
    case
      when haystack ~ '(kakao|카카오|카카오톡|톡채널|비즈보드|모먼트)' then 'KAKAO'
      when haystack ~ '(naver|네이버|쇼핑검색|파워링크|브랜드검색)' then 'NAVER'
      when haystack ~ '(google|구글|youtube|유튜브|gdn|google ads)' then 'GOOGLE'
      when haystack ~ '(meta|facebook|페이스북|instagram|인스타그램|reels|릴스)' then 'META'
      else 'UNKNOWN'
    end as source_vendor,
    array_remove(array[
      case when haystack ~ '(심사|승인|반려|집행 기준|준수사항)' then 'review' end,
      case when haystack ~ '(청소년|유해|성인|연령)' then 'youth' end,
      case when haystack ~ '(허위|과장|오인|기만)' then 'false_claim' end,
      case when haystack ~ '(가격|할인|할인율)' then 'price' end,
      case when haystack ~ '(이벤트|경품|참여|당첨)' then 'event' end,
      case when haystack ~ '(상표|저작권|초상권|권리|로고|서비스)' then 'rights' end,
      case when haystack ~ '(혐오|차별|비하)' then 'hate' end,
      case when haystack ~ '(도박|사행)' then 'gambling' end,
      case when haystack ~ '(사이즈|크기|파일|형식|스펙|동영상|이미지|카루셀)' then 'spec' end
    ], null) as topic_labels
  from base_chunks
),
fixture_matches as (
  select
    *,
    array_remove(array[
      case when haystack like '%카카오%' and haystack like '%심사%' and haystack like '%기준%' then 'kakao-review-standards' end,
      case when haystack like '%카카오%' and haystack like '%청소년%' and haystack like '%유해%' then 'kakao-youth-harmful-content' end,
      case when haystack like '%가격%' and haystack like '%할인%' then 'kakao-price-discount' end,
      case when haystack like '%카카오%' and haystack like '%로고%' and haystack like '%서비스%' then 'kakao-kakao-service-protection' end,
      case when (haystack like '%google%' or haystack like '%구글%') and haystack like '%광고%' and haystack like '%정책%' then 'google-ads-policy' end,
      case when haystack like '%도박%' and haystack like '%사행%' then 'gambling-policy' end
    ], null) as fixture_matches
  from classified
),
scored as (
  select
    *,
    md5(regexp_replace(left(content, 1600), '\s+', ' ', 'g')) as content_fingerprint,
    char_length(content) as content_length,
    case when source_title <> '' then 1 else 0 end as has_title,
    case when source_url <> '' then 1 else 0 end as has_url,
    case when source_vendor <> 'UNKNOWN' then 1 else 0 end as has_vendor_term,
    case when cardinality(topic_labels) > 0 then 1 else 0 end as has_topic_term,
    case when cardinality(fixture_matches) > 0 then 1 else 0 end as has_fixture_match,
    case
      when content ~* '(document\.queryselector|__next|webpack|function\(|var |const |window\.|cookie|로그인|회원가입|뒤로가기|breadcrumb|footer|header|이전 다음|was this helpful|last updated)'
        then 1
      else 0
    end as noisy_pattern,
    (
      20
      + case when source_title <> '' then 12 else 0 end
      + case when source_url <> '' then 8 else 0 end
      + case when source_vendor <> 'UNKNOWN' then 14 else 0 end
      + least(cardinality(topic_labels) * 8, 24)
      + least(cardinality(fixture_matches) * 14, 28)
      + case when char_length(content) between 250 and 1800 then 12 else 0 end
      + case when char_length(content) between 80 and 2400 then 6 else -12 end
      - case
          when content ~* '(document\.queryselector|__next|webpack|function\(|var |const |window\.|cookie|로그인|회원가입|뒤로가기|breadcrumb|footer|header|이전 다음|was this helpful|last updated)'
            then 40
          else 0
        end
    ) as quality_score
  from fixture_matches
),
eligible as (
  select *
  from scored
  where source_vendor in ('KAKAO', 'NAVER', 'GOOGLE', 'META')
    and has_title = 1
    and has_vendor_term = 1
    and has_topic_term = 1
    and noisy_pattern = 0
    and char_length(content) between 80 and 2400
),
deduped as (
  select *
  from (
    select
      *,
      row_number() over (
        partition by source_vendor, content_fingerprint
        order by quality_score desc, has_fixture_match desc, has_url desc, content_length desc
      ) as fingerprint_rank,
      row_number() over (
        partition by source_vendor, document_id, chunk_id
        order by quality_score desc
      ) as chunk_rank
    from eligible
  ) ranked
  where fingerprint_rank = 1
    and chunk_rank = 1
),
vendor_ranked as (
  select
    *,
    row_number() over (
      partition by source_vendor
      order by has_fixture_match desc, quality_score desc, has_url desc, content_length desc
    ) as vendor_rank
  from deduped
),
fixture_ranked as (
  select
    id,
    fixture_id,
    row_number() over (
      partition by fixture_id
      order by quality_score desc, has_url desc, content_length desc
    ) as fixture_rank
  from deduped
  cross join lateral unnest(fixture_matches) as fixture_id
),
selected_ids as (
  select id
  from vendor_ranked
  where vendor_rank <= 50

  union

  select id
  from fixture_ranked
  where fixture_rank <= 20
),
selected as (
  select v.*
  from vendor_ranked v
  join selected_ids s on s.id = v.id
),
final_candidates as (
  select distinct on (source_vendor, content_fingerprint)
    source_vendor,
    case
      when source_vendor = 'KAKAO' then '카카오 광고 심사 가이드'
      when source_vendor = 'NAVER' then '네이버 광고 가이드'
      when source_vendor = 'GOOGLE' then 'Google Ads 가이드'
      when source_vendor = 'META' then 'Meta 광고 정책'
      else source_title
    end as canonical_title,
    source_title,
    source_url,
    document_id as source_document_id,
    chunk_id as source_chunk_id,
    id as source_row_id,
    topic_labels,
    fixture_matches,
    quality_score,
    content_length,
    has_url,
    left(content, 700) as content_preview,
    jsonb_build_object(
      'source_vendor', source_vendor,
      'canonical_title', case
        when source_vendor = 'KAKAO' then '카카오 광고 심사 가이드'
        when source_vendor = 'NAVER' then '네이버 광고 가이드'
        when source_vendor = 'GOOGLE' then 'Google Ads 가이드'
        when source_vendor = 'META' then 'Meta 광고 정책'
        else source_title
      end,
      'original_title', source_title,
      'source_document_id', document_id,
      'source_chunk_id', chunk_id,
      'source_url', source_url,
      'topic_labels', topic_labels,
      'fixture_matches', fixture_matches,
      'candidate_quality_score', quality_score,
      'candidate_generated_at', now()
    ) as proposed_metadata
  from selected
  order by source_vendor, content_fingerprint, quality_score desc, has_fixture_match desc
)
select *
from final_candidates
order by
  source_vendor,
  case when cardinality(fixture_matches) > 0 then 0 else 1 end,
  quality_score desc,
  content_length desc
limit 200;
