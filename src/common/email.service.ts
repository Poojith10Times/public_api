import { Injectable, Logger } from '@nestjs/common';
import * as sgMail from '@sendgrid/mail';

export interface EmailData {
  subject: string;
  message: string;
  from: string;
  to: string | string[];
  cc?: string | string[];
  html?: boolean;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor() {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      this.logger.error('SENDGRID_API_KEY environment variable is not set');
      return;
    }
    
    sgMail.setApiKey(apiKey);
    this.logger.log('SendGrid email service initialized');
  }

  async sendMail(emailData: EmailData): Promise<boolean> {
    try {
      const toEmails = Array.isArray(emailData.to) ? emailData.to : [emailData.to];
      const ccEmails = emailData.cc ? (Array.isArray(emailData.cc) ? emailData.cc : [emailData.cc]) : [];

      // Prepare the email message
      const msg = {
        to: toEmails,
        from: emailData.from,
        subject: emailData.subject,
        text: emailData.html ? undefined : emailData.message,
        html: emailData.html ? emailData.message : `<pre>${this.escapeHtml(emailData.message)}</pre>`,
        cc: ccEmails.length > 0 ? ccEmails : undefined,
      };

      // Send the email
      const response = await sgMail.send(msg);
      
      this.logger.log(`Email sent successfully to ${toEmails.join(', ')}`, {
        subject: emailData.subject,
        statusCode: response[0].statusCode,
      });

      return true;

    } catch (error) {
      this.logger.error('Failed to send email:', {
        error: error.message,
        subject: emailData.subject,
        to: emailData.to,
        response: error.response?.body || 'No response body',
      });

      return false;
    }
  }

//   async sendErrorNotification(error: Error, content: any, endpoint?: string): Promise<boolean> {
//     try {
//       const errorMessage = this.formatErrorMessage(error, content, endpoint);

//       const emailData: EmailData = {
//         subject: 'v1/event/add 5xx',
//         message: errorMessage,
//         from: 'technical@10times.com',
//         // to: 'gaurav@10times.com',
//         // cc: ['keerthana@10times.com']
//         to: 'poojith@10times.com',
//         html: true, 
//       };

//       const success = await this.sendMail(emailData);
      
//       if (success) {
//         this.logger.log('Error notification email sent successfully');
//       } else {
//         this.logger.error('Failed to send error notification email');
//       }

//       return success;

//     } catch (notificationError) {
//       this.logger.error('Exception in sendErrorNotification:', notificationError.message);
//       return false;
//     }
//   }

  private formatErrorMessage(error: Error, content: any, endpoint?: string): string {
    const timestamp = new Date().toISOString();
    const contentString = this.formatContent(content);

    return `
      <h2>Event Creation Error - ${timestamp}</h2>
      
      <h3>Exception Details:</h3>
      <pre>${this.escapeHtml(error.message)}</pre>
      
      <h3>Stack Trace:</h3>
      <pre>${this.escapeHtml(error.stack || 'No stack trace available')}</pre>
      
      ${endpoint ? `<h3>Endpoint:</h3><p>${this.escapeHtml(endpoint)}</p>` : ''}
      
      <h3>Request Content:</h3>
      <pre>${this.escapeHtml(contentString)}</pre>
      
      <hr>
      <p><small>Sent from NestJS Event Service</small></p>
    `;
  }

  private formatContent(content: any): string {
    try {
      if (typeof content === 'object') {
        const params = new URLSearchParams();
        
        const flattenObject = (obj: any, prefix = '') => {
          for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
              const value = obj[key];
              const newKey = prefix ? `${prefix}[${key}]` : key;
              
              if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                flattenObject(value, newKey);
              } else if (Array.isArray(value)) {
                value.forEach((item, index) => {
                  if (typeof item === 'object') {
                    flattenObject(item, `${newKey}[${index}]`);
                  } else {
                    params.append(`${newKey}[${index}]`, String(item));
                  }
                });
              } else {
                params.append(newKey, String(value));
              }
            }
          }
        };

        flattenObject(content);
        return params.toString().replace(/&/g, ', ');
      }
      
      return String(content);
    } catch (error) {
      return `Error formatting content: ${error.message}`;
    }
  }

  private escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

async sendErrorNotification(error: Error, content: any, endpoint?: string): Promise<boolean> {
  try {
    
    const errorMessage = this.formatErrorMessage(error, content, endpoint);

    const emailData: EmailData = {
      subject: 'v1/event/add 5xx',
      message: errorMessage,
      from: 'technical@10times.com',
      to: 'poojith@10times.com',
      html: true,
    };

    this.logger.log('Email data prepared:', {
      subject: emailData.subject,
      to: emailData.to,
      from: emailData.from
    });

    const success = await this.sendMail(emailData);
    
    if (success) {
      this.logger.log('Error notification email sent successfully');
    } else {
      this.logger.error('Failed to send error notification email');
    }

    return success;

  } catch (notificationError) {
    this.logger.error('Exception in sendErrorNotification:', notificationError.message);
    return false;
  }
}

}