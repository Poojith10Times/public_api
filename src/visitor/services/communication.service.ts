import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email.service';
import { event_visitor, user } from '@prisma/client';

@Injectable()
export class CommunicationService {
  private readonly logger = new Logger(CommunicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async sendRegistrationCommunications(visitor: event_visitor): Promise<void> {
    try {
      if (!visitor.user) {
        this.logger.warn(`Visitor ID ${visitor.id} is missing a user association. Cannot send emails.`);
        return;
      }
      
      const visitorUser = await this.prisma.user.findUnique({
        where: { id: visitor.user },
      });

      if (!visitorUser) {
        this.logger.warn(`User not found for visitor ID: ${visitor.id}. Cannot send emails.`);
        return;
      }

      // Send email to the visitor
      if (visitorUser.email) {
        this.sendVisitorConfirmation(visitor, visitorUser);
      }

      // Send email to the event and company organizers/POCs
      this.sendOrganizerNotification(visitor, visitorUser);

    } catch (error) {
      this.logger.error(`Failed to send registration communications for visitor ${visitor.id}`, error);
    }
  }

  private async sendVisitorConfirmation(visitor: event_visitor, user: user): Promise<void> {
    const subject = `Registration Confirmed for Event ID: ${visitor.event}`;
    const message = `
      Hello ${user.name || 'User'},

      This email confirms your registration for Event ID: ${visitor.event}.
      Your Visitor ID is: ${visitor.id}.

      Thank you!
    `;

    await this.emailService.sendMail({
      to: user.email!,
      from: 'noreply@10times.com',
      subject,
      message,
    });
    this.logger.log(`Confirmation email sent to visitor: ${user.email}`);
  }

  private async sendOrganizerNotification(visitor: event_visitor, registeredUser: user): Promise<void> {
    const pocs = await this.getEventPocs(visitor.event);

    if (pocs.length > 0) {
      const pocEmails = pocs.map(poc => poc.email).filter((email): email is string => !!email);
      if (pocEmails.length === 0) {
        this.logger.log(`No POCs with emails found for event ${visitor.event}.`);
        return;
      }
      
      const subject = `New Visitor Registration for Event ID: ${visitor.event}`;
      const message = `
          A new visitor has registered for your event.

          Event ID: ${visitor.event}
          Visitor ID: ${visitor.id}
          User ID: ${registeredUser.id}
          User Name: ${registeredUser.name}
          User Email: ${registeredUser.email}
      `;

      await this.emailService.sendMail({
          to: pocEmails,
          from: 'noreply@10times.com',
          subject,
          message,
      });
      this.logger.log(`Organizer notification sent to: ${pocEmails.join(', ')}`);
    } else {
        this.logger.log(`No organizer (POC) found for event ${visitor.event}. Skipping notification.`);
    }
  }

  private async getEventPocs(eventId: number): Promise<user[]> {
    // 1. Find Event POCs
    const eventPocContacts = await this.prisma.contact.findMany({
      where: { entity_type: 1, entity_id: eventId, published: 1 },
    });

    // 2. Find Company POCs
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        event_edition_event_event_editionToevent_edition: {
          select: { company_id: true }
        }
      }
    });

    const companyId = event?.event_edition_event_event_editionToevent_edition?.company_id;
    let companyPocContacts: { user_reference: number | null }[] = [];
    if (companyId) {
      companyPocContacts = await this.prisma.contact.findMany({
        where: { entity_type: 2, entity_id: companyId, published: 1 }
      });
    }

    // 3. Combine and get unique user IDs
    const allPocUserIds = [...eventPocContacts, ...companyPocContacts]
      .map(c => c.user_reference)
      .filter((id): id is number => id !== null);
      
    const uniqueUserIds = [...new Set(allPocUserIds)];

    if (uniqueUserIds.length === 0) {
      return [];
    }

    // 4. Fetch user details for all unique POCs
    return this.prisma.user.findMany({
      where: { id: { in: uniqueUserIds } },
    });
  }
}