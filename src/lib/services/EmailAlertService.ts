import { createClient } from '@supabase/supabase-js';

// 환경 변수 확인 및 조건부 클라이언트 생성
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: any = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

export interface LogAlert {
  id: string;
  log_id: string;
  log_level: string;
  log_type: string;
  log_message: string;
  log_timestamp: string;
  user_id?: string;
  ip_address?: string;
  alert_status: 'pending' | 'acknowledged' | 'resolved';
  first_sent_at: string;
  last_sent_at: string;
  next_send_at: string;
  acknowledged_by?: string;
  acknowledged_at?: string;
  resolved_at?: string;
  email_count: number;
  created_at: string;
  updated_at: string;
}

export class EmailAlertService {
  private static readonly ALERT_EMAIL = 'adso@nasmedia.co.kr';
  private static readonly ALERT_LEVELS = ['warning', 'error'];
  private static readonly RESEND_INTERVAL_HOURS = 1;

  /**
   * 로그 레벨이 경고 또는 오류인지 확인
   */
  static shouldSendAlert(logLevel: string): boolean {
    return this.ALERT_LEVELS.includes(logLevel.toLowerCase());
  }

  /**
   * 새로운 로그 알림 생성 또는 기존 알림 업데이트
   */
  static async createOrUpdateAlert(logData: {
    log_id: string;
    log_level: string;
    log_type: string;
    log_message: string;
    log_timestamp: string;
    user_id?: string;
    ip_address?: string;
  }): Promise<void> {
    if (!this.shouldSendAlert(logData.log_level)) {
      return;
    }

    try {
      // 기존 알림 확인
      const { data: existingAlert } = await supabase
        .from('log_alerts')
        .select('*')
        .eq('log_id', logData.log_id)
        .eq('alert_status', 'pending')
        .single();

      if (existingAlert) {
        // 기존 알림이 있으면 업데이트
        await supabase
          .from('log_alerts')
          .update({
            log_message: logData.log_message,
            log_timestamp: logData.log_timestamp,
            user_id: logData.user_id,
            ip_address: logData.ip_address,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingAlert.id);
      } else {
        // 새로운 알림 생성
        const nextSendAt = new Date();
        nextSendAt.setHours(nextSendAt.getHours() + this.RESEND_INTERVAL_HOURS);

        await supabase
          .from('log_alerts')
          .insert({
            log_id: logData.log_id,
            log_level: logData.log_level,
            log_type: logData.log_type,
            log_message: logData.log_message,
            log_timestamp: logData.log_timestamp,
            user_id: logData.user_id,
            ip_address: logData.ip_address,
            next_send_at: nextSendAt.toISOString()
          });
      }
    } catch (error) {
      console.error('로그 알림 생성/업데이트 실패:', error);
    }
  }

  /**
   * 발송 대기 중인 알림들을 처리
   */
  static async processPendingAlerts(): Promise<void> {
    try {
      const now = new Date().toISOString();
      
      // 발송 대기 중인 알림 조회
      const { data: pendingAlerts, error } = await supabase
        .from('log_alerts')
        .select('*')
        .eq('alert_status', 'pending')
        .lte('next_send_at', now)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('대기 중인 알림 조회 실패:', error);
        return;
      }

      if (!pendingAlerts || pendingAlerts.length === 0) {
        return;
      }

      console.log(`📧 ${pendingAlerts.length}개의 로그 알림을 처리합니다.`);

      for (const alert of pendingAlerts) {
        await this.sendAlertEmail(alert);
        await this.updateAlertAfterSend(alert);
      }
    } catch (error) {
      console.error('대기 중인 알림 처리 실패:', error);
    }
  }

  /**
   * 알림 이메일 발송
   */
  private static async sendAlertEmail(alert: LogAlert): Promise<void> {
    try {
      const emailContent = this.generateEmailContent(alert);
      
      // 실제 이메일 발송 API 호출 (예: SendGrid, AWS SES 등)
      // 여기서는 콘솔에 로그로 대체
      console.log('📧 이메일 발송:', {
        to: this.ALERT_EMAIL,
        subject: `[${alert.log_level.toUpperCase()}] 시스템 로그 알림 - ${new Date().toLocaleString()}`,
        content: emailContent
      });

      // 실제 이메일 발송을 위한 API 엔드포인트 호출
      const response = await fetch('/api/admin/logs/send-alert-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: this.ALERT_EMAIL,
          subject: `[${alert.log_level.toUpperCase()}] 시스템 로그 알림 - ${new Date().toLocaleString()}`,
          content: emailContent,
          alertId: alert.id
        }),
      });

      if (!response.ok) {
        throw new Error(`이메일 발송 실패: ${response.statusText}`);
      }

      console.log(`✅ 알림 이메일 발송 완료: ${alert.id}`);
    } catch (error) {
      console.error('이메일 발송 실패:', error);
    }
  }

  /**
   * 이메일 발송 후 알림 상태 업데이트
   */
  private static async updateAlertAfterSend(alert: LogAlert): Promise<void> {
    try {
      const nextSendAt = new Date();
      nextSendAt.setHours(nextSendAt.getHours() + this.RESEND_INTERVAL_HOURS);

      await supabase
        .from('log_alerts')
        .update({
          last_sent_at: new Date().toISOString(),
          next_send_at: nextSendAt.toISOString(),
          email_count: alert.email_count + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', alert.id);

      console.log(`📝 알림 상태 업데이트 완료: ${alert.id}`);
    } catch (error) {
      console.error('알림 상태 업데이트 실패:', error);
    }
  }

  /**
   * 이메일 내용 생성
   */
  private static generateEmailContent(alert: LogAlert): string {
    const levelEmoji = alert.log_level === 'error' ? '🚨' : '⚠️';
    const levelColor = alert.log_level === 'error' ? '#dc2626' : '#d97706';
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Malgun Gothic', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #1f2937, #374151); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
        .alert-box { background: ${levelColor}; color: white; padding: 15px; border-radius: 6px; margin: 15px 0; }
        .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        .info-table th, .info-table td { padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        .info-table th { background: #f3f4f6; font-weight: 600; }
        .footer { margin-top: 20px; padding: 15px; background: #e5e7eb; border-radius: 6px; font-size: 14px; }
        .button { display: inline-block; padding: 10px 20px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 10px 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${levelEmoji} 시스템 로그 알림</h1>
            <p>Meta 광고 FAQ AI 챗봇 시스템에서 ${alert.log_level === 'error' ? '오류' : '경고'}가 발생했습니다.</p>
        </div>
        
        <div class="content">
            <div class="alert-box">
                <h2>${alert.log_level === 'error' ? '🚨 오류 발생' : '⚠️ 경고 발생'}</h2>
                <p><strong>메시지:</strong> ${alert.log_message}</p>
            </div>
            
            <table class="info-table">
                <tr><th>로그 ID</th><td>${alert.log_id}</td></tr>
                <tr><th>로그 레벨</th><td><strong>${alert.log_level.toUpperCase()}</strong></td></tr>
                <tr><th>로그 유형</th><td>${alert.log_type}</td></tr>
                <tr><th>발생 시간</th><td>${new Date(alert.log_timestamp).toLocaleString()}</td></tr>
                ${alert.user_id ? `<tr><th>사용자 ID</th><td>${alert.user_id}</td></tr>` : ''}
                ${alert.ip_address ? `<tr><th>IP 주소</th><td>${alert.ip_address}</td></tr>` : ''}
                <tr><th>발송 횟수</th><td>${alert.email_count}회</tr>
                <tr><th>최초 발생</th><td>${new Date(alert.first_sent_at).toLocaleString()}</td></tr>
            </table>
            
            <div style="margin: 20px 0;">
                <a href="${process.env.NEXT_PUBLIC_SITE_URL}/admin/logs" class="button">로그 확인하기</a>
                <a href="${process.env.NEXT_PUBLIC_SITE_URL}/admin/logs/acknowledge/${alert.id}" class="button" style="background: #10b981;">알림 확인</a>
            </div>
        </div>
        
        <div class="footer">
            <p><strong>알림 설정:</strong></p>
            <ul>
                <li>이 알림은 1시간마다 재발송됩니다.</li>
                <li>관리자가 확인하기 전까지 계속 발송됩니다.</li>
                <li>로그 확인 후 '알림 확인' 버튼을 클릭하여 재발송을 중단할 수 있습니다.</li>
            </ul>
            <p style="margin-top: 15px; font-size: 12px; color: #6b7280;">
                이 이메일은 Meta 광고 FAQ AI 챗봇 시스템에서 자동으로 발송되었습니다.
            </p>
        </div>
    </div>
</body>
</html>
    `.trim();
  }

  /**
   * 알림 확인 처리
   */
  static async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('log_alerts')
        .update({
          alert_status: 'acknowledged',
          acknowledged_by: acknowledgedBy,
          acknowledged_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', alertId);

      if (error) {
        console.error('알림 확인 처리 실패:', error);
        return false;
      }

      console.log(`✅ 알림 확인 처리 완료: ${alertId}`);
      return true;
    } catch (error) {
      console.error('알림 확인 처리 실패:', error);
      return false;
    }
  }

  /**
   * 알림 해결 처리
   */
  static async resolveAlert(alertId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('log_alerts')
        .update({
          alert_status: 'resolved',
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', alertId);

      if (error) {
        console.error('알림 해결 처리 실패:', error);
        return false;
      }

      console.log(`✅ 알림 해결 처리 완료: ${alertId}`);
      return true;
    } catch (error) {
      console.error('알림 해결 처리 실패:', error);
      return false;
    }
  }

  /**
   * 알림 목록 조회
   */
  static async getAlerts(
    status?: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ alerts: LogAlert[]; total: number }> {
    try {
      // Supabase 클라이언트 확인
      if (!supabase) {
        console.warn('Supabase 클라이언트가 초기화되지 않았습니다.');
        return { alerts: [], total: 0 };
      }

      let query = supabase
        .from('log_alerts')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('alert_status', status);
      }

      const { data, error, count } = await query
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('알림 목록 조회 실패:', error);
        return { alerts: [], total: 0 };
      }

      return { alerts: data || [], total: count || 0 };
    } catch (error) {
      console.error('알림 목록 조회 실패:', error);
      return { alerts: [], total: 0 };
    }
  }
}

