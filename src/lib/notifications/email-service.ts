// src/lib/notifications/email-service.ts

import nodemailer from 'nodemailer';

interface EmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  notificationId?: string;
}

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export class EmailService {
  private static transporter: nodemailer.Transporter | null = null;

  // Initialize email transporter
  private static getTransporter() {
    if (!this.transporter) {
      const config: EmailConfig = {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASSWORD || ''
        }
      };

      // Validate configuration
      if (!config.auth.user || !config.auth.pass) {
        console.warn('Email service not configured. Set SMTP_USER and SMTP_PASSWORD environment variables.');
        return null;
      }

      this.transporter = nodemailer.createTransport(config);
    }

    return this.transporter;
  }

  // Send email notification
  static async sendEmail(params: EmailParams): Promise<boolean> {
    const transporter = this.getTransporter();
    
    if (!transporter) {
      console.warn('Email not sent - transporter not configured');
      return false;
    }

    try {
      const mailOptions = {
        from: `"AI Game Master" <${process.env.SMTP_USER}>`,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text || this.htmlToText(params.html),
        headers: {
          'X-Notification-ID': params.notificationId || '',
          'X-Mailer': 'AI-GM-App'
        }
      };

      const result = await transporter.sendMail(mailOptions);
      console.log('Email sent successfully:', result.messageId);
      return true;

    } catch (error) {
      console.error('Failed to send email:', error);
      return false;
    }
  }

  // Send welcome email to new users
  static async sendWelcomeEmail(userEmail: string, userName: string) {
    const subject = '🎮 Welcome to AI Game Master!';
    const html = this.buildWelcomeEmailTemplate(userName);

    return await this.sendEmail({
      to: userEmail,
      subject,
      html
    });
  }

  // Send campaign invitation email
  static async sendCampaignInviteEmail(
    userEmail: string, 
    campaignTitle: string, 
    inviterName: string,
    inviteToken: string
  ) {
    const subject = `🎲 You're invited to join "${campaignTitle}"`;
    const html = this.buildInviteEmailTemplate(campaignTitle, inviterName, inviteToken);

    return await this.sendEmail({
      to: userEmail,
      subject,
      html
    });
  }

  // Send daily digest email
  static async sendDailyDigest(
    userEmail: string, 
    userName: string,
    digestData: {
      unreadNotifications: number;
      activeCampaigns: string[];
      recentActivity: Array<{
        campaignTitle: string;
        activityType: string;
        description: string;
        timestamp: Date;
      }>;
    }
  ) {
    const subject = '📊 Your Daily AI GM Digest';
    const html = this.buildDigestEmailTemplate(userName, digestData);

    return await this.sendEmail({
      to: userEmail,
      subject,
      html
    });
  }

  // Send password reset email
  static async sendPasswordResetEmail(userEmail: string, resetToken: string) {
    const subject = '🔒 Reset Your AI GM Password';
    const html = this.buildPasswordResetTemplate(resetToken);

    return await this.sendEmail({
      to: userEmail,
      subject,
      html
    });
  }

  // Build welcome email template
  private static buildWelcomeEmailTemplate(userName: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
        <div style="background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1e40af; margin: 0; font-size: 28px;">🎮 AI Game Master</h1>
            <p style="color: #64748b; margin: 10px 0 0 0;">Your AI-powered tabletop RPG experience</p>
          </div>

          <h2 style="color: #1e3a8a;">Welcome, ${userName}!</h2>
          
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">
            You've successfully joined the future of tabletop RPGs! Our AI Game Master is ready to create 
            unlimited adventures, manage complex campaigns, and bring your stories to life.
          </p>

          <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
            <h3 style="color: #1e40af; margin: 0 0 10px 0;">🚀 Ready to Start?</h3>
            <ul style="color: #1e40af; margin: 0; padding-left: 20px;">
              <li>Create your first campaign</li>
              <li>Invite friends to join</li>
              <li>Build your characters</li>
              <li>Let the AI weave epic tales!</li>
            </ul>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/campaigns" 
               style="background: #2563eb; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              Start Your Adventure
            </a>
          </div>

          <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
            <p style="font-size: 14px; color: #6b7280; text-align: center; margin: 0;">
              Questions? Reply to this email or check our 
              <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/help" style="color: #2563eb;">help center</a>.
            </p>
          </div>
        </div>
      </div>
    `;
  }

  // Build campaign invite email template
  private static buildInviteEmailTemplate(
    campaignTitle: string, 
    inviterName: string, 
    inviteToken: string
  ): string {
    const joinUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/join/${inviteToken}`;

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
        <div style="background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1e40af; margin: 0; font-size: 28px;">🎲 Campaign Invitation</h1>
          </div>

          <h2 style="color: #1e3a8a;">You're Invited!</h2>
          
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">
            <strong>${inviterName}</strong> has invited you to join the campaign:
          </p>

          <div style="background: #f0fdf4; border: 2px solid #22c55e; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
            <h3 style="color: #15803d; margin: 0; font-size: 22px;">"${campaignTitle}"</h3>
          </div>

          <p style="font-size: 16px; line-height: 1.6; color: #374151;">
            Join this AI-powered campaign where epic adventures await! Create your character, 
            collaborate with other players, and experience stories guided by our intelligent Game Master.
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${joinUrl}" 
               style="background: #22c55e; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 16px;">
              Join Campaign
            </a>
          </div>

          <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
            <p style="color: #92400e; margin: 0; font-size: 14px;">
              <strong>Note:</strong> This invitation link will expire in 7 days. 
              Don't wait too long to join the adventure!
            </p>
          </div>

          <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
            <p style="font-size: 12px; color: #6b7280; text-align: center; margin: 0;">
              If you didn't expect this invitation, you can safely ignore this email.
              <br>Invitation Code: ${inviteToken}
            </p>
          </div>
        </div>
      </div>
    `;
  }

  // Build daily digest email template
  private static buildDigestEmailTemplate(
    userName: string,
    digestData: any
  ): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
        <div style="background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h1 style="color: #1e40af; margin: 0 0 20px 0; font-size: 24px;">📊 Daily Digest</h1>
          
          <p style="color: #374151; margin-bottom: 25px;">Hi ${userName}, here's your AI GM activity summary:</p>

          <div style="display: grid; gap: 15px; margin-bottom: 25px;">
            <div style="background: #eff6ff; border-radius: 6px; padding: 15px;">
              <h3 style="color: #1e40af; margin: 0 0 5px 0; font-size: 16px;">🔔 Notifications</h3>
              <p style="color: #374151; margin: 0; font-size: 14px;">
                ${digestData.unreadNotifications} unread notification${digestData.unreadNotifications !== 1 ? 's' : ''}
              </p>
            </div>
            
            <div style="background: #f0fdf4; border-radius: 6px; padding: 15px;">
              <h3 style="color: #15803d; margin: 0 0 5px 0; font-size: 16px;">🎮 Active Campaigns</h3>
              <p style="color: #374151; margin: 0; font-size: 14px;">
                ${digestData.activeCampaigns.join(', ') || 'No active campaigns'}
              </p>
            </div>
          </div>

          <div style="text-align: center; margin-top: 30px;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/campaigns" 
               style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              View Campaigns
            </a>
          </div>
        </div>
      </div>
    `;
  }

  // Build password reset email template
  private static buildPasswordResetTemplate(resetToken: string): string {
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/reset-password?token=${resetToken}`;

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
        <div style="background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h1 style="color: #dc2626; margin: 0 0 20px 0; font-size: 24px;">🔒 Password Reset</h1>
          
          <p style="color: #374151; line-height: 1.6;">
            You requested a password reset for your AI Game Master account. 
            Click the button below to create a new password:
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background: #dc2626; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              Reset Password
            </a>
          </div>

          <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0;">
            <p style="color: #991b1b; margin: 0; font-size: 14px;">
              <strong>Security Note:</strong> This link expires in 1 hour. 
              If you didn't request this reset, please ignore this email.
            </p>
          </div>
        </div>
      </div>
    `;
  }

  // Convert HTML to plain text (fallback)
  private static htmlToText(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Test email configuration
  static async testConnection(): Promise<boolean> {
    const transporter = this.getTransporter();
    
    if (!transporter) {
      return false;
    }

    try {
      await transporter.verify();
      return true;
    } catch (error) {
      console.error('Email configuration test failed:', error);
      return false;
    }
  }
}

export const sendEmail = EmailService.sendEmail.bind(EmailService);
export default EmailService;
