import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../common/email.service';
import { event_visitor, user } from '@prisma/client';

interface VisitorRegistrationPayload {
  visitorId: number;
  type: 'visitor-confirmation' | 'organizer-notification';
}

@Controller()
export class VisitorConsumer {
  private readonly logger = new Logger(VisitorConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @MessagePattern('email-notifications')
  async handleVisitorRegistration(
    @Payload() payload: VisitorRegistrationPayload,
  ) {
    this.logger.log(`Received message on email-notifications topic:`, payload);

    const visitor = await this.prisma.event_visitor.findUnique({
      where: { id: payload.visitorId },
    });
    
    if (!visitor || !visitor.user) {
      this.logger.warn(`Visitor or User ID not found for visitorId: ${payload.visitorId}`);
      return;
    }

    const user = await this.prisma.user.findUnique({
        where: { id: visitor.user },
    });

    if (!user) {
        this.logger.warn(`User object not found for userId: ${visitor.user}`);
        return;
    }

    if (payload.type === 'visitor-confirmation') {
      await this.sendVisitorConfirmation(visitor, user);
    } else if (payload.type === 'organizer-notification') {
      await this.sendOrganizerNotification(visitor, user);
    }
  }

  private async sendVisitorConfirmation(visitor: event_visitor, user: user): Promise<void> {
    if (!user.email) return;

    const subject = `Registration Confirmed for Event ID: ${visitor.event}`;
    const message = `
      Hello ${user.name || 'User'},

      This email confirms your registration for Event ID: ${visitor.event}.
      Your Visitor ID is: ${visitor.id}.

      Thank you!
    `;

    await this.emailService.sendMail({
      to: user.email,
      from: 'noreply@10times.com',
      subject,
      message,
    });
    this.logger.log(`Confirmation email sent to visitor: ${user.email}`);
  }

  private async sendOrganizerNotification(visitor: event_visitor, registeredUser: user): Promise<void> {
    const pocs = await this.getEventPocs(visitor.event);
    const pocEmails = pocs.map(poc => poc.email).filter((email): email is string => !!email);
    
    if (pocEmails.length > 0) {
      const subject = `New Visitor Registration for Event ID: ${visitor.event}`;
      const message = `A new visitor has registered for your event.\n\nEvent ID: ${visitor.event}\nVisitor ID: ${visitor.id}\nUser Name: ${registeredUser.name}\nUser Email: ${registeredUser.email}`;
      
      await this.emailService.sendMail({ to: pocEmails, from: 'noreply@10times.com', subject, message });
      this.logger.log(`Organizer notification sent to: ${pocEmails.join(', ')}`);
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
        event_edition_event_event_editionToevent_edition: { select: { company_id: true } }
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
    if (uniqueUserIds.length === 0) return [];
    
    // 4. Fetch user details for all unique POCs
    return this.prisma.user.findMany({ where: { id: { in: uniqueUserIds } } });
  }
}