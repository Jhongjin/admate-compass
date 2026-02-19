import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';

export interface EmailData {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export type EmailProvider = 'sendgrid' | 'resend' | 'emailjs' | 'nodemailer' | 'console';

export class EmailService {
  private static initialized = false;
  private static provider: EmailProvider = 'console';

  static initialize() {
    if (this.initialized) return;

    // 이메일 알람 서비스 비활성화 (기능은 유지하되 실제 발송 안함)
    this.provider = 'console';
    this.initialized = true;
    console.log('📧 이메일 알람 서비스가 비활성화되었습니다. (기능 유지, 실제 발송 안함)');
  }

  static async send(emailData: EmailData): Promise<boolean> {
    try {
      this.initialize();

      switch (this.provider) {
        case 'sendgrid':
          return await this.sendViaSendGrid(emailData);
        case 'resend':
          return await this.sendViaResend(emailData);
        case 'emailjs':
          return await this.sendViaEmailJS(emailData);
        case 'nodemailer':
          return await this.sendViaNodemailer(emailData);
        case 'console':
        default:
          return await this.sendViaConsole(emailData);
      }

    } catch (error) {
      console.error('❌ 이메일 발송 실패:', error);
      return false;
    }
  }

  private static async sendViaSendGrid(emailData: EmailData): Promise<boolean> {
    const msg = {
      to: emailData.to,
      from: emailData.from || process.env.ALERT_FROM_EMAIL || 'noreply@nasmedia.co.kr',
      subject: emailData.subject,
      html: emailData.html,
    };

    await sgMail.send(msg);
    console.log(`✅ SendGrid 이메일 발송 완료: ${emailData.to}`);
    return true;
  }

  private static async sendViaResend(emailData: EmailData): Promise<boolean> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailData.from || process.env.ALERT_FROM_EMAIL || 'noreply@nasmedia.co.kr',
        to: [emailData.to],
        subject: emailData.subject,
        html: emailData.html,
      }),
    });

    if (!response.ok) {
      throw new Error(`Resend API error: ${response.statusText}`);
    }

    console.log(`✅ Resend 이메일 발송 완료: ${emailData.to}`);
    return true;
  }

  private static async sendViaEmailJS(emailData: EmailData): Promise<boolean> {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env.EMAILJS_TEMPLATE_ID,
        user_id: process.env.EMAILJS_USER_ID,
        template_params: {
          to_email: emailData.to,
          subject: emailData.subject,
          message: emailData.html,
          timestamp: new Date().toLocaleString('ko-KR'),
          log_type: 'system',
          user_id: 'system',
          ip_address: '127.0.0.1',
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`EmailJS API error: ${response.statusText} - ${errorText}`);
    }

    console.log(`✅ EmailJS 이메일 발송 완료: ${emailData.to}`);
    return true;
  }

  private static async sendViaNodemailer(emailData: EmailData): Promise<boolean> {
    try {
      // SMTP 설정 (회사 Outlook)
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'mail.nasmedia.co.kr',
        port: parseInt(process.env.SMTP_PORT || '25'),
        secure: false, // Port 25는 STARTTLS 사용
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        tls: {
          rejectUnauthorized: false,
          ciphers: 'SSLv3'
        },
        // 회사 방화벽/프록시 설정 (필요시)
        connectionTimeout: 60000,
        greetingTimeout: 30000,
        socketTimeout: 60000
      });

      // 이메일 옵션
      const mailOptions = {
        from: emailData.from || process.env.ALERT_FROM_EMAIL || process.env.SMTP_USER,
        to: emailData.to,
        subject: emailData.subject,
        html: emailData.html,
      };

      // 이메일 발송
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ Nodemailer 이메일 발송 완료: ${emailData.to}`, info.messageId);
      return true;

    } catch (error) {
      console.error('❌ Nodemailer 이메일 발송 실패:', error);
      return false;
    }
  }

  private static async sendViaConsole(emailData: EmailData): Promise<boolean> {
    console.log('📧 이메일 발송 시뮬레이션:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📬 받는 사람: ${emailData.to}`);
    console.log(`📝 제목: ${emailData.subject}`);
    console.log(`📄 내용:`);
    console.log(emailData.html);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💡 실제 이메일 발송을 위해서는 이메일 서비스를 설정하세요.');
    return true;
  }

  static async sendAlertEmail(to: string, subject: string, html: string): Promise<boolean> {
    return this.send({
      to,
      subject,
      html,
      from: process.env.ALERT_FROM_EMAIL || 'noreply@nasmedia.co.kr'
    });
  }

  static getCurrentProvider(): EmailProvider {
    this.initialize();
    return this.provider;
  }
}
