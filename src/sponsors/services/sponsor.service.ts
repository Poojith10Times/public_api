import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SponsorUpsertRequestDto } from '../dto/sponsor-upsert-request.dto';
import { SponsorUpsertResponseDto } from '../dto/sponsor-upsert-response.dto';
import { S3Service } from '../../common/s3.service';
import { UnifiedReviewService, ReviewData } from '../../common/review.service';
import { RabbitmqService } from '../../common/rabbitmq.service';

@Injectable()
export class SponsorService {
  private readonly logger = new Logger(SponsorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly reviewService: UnifiedReviewService,
    private readonly rabbitmqService: RabbitmqService,
  ) {}

  async upsertSponsor(
    payload: SponsorUpsertRequestDto,
    userId: number,
  ): Promise<SponsorUpsertResponseDto> {
    this.logger.log(`Upserting sponsor for event ${payload.eventId} by user ${userId}`);

    const isAuthorized = await this.isUserAuthorized(userId, payload.eventId);
    if (!isAuthorized) {
      return { status: { code: 0, message: 'Not authorized to change the event details' } };
    }

    if (payload.published === -1) {
      if (!payload.sponsorId) {
        return { status: { code: 0, message: 'sponsorId is required for deletion' } };
      }
      return this.deleteSponsor(payload.sponsorId, payload.eventId, userId);
    }
    
    return this.createOrUpdateSponsor(payload, userId);
  }

  private async createOrUpdateSponsor(
    payload: SponsorUpsertRequestDto,
    userId: number,
  ): Promise<SponsorUpsertResponseDto> {
    try {
        const { eventId, editionId, companyId, name, website, position } = payload;

        const event = await this.prisma.event.findUnique({ where: { id: eventId } });
        if (!event) {
            return { status: { code: 0, message: 'Event not found' } };
        }

        const finalEditionId = editionId || event.event_edition;
        if (!finalEditionId) {
            return { status: { code: 0, message: 'Could not determine event edition' } };
        }
        
        if (editionId) {
            const edition = await this.prisma.event_edition.findFirst({ where: { id: editionId, event: eventId }});
            if (!edition) {
                return { status: { code: 0, message: 'Edition does not belong to the specified event.'}};
            }
        }

        let company;
        if (companyId) {
            company = await this.prisma.company.findUnique({ where: { id: companyId } });
            if (!company) {
                return { status: { code: 0, message: 'Invalid companyId' } };
            }
        } else if (name) {
            this.logger.log(`Company creation placeholder called for: ${name}`);
        } else {
            return { status: { code: 0, message: 'companyId or name is required' } };
        }

        const sponsorName = name || company?.name;
        if (!sponsorName) {
            return { status: { code: 0, message: 'Sponsor name is required' } };
        }

        const oldData = payload.sponsorId ? await this.prisma.event_sponsors.findUnique({ where: { id: payload.sponsorId } }) : null;

        if (company?.id) {
            const existingSponsor = await this.prisma.event_sponsors.findFirst({
                where: { event_id: eventId, event_edition: finalEditionId, company_id: company.id },
            });
            if (payload.sponsorId) {
                if (existingSponsor && existingSponsor.id !== payload.sponsorId) {
                    return { status: { code: 0, message: 'Sponsor with this company already exists' } };
                }
            } else if (existingSponsor) {
                if (existingSponsor.published === -1) {
                    payload.sponsorId = existingSponsor.id;
                } else {
                    return { status: { code: 0, message: 'Duplicate sponsor not allowed' } };
                }
            }
        }

        const sponsorDataResult = await this.prepareSponsorData(payload, sponsorName, company?.id, userId);
        if (sponsorDataResult.error) {
            return { status: { code: 0, message: sponsorDataResult.error } };
        }

        const sponsor = await this.prisma.$transaction(async (tx) => {
            let finalPosition = position;
            
            if (oldData) { // This is an UPDATE
              if (finalPosition !== undefined && oldData.position !== finalPosition) {
                // Position is provided and it's different, so we shift
                await tx.event_sponsors.updateMany({
                  where: { event_id: eventId, event_edition: finalEditionId, position: { gte: finalPosition } },
                  data: { position: { increment: 1 } },
                });
              } else if (finalPosition === undefined) {
                // Position not provided, so keep the old one
                finalPosition = oldData.position ?? await this.calculateNextPosition(eventId, finalEditionId);
              }
            } else { // This is a CREATE
              if (finalPosition !== undefined) {
                // Position is provided for a new sponsor, so we shift
                await tx.event_sponsors.updateMany({
                    where: { event_id: eventId, event_edition: finalEditionId, position: { gte: finalPosition } },
                    data: { position: { increment: 1 } },
                });
              } else {
                // Position not provided for a new sponsor, so we calculate the next one
                finalPosition = await this.calculateNextPosition(eventId, finalEditionId);
              }
            }

            const dataToUpsert = { ...sponsorDataResult.data, position: finalPosition, event_edition: finalEditionId };

            return tx.event_sponsors.upsert({
                where: { id: payload.sponsorId || 0 },
                update: { ...dataToUpsert, modifiedby: userId, modified: new Date() },
                create: { ...dataToUpsert, event_id: eventId, createdby: userId, created: new Date() },
            });
        });

        await this.createReviewLog('sponsor_upsert', sponsor, payload, userId, oldData);
        this.rabbitmqService.sendStrengthMessage({ event: eventId, edition: finalEditionId });

        return { status: { code: 1, message: 'Sponsor processed successfully' }, data: { sponsorId: sponsor.id } };
    } catch (error) {
        this.logger.error('Error in createOrUpdateSponsor:', error);
        return { status: { code: 0, message: 'An error occurred while processing the sponsor' } };
    }
  }

  private async deleteSponsor(
    sponsorId: number,
    eventId: number,
    userId: number,
  ): Promise<SponsorUpsertResponseDto> {
    const sponsor = await this.prisma.event_sponsors.update({
      where: { id: sponsorId },
      data: { published: -1, modifiedby: userId, modified: new Date() },
    });

    await this.createReviewLog('sponsor_deleted', sponsor, { eventId, sponsorId }, userId);
    this.rabbitmqService.sendStrengthMessage({ event: eventId, edition: sponsor.event_edition! });
    return { status: { code: 1, message: 'Sponsor deleted successfully' }, data: { sponsorId } };
  }

  private async prepareSponsorData(payload: SponsorUpsertRequestDto, name: string, companyId: number | undefined, userId: number): Promise<{data?: any, error?: string}> {
    const { title, published, verified, logo } = payload;
    let logoId = typeof logo === 'number' ? logo : undefined;

    if (typeof logo === 'string' && logo.startsWith('data:image')) {
        if (!companyId) {
            return { error: 'companyId is required to upload a logo' };
        }
        const uploadResult = await this.uploadSponsorLogoToS3(logo, companyId, userId);
        if (uploadResult.error || !uploadResult.attachmentId) {
            return { error: `Error saving image: ${uploadResult.error}` };
        }
        logoId = uploadResult.attachmentId;
    } else if (typeof logo === 'number') {
        const attachmentExists = await this.prisma.attachment.findUnique({ where: { id: logo }});
        if (!attachmentExists) {
            return { error: 'Invalid logo attachment ID' };
        }
        logoId = logo;
    }
    
    const data: any = {
        name,
        title,
        published: published ?? 1,
        logo: logoId,
        company_id: companyId,
    };

    if (verified) {
        data.verified = 1;
        data.verified_on = new Date();
        data.verified_by = userId;
    }

    return { data };
  }

  private async uploadSponsorLogoToS3(
    base64Image: string,
    companyId: number,
    userId: number,
  ): Promise<{ attachmentId: number | null; error?: string }> {
    const fileExtensionMatch = base64Image.match(/^data:image\/([a-zA-Z]+);base64,/);
    const fileExtension = fileExtensionMatch ? fileExtensionMatch[1] : 'png';
    const fileName = `${Date.now()}.${fileExtension}`;
    const s3Key = `company/${companyId}/${fileName}`;

    const { cdnUrl, error } = await this.s3Service.uploadBase64Image(base64Image, s3Key);

    if (error || !cdnUrl) {
      return { attachmentId: null, error: `S3 upload failed: ${error}` };
    }

    const attachment = await this.prisma.attachment.create({
      data: {
        file_type: 'image',
        value: s3Key,
        cdn_url: cdnUrl,
        published: true,
        createdby: userId,
      },
    });

    this.logger.log(`Created attachment record ${attachment.id} for company ${companyId}`);
    return { attachmentId: attachment.id };
  }
  
  private async isUserAuthorized(userId: number, eventId: number): Promise<boolean> {
    const contact = await this.prisma.contact.findFirst({
        where: { user_reference: userId, entity_id: eventId, entity_type: 1, published: 1 },
    });
    return !!contact;
  }

  private async calculateNextPosition(eventId: number, editionId: number): Promise<number> {
    const result = await this.prisma.event_sponsors.aggregate({
        _max: { position: true },
        where: { event_id: eventId, event_edition: editionId },
    });
    return (result._max.position || 0) + 1;
  }
  
  private async createReviewLog(action: string, sponsor: any, payload: any, userId: number, oldData: any = null) {
    const preData: any = {};
    if (action === 'sponsor_deleted') {
        preData.sponsorId = sponsor.id;
    } else { 
        if (oldData) {
            preData.sponsorId = oldData.id;
            preData.title = oldData.title;
            preData.company_id = oldData.company_id;
            preData.logo = oldData.logo;
        } else {
            preData.title = sponsor.title;
            preData.company_id = sponsor.company_id;
            preData.logo = sponsor.logo;
        }
    }

    const preReviewData: ReviewData = {
        entityType: 'event',
        entityId: payload.eventId,
        title: action === 'sponsor_deleted' ? 'sponsor deleted' : 'sponsor',
        byUser: userId,
        reviewType: 'M',
        modifyType: 'E',
        remark: 'auto saved by organizer',
        status: 'A',
        content: JSON.stringify(preData),
    };

    const preReviewId = await this.reviewService.createPreReview(preReviewData);

    const postData: any = {
        sponsorId: sponsor.id,
        event_edition: sponsor.event_edition,
        title: sponsor.title,
        company_id: sponsor.company_id,
        logo: sponsor.logo
    };
    
    await this.reviewService.createPostReview({
        ...preReviewData,
        content: JSON.stringify(postData),
        preReviewId,
    });
  }
}