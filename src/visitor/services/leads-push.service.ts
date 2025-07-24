import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { event_visitor, user } from '@prisma/client';

@Injectable()
export class LeadsPushService {
  private readonly logger = new Logger(LeadsPushService.name);

  constructor(private readonly prisma: PrismaService) {}

  async pushLead(visitor: event_visitor): Promise<void> {
    try {
      // 1. Check if lead pushing is configured for this event
      const leadPushConfig = await this.prisma.leads_push.findFirst({
        where: { event: visitor.event, published: 1 },
      });

      if (!leadPushConfig) {
        this.logger.log(`Lead pushing not configured for event ${visitor.event}. Skipping.`);
        return;
      }

      // 2. Gather all required data
      const user = await this.prisma.user.findUnique({ where: { id: visitor.user! } });
      if (!user) {
        this.logger.warn(`User not found for visitor ${visitor.id}. Cannot push lead.`);
        return;
      }

      // 3. Construct the payload based on field mappings
      const payload = this.buildPayload(visitor, user, leadPushConfig);
      const dataString = JSON.stringify(payload);

      // 4. Create a record in the async_process table
      await this.prisma.async_process.create({
        data: {
          url: leadPushConfig.url,
          http_method: 'POST',
          http_header: JSON.stringify({
            'Content-Type': 'application/json',
            'Content-Length': dataString.length,
          }),
          http_payload: dataString,
          priority: 10,
          published: 1,
          reference_id: visitor.id,
          source: 'lead_push',
          created: new Date(),
        },
      });

      this.logger.log(`Successfully queued lead push for visitor ${visitor.id} to ${leadPushConfig.url}`);

    } catch (error) {
      this.logger.error(`Failed to push lead for visitor ${visitor.id}`, error);
    }
  }

  private buildPayload(visitor: event_visitor, user: user, config: any): Record<string, any> {
    const sourceData = {
        name: user.name,
        email: user.email,
        phone: visitor.visitor_phone,
        city: visitor.visitor_city,
        country: visitor.visitor_country,
        designation: visitor.visitor_designation,
        company: visitor.visitor_company,
        leadType: visitor.interest === 1010 ? 1 : (visitor.interest === 1000 ? 2 : 0),
        event: visitor.event,
        badgeId: visitor.badge,
        created: visitor.created,
    };
    
    const payload: Record<string, any> = {};
    const fieldMappings = JSON.parse(config.fixed_fields || '{}');
    
    for (const key in fieldMappings) {
        if (sourceData[key] !== undefined) {
            payload[fieldMappings[key]] = sourceData[key];
        }
    }
    
    // Add custom fields
    const customFields = JSON.parse(config.custom_fields || '{}')?.data || [];
    for (const field of customFields) {
        payload[field.key] = field.value;
    }

    return payload;
  }
}