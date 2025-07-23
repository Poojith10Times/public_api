import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { event_visitor } from '@prisma/client';
import { VisitorRegistrationDto } from '../dto/visitor-registration.dto';

@Injectable()
export class BadgeService {
  private readonly logger = new Logger(BadgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async assignBadgeToVisitor(
    visitor: event_visitor,
    registrationData: VisitorRegistrationDto,
  ): Promise<string | null> {
    
    // Path 1: Custom Badge ID Provided
    if (registrationData.badgeId) {
      const { isValid, message } = await this.validateCustomBadge(
        registrationData.badgeId,
        visitor.edition,
      );
      if (isValid) {
        this.logger.log(`Assigning custom badge ID: ${registrationData.badgeId} to visitor ${visitor.id}`);
        return registrationData.badgeId;
      } else {
        this.logger.warn(`Custom badge ID validation failed for visitor ${visitor.id}: ${message}`);
        // Fall through to auto-generation if custom badge is invalid
      }
    }

    // Path 2: Check Event Type (Paid vs. Free)
    const isPaid = await this.isPaidEvent(visitor.event);
    if (isPaid) {
      this.logger.log(`Event ${visitor.event} is a paid event. Fetching ticket UUID for visitor ${visitor.id}.`);
      return this.getPaidTicketBadge(visitor);
    }

    // Path 3: Free Event Auto-Generation
    this.logger.log(`Event ${visitor.event} is a free event. Starting auto-generation for visitor ${visitor.id}.`);
    return this.autoGenerateBadge(visitor);
  }

  private async isPaidEvent(eventId: number): Promise<boolean> {
    const paidTicket = await this.prisma.event_ticket.findFirst({
      where: {
        event: eventId,
        type: 'paid',
        published: true,
      },
    });
    return !!paidTicket;
  }

  private async getPaidTicketBadge(visitor: event_visitor): Promise<string | null> {
    const visitorTicket = await this.prisma.event_visitor_ticket.findFirst({
      where: {
        visitor_id: visitor.id,
        edition_id: visitor.edition,
        status: 'success',
      },
      orderBy: {
        created: 'desc',
      },
    });
    return visitorTicket?.ticket_uuid || null;
  }

  private async validateCustomBadge(badgeId: string, editionId: number): Promise<{ isValid: boolean; message?: string }> {
    if (badgeId.length > 15) {
      return { isValid: false, message: 'Badge ID exceeds 15 characters.' };
    }
    if (!/^[a-zA-Z0-9]+$/.test(badgeId)) {
      return { isValid: false, message: 'Badge ID is not alphanumeric.' };
    }

    const existingBadge = await this.prisma.event_visitor.findFirst({
      where: {
        badge: badgeId,
        edition: editionId,
      },
    });

    if (existingBadge) {
      return { isValid: false, message: 'Custom Badge ID is already in use.' };
    }

    return { isValid: true };
  }

  private async autoGenerateBadge(visitor: event_visitor): Promise<string | null> {
    const badgeSetup = await this.prisma.badge_setup.findUnique({
      where: { event_id: visitor.event },
    });

    if (!badgeSetup || !badgeSetup.t_badge_on) {
      this.logger.log(`Badging is disabled for event ${visitor.event}.`);
      return null;
    }
    
    const event = await this.prisma.event.findUnique({
        where: { id: visitor.event },
        select: { badge_initial_id: true }
    });

    const prefix = event?.badge_initial_id;

    if (prefix) {
        const lastBadge = await this.prisma.event_visitor.findFirst({
            where: {
                event: visitor.event,
                badge: { startsWith: prefix },
            },
            orderBy: { badge: 'desc' },
        });

        if (lastBadge?.badge) {
            const lastNumber = parseInt(lastBadge.badge.replace(prefix, ''), 10);
            if (!isNaN(lastNumber)) {
                return `${prefix}${lastNumber + 1}`;
            }
        }
        return `${prefix}1001`; // Start with 1001 if no previous badge is found
    }

    // Default fallback
    return `10T${visitor.id + 10000}`;
  }
}