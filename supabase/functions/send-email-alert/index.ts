// Supabase Edge Function - 이메일 알림 발송
// log_alerts 테이블에 새로운 알림이 생성되면 자동으로 이메일 발송

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_URL = 'https://api.resend.com/emails'
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const ALERT_FROM_EMAIL = Deno.env.get('ALERT_FROM_EMAIL') || 'noreply@nasmedia.co.kr'
const ALERT_TO_EMAIL = Deno.env.get('ALERT_TO_EMAIL') || 'adso@nasmedia.co.kr'
const SITE_URL = Deno.env.get('NEXT_PUBLIC_SITE_URL') || 'https://your-domain.com'

interface EmailAlertPayload {
  alertId: number
  logId: string
  logLevel: string
  logType: string
  logMessage: string
  logTimestamp: string
  userId?: string
  ipAddress?: string
}

function generateEmailHTML(alert: EmailAlertPayload): string {
  const levelColor = alert.logLevel === 'error' ? '#dc2626' : '#f59e0b'
  const levelText = alert.logLevel === 'error' ? '오류' : '경고'
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>시스템 로그 알림</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">🚨 시스템 로그 알림</h1>
  </div>
  
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid ${levelColor};">
      <div style="display: flex; align-items: center; margin-bottom: 15px;">
        <span style="background: ${levelColor}; color: white; padding: 6px 12px; border-radius: 4px; font-weight: bold; font-size: 12px; text-transform: uppercase;">
          ${levelText}
        </span>
        <span style="margin-left: 10px; color: #6b7280; font-size: 14px;">
          ${alert.logType}
        </span>
      </div>
      
      <h2 style="color: #111827; margin: 0 0 15px 0; font-size: 18px;">${alert.logMessage}</h2>
      
      <div style="background: #f3f4f6; padding: 15px; border-radius: 6px; margin-top: 15px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 120px;">로그 ID:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px; font-family: monospace;">${alert.logId}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">발생 시간:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px;">${new Date(alert.logTimestamp).toLocaleString('ko-KR')}</td>
          </tr>
          ${alert.userId ? `
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">사용자 ID:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px;">${alert.userId}</td>
          </tr>
          ` : ''}
          ${alert.ipAddress ? `
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">IP 주소:</td>
            <td style="padding: 8px 0; color: #111827; font-size: 14px;">${alert.ipAddress}</td>
          </tr>
          ` : ''}
        </table>
      </div>
    </div>
    
    <div style="text-align: center; margin-top: 30px;">
      <a href="${SITE_URL}/admin/logs/acknowledge/${alert.alertId}" 
         style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
        알림 확인하기
      </a>
    </div>
    
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 12px;">
      <p style="margin: 0;">이 이메일은 Meta FAQ AI 챗봇 시스템에서 자동으로 발송되었습니다.</p>
      <p style="margin: 5px 0 0 0;">관리자가 확인할 때까지 1시간마다 재발송됩니다.</p>
    </div>
  </div>
</body>
</html>
  `.trim()
}

serve(async (req) => {
  // CORS 헤더 설정
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  // OPTIONS 요청 처리
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 요청 본문 파싱
    const payload: EmailAlertPayload = await req.json()

    // 필수 필드 검증
    if (!payload.alertId || !payload.logId || !payload.logLevel || !payload.logMessage) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: '필수 필드가 누락되었습니다.' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Resend API 키 확인
    if (!RESEND_API_KEY) {
      console.error('❌ RESEND_API_KEY가 설정되지 않았습니다.')
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: '이메일 서비스가 설정되지 않았습니다.' 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // 이메일 HTML 생성
    const emailHTML = generateEmailHTML(payload)
    const subject = `[${payload.logLevel.toUpperCase()}] 시스템 로그 알림 - ${new Date(payload.logTimestamp).toLocaleString('ko-KR')}`

    // Resend API 호출
    const resendResponse = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: ALERT_FROM_EMAIL,
        to: [ALERT_TO_EMAIL],
        subject: subject,
        html: emailHTML,
      }),
    })

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text()
      console.error('❌ Resend API 오류:', errorText)
      throw new Error(`Resend API 오류: ${resendResponse.statusText}`)
    }

    const result = await resendResponse.json()
    console.log(`✅ 이메일 발송 완료: Alert ID ${payload.alertId}, Email ID: ${result.id}`)

    // Supabase 클라이언트 생성 (알림 상태 업데이트용)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false }
      })

      // 이메일 발송 후 알림 상태 업데이트
      const { error: updateError } = await supabase
        .from('log_alerts')
        .update({
          last_sent_at: new Date().toISOString(),
          email_count: supabase.rpc('increment_email_count', { alert_id: payload.alertId }),
          next_send_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1시간 후
        })
        .eq('id', payload.alertId)

      if (updateError) {
        console.error('⚠️ 알림 상태 업데이트 실패:', updateError)
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: '이메일이 성공적으로 발송되었습니다.',
        alertId: payload.alertId,
        emailId: result.id,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('❌ 이메일 발송 실패:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : '이메일 발송에 실패했습니다.' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})




