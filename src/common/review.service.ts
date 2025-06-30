import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ReviewData {
  // Entity information
  entityType: 'event' | 'company' | 'venue' | 'publicApi' | 'user';
  entityId: number;
  entityName?: string;
  
  // Review metadata
  reviewType?: 'M' | 'C' | 'U'; // M=Modify, C=Create, U=Update
  modifyType?: 'E' | 'Q' | 'R'; // E=Edit, Q=QC, R=Rehost
  title?: string;
  content?: string | object | null; 
  remark?: string;
  
  // User information
  byUser: number;
  addedBy?: number;
  qcBy?: number;
  
  // Timestamps
  addedOn?: Date;
  qcOn?: Date;
  
  // Status and workflow
  status?: 'P' | 'A' | 'R' | 'T'; // P=Pending, A=Approved, R=Rejected, T=Trash
  postStatus?: 'A' | 'R' | 'P';
  systemVerified?: boolean;
  
  startDate?: Date;
  endDate?: Date;
  website?: string;
  functionality?: string;
  eventAudience?: string;
  onlineEvent?: number;
  
  cityId?: number;
  countryId?: string;
  companyId?: number;
  venueId?: number;

  oldData?: any;
  newData?: any;
  apiPayload?: any;
}

export interface ReviewWorkflowResult {
  preReviewId?: number;
  postReviewId?: number;
}


@Injectable()
export class UnifiedReviewService {
  private readonly logger = new Logger(UnifiedReviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createPreReview(data: ReviewData, prismaClient?: any): Promise<number> {
    const db = prismaClient || this.prisma;
    
    try {
      const commonFields = await this.buildCommonFields(data, db);
      
      const title = this.prepareTitle(data);
      
      let content: string | null = null;
      if (data.content !== undefined && data.content !== null) {
        content = typeof data.content === 'object' 
          ? JSON.stringify(data.content) 
          : data.content;
      }

      const preReview = await db.pre_review.create({
        data: {
          entity_type: data.entityType,
          entity_id: data.entityId,
          title,
          content,
          remark: data.remark || null,
          review_type: data.reviewType || 'M',
          modify_type: data.modifyType || 'E',
          by_user: data.byUser,
          added_by: data.addedBy || data.byUser,
          qc_by: data.qcBy || data.byUser,
          added_on: data.addedOn || new Date(),
          qc_on: data.status === 'A' ? (data.qcOn || new Date()) : null,
          status: data.status || 'P',
          system_verified: data.systemVerified || false,
          website: data.website || null,
          entity_name: data.entityName || null,
          functionality: data.functionality || null,
          start_date: data.startDate || null,
          end_date: data.endDate || null,
          online_event: data.onlineEvent || null,
          event_audience: data.eventAudience || null,
          ...commonFields,
        },
      });

      this.logger.log(`Created pre-review ${preReview.id} for ${data.entityType} ${data.entityId}`);
      return preReview.id;
      
    } catch (error) {
      this.logger.error(`Failed to create pre-review for ${data.entityType} ${data.entityId}:`, error);
      throw error;
    }
  }

  async createPostReview(
    data: ReviewData & { 
      preReviewId?: number;
      oldData?: any; 
      newData?: any;
      apiPayload?: any; 
    }, 
    prismaClient?: any
  ): Promise<number> {
    const db = prismaClient || this.prisma;
    
    try {
      const commonFields = await this.buildCommonFields(data, db);
      
      const title = this.prepareTitle(data);
      
      let contentApproved: string | null = null;
      if (data.content !== undefined && data.content !== null) {
        // For updates with old/new data, structure the content
        if (data.oldData && data.newData) {
          const structuredContent = {
            oldData: data.oldData,
            newData: data.newData,
            apiPayload: data.apiPayload || null,
            timestamp: new Date().toISOString()
          };
          contentApproved = JSON.stringify(structuredContent);
        } else {
          // For creates, just use the content as-is
          contentApproved = typeof data.content === 'object' 
            ? JSON.stringify(data.content) 
            : data.content;
        }
      }

      const postReview = await db.post_review.create({
        data: {
          entity_type: data.entityType,
          entity_id: data.entityId,
          title,
          content_approved: contentApproved,
          remark: data.remark || null,
          review_type: data.reviewType || 'M',
          modify_type: data.modifyType || 'E',
          by_user: data.byUser,
          added_by: data.addedBy || data.byUser,
          qc_by: data.qcBy || data.byUser,
          added_on: data.addedOn || new Date(),
          qc_on: new Date(),
          post_status: data.postStatus || 'A',
          system_verified: data.systemVerified || false,
          website: data.website || null,
          entity_name: data.entityName || null,
          functionality: data.functionality || null,
          start_date: data.startDate || null,
          end_date: data.endDate || null,
          online_event: data.onlineEvent || null,
          event_audience: data.eventAudience || null,
          review_id: data.preReviewId || null,
          ...commonFields,
        },
      });

      this.logger.log(`Created post-review ${postReview.id} for ${data.entityType} ${data.entityId}`);
      return postReview.id;
      
    } catch (error) {
      this.logger.error(`Failed to create post-review for ${data.entityType} ${data.entityId}:`, error);
      throw error;
    }
  }

  async createReviewWorkflow(data: ReviewData, prismaClient?: any): Promise<ReviewWorkflowResult> {
    const db = prismaClient || this.prisma;
    
    try {
      const preReviewId = await this.createPreReview(data, db);
      
      let postReviewId: number | undefined = undefined;
      
      // Create post-review if auto-approved or QC is bypassed
      postReviewId = await this.createPostReview({
        ...data,
        preReviewId,
        postStatus: 'A',
      }, db);
      

      return { preReviewId, postReviewId };
      
    } catch (error) {
      this.logger.error(`Failed to create review workflow for ${data.entityType} ${data.entityId}:`, error);
      return { preReviewId: undefined, postReviewId: undefined };
    }
  }


  private async buildCommonFields(data: ReviewData, prismaClient: any) {
    const commonFields: any = {
      city: null,
      country: null,
      company_id: null,
      venue_id: null,
    };

    try {
      if (data.entityType === 'event' && data.entityId) {
        const event = await prismaClient.event.findUnique({
          where: { id: data.entityId },
          select: {
            city: true,
            country: true,
            event_edition_event_event_editionToevent_edition: {
              select: {
                company_id: true,
                venue: true,
              },
            },
          },
        });

        if (event) {
          commonFields.city = event.city;
          commonFields.country = event.country;
          if (event.event_edition_event_event_editionToevent_edition) {
            commonFields.company_id = event.event_edition_event_event_editionToevent_edition.company_id;
            commonFields.venue_id = event.event_edition_event_event_editionToevent_edition.venue;
          }
        }
      } else if (data.entityType === 'venue' && data.entityId) {
        const venue = await prismaClient.venue.findUnique({
          where: { id: data.entityId },
          select: { city: true, country: true },
        });

        if (venue) {
          commonFields.city = venue.city;
          commonFields.country = venue.country;
          commonFields.venue_id = data.entityId;
        }
      } else if (data.entityType === 'company' && data.entityId) {
        const company = await prismaClient.company.findUnique({
          where: { id: data.entityId },
          select: { city: true, country: true },
        });

        if (company) {
          commonFields.city = company.city;
          commonFields.country = company.country;
          commonFields.company_id = data.entityId;
        }
      }

      // Override with provided values
      if (data.cityId !== undefined) commonFields.city = data.cityId;
      if (data.countryId !== undefined) commonFields.country = data.countryId;
      if (data.companyId !== undefined) commonFields.company_id = data.companyId;
      if (data.venueId !== undefined) commonFields.venue_id = data.venueId;

    } catch (error) {
      this.logger.warn(`Failed to build common fields for ${data.entityType} ${data.entityId}:`, error);
    }

    return commonFields;
  }

  private prepareTitle(data: ReviewData): string {
    if (data.title) {
      return data.title;
    }

    const titleObj: any = {
      entity_type: data.entityType,
      entity_id: data.entityId,
      entity_name: data.entityName || `${data.entityType} ${data.entityId}`,
    };

    if (data.startDate && data.endDate) {
      titleObj.date = `${data.startDate.toLocaleDateString()} - ${data.endDate.toLocaleDateString()}`;
    }

    return JSON.stringify(titleObj);
  }

}