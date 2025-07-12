import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserUpsertRequestDto } from '../dto/user-upsert-request.dto';
import { UnifiedReviewService, ReviewData } from '../../common/review.service';

export interface EventVisitorSyncData {
  id: number;
  name?: string;
  city?: number;
  country?: string;
  userCompany?: string;
  designation?: string;
  cityName?: string;
  countryName?: string;
  phone?: string;
  designationId?: number;
}

export interface SpamScoreResult {
  status: number;
  message: string;
  data?: {
    score: number;
    breakdown?: {
      last24hrs: number;
      last7days: number;
      last28days: number;
    };
  };
}

export interface SocialProfileData {
  source: 'facebook' | 'linkedin' | 'google' | 'twitter';
  metadata: string;
  userId: number;
}

export interface UserHistoryEntry {
  entryType: number; // 1 = education, 2 = work experience
  company?: string;
  designation?: string;
  description?: string;
  dateFrom?: Date;
  dateTo?: Date;
  city?: number;
  country?: string;
}

@Injectable()
export class UserCommonService {
  private readonly logger = new Logger(UserCommonService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewService: UnifiedReviewService,
  ) {}

  // async syncEventVisitorData(
  //   userData: EventVisitorSyncData, 
  //   requestData: UserUpsertRequestDto
  // ): Promise<void> {
  //   try {
  //     this.logger.log(`=== SYNC DEBUG START ===`);
  //     this.logger.log(`User ID: ${userData.id}`);
  //     this.logger.log(`User City: ${userData.city}`);
  //     this.logger.log(`User Company: ${userData.userCompany}`);
  //     this.logger.log(`User Designation: ${userData.designation}`);
  //     let city: any = null;
  //     let country: { id?: number } | null = null;

  //     if (userData.city && typeof userData.city === 'number') {
  //       city = await this.prisma.city.findUnique({
  //         where: { id: userData.city },
  //         include: {
  //           area_values: true,
  //         },
  //       });

  //       if (city) {
  //         country = city.country;
  //       }
  //     }

  //     // Find all incomplete event visitor records for this user
  //     // const eventVisitors = await this.prisma.event_visitor.findMany({
  //     //   where: {
  //     //     user: userData.id,
  //     //     completed_on: null,
  //     //   },
  //     //   include: {
  //     //     event_edition: {
  //     //       include: {
  //     //         event_event_event_editionToevent_edition: true,
  //     //       },
  //     //     },
  //     //   },
  //     // });

  //     // this.logger.log(`Found ${eventVisitors.length} incomplete event visitor records`);

  //     const eventVisitors = await this.prisma.$queryRaw`
  //       SELECT ev.*, 
  //             ee.event as event_id
  //       FROM event_visitor ev
  //       LEFT JOIN event_edition ee ON ev.edition = ee.id
  //       WHERE ev.user = ${userData.id} 
  //         AND ev.completed_on IS NULL
  //         AND (ev.created IS NULL OR ev.created != '0000-00-00 00:00:00')
  //     ` as any[];

  //     this.logger.log(`Found ${eventVisitors.length} incomplete event visitor records`);

  //     for (const visitor of eventVisitors) {
  //       let shouldFlush = false;
  //       let shouldComplete = false;
  //       let searchText = visitor.search || '';

  //       // Update city and country information
  //       if (city && !visitor.visitor_city) {
  //         await this.prisma.event_visitor.update({
  //           where: { id: visitor.id },
  //           data: {
  //             visitor_city: city.id,
  //             visitor_country: country?.id ? String(country.id) : visitor.visitor_country,
  //           },
  //         });

  //         searchText += ` ${userData.cityName} ${userData.countryName}`;
  //         shouldFlush = true;
  //       }

  //       // Update company information
  //       if (userData.userCompany && 
  //           !visitor.visitor_company && 
  //           this.isValidCompanyData(userData.userCompany)) {
          
  //         await this.prisma.event_visitor.update({
  //           where: { id: visitor.id },
  //           data: {
  //             visitor_company: userData.userCompany,
  //           },
  //         });

  //         searchText += ` ${userData.userCompany}`;
  //         shouldFlush = true;
  //       }

  //       // Update designation information
  //       if (userData.designation && 
  //           !visitor.visitor_designation && 
  //           this.isValidDesignationData(userData.designation)) {
          
  //         const updateData: any = {
  //           visitor_designation: userData.designation,
  //         };

  //         if (userData.designationId) {
  //           updateData.designation_id = userData.designationId;
  //         }

  //         await this.prisma.event_visitor.update({
  //           where: { id: visitor.id },
  //           data: updateData,
  //         });

  //         searchText += ` ${userData.designation}`;
  //         shouldFlush = true;
  //       }

  //       // Update phone information (with duplicate check)
  //       if (userData.phone && !visitor.visitor_phone) {
  //         const phoneUpdateAllowed = await this.checkPhoneUpdateAllowed(
  //           visitor.edition, 
  //           userData.phone, 
  //           userData.id
  //         );

  //         if (phoneUpdateAllowed) {
  //           await this.prisma.event_visitor.update({
  //             where: { id: visitor.id },
  //             data: {
  //               visitor_phone: userData.phone,
  //             },
  //           });

  //           shouldFlush = true;
  //         }
  //       }

  //       // Check if visitor record is now complete
  //       const updatedVisitor = await this.prisma.event_visitor.findUnique({
  //         where: { id: visitor.id },
  //       });

  //       if (updatedVisitor && this.isVisitorComplete(updatedVisitor, userData.name)) {
  //         shouldComplete = true;
  //       }

  //       // Update search text and completion status
  //       if (shouldFlush || shouldComplete) {
  //         const updateData: any = {};

  //         if (shouldFlush) {
  //           updateData.search = searchText.trim();
  //         }

  //         if (shouldComplete && !updatedVisitor?.completed_on) {
  //           updateData.completed_on = new Date();
  //         }

  //         if (Object.keys(updateData).length > 0) {
  //           await this.prisma.event_visitor.update({
  //             where: { id: visitor.id },
  //             data: updateData,
  //           });
  //         }
  //       }

  //       // Generate badge if visitor is completed and doesn't have one
  //       if (shouldComplete && 
  //           !updatedVisitor?.badge && 
  //           !this.shouldSkipBadgeGeneration(requestData)) {
  //         await this.triggerBadgeGeneration(visitor, requestData);
  //       }

  //       this.logger.debug(`Event visitor ${visitor.id} synced for user ${userData.id}`);
  //     }

  //     this.logger.log(`Synced ${eventVisitors.length} event visitor records for user ${userData.id}`);

  //   } catch (error) {
  //     this.logger.error(`Event visitor sync failed for user ${userData.id}: ${error.message}`);
  //     throw error;
  //   }
  // }

  // Replace the raw query with proper Prisma query handling invalid dates

  async syncEventVisitorData(
    userData: EventVisitorSyncData, 
    requestData: UserUpsertRequestDto
  ): Promise<void> {
    try {
      this.logger.log(`User ID: ${userData.id}`);
      this.logger.log(`User City: ${userData.city}`);
      this.logger.log(`User Company: ${userData.userCompany}`);
      this.logger.log(`User Designation: ${userData.designation}`);

      let city: any = null;
      let country: { id?: number } | null = null;

      if (userData.city && typeof userData.city === 'number') {
        city = await this.prisma.city.findUnique({
          where: { id: userData.city },
          include: {
            area_values: true,
          },
        });

        if (city) {
          country = city.country;
        }
      }

      // Handle invalid dates in event_visitor table with proper Prisma query
      let eventVisitors: any[] = [];
      
      try {
        eventVisitors = await this.prisma.event_visitor.findMany({
          where: {
            user: userData.id,
            completed_on: null,
          },
          include: {
            event_edition: {
              include: {
                event_event_event_editionToevent_edition: true,
              },
            },
          },
        });
      } catch (error) {
        this.logger.warn(`Failed to query with includes due to invalid dates, trying without includes: ${error.message}`);
        
        // Fallback: Query without includes to avoid date parsing issues
        eventVisitors = await this.prisma.event_visitor.findMany({
          where: {
            user: userData.id,
            completed_on: null,
          },
        });
      }

      this.logger.log(`Found ${eventVisitors.length} incomplete event visitor records`);

      for (const visitor of eventVisitors) {
        let shouldFlush = false;
        let shouldComplete = false;
        let searchText = visitor.search || '';

        // Update city and country information
        if (city && !visitor.visitor_city) {
          await this.prisma.event_visitor.update({
            where: { id: visitor.id },
            data: {
              visitor_city: city.id,
              visitor_country: country?.id ? String(country.id) : visitor.visitor_country,
            },
          });

          searchText += ` ${userData.cityName} ${userData.countryName}`;
          shouldFlush = true;
        }

        if (country && !visitor.visitor_country) {
          await this.prisma.event_visitor.update({
            where: { id: visitor.id },
            data: {
              visitor_country: String(country.id),
            },
          });
          shouldFlush = true;
        }

        // Update company information (only if empty)
        if (userData.userCompany && 
            !visitor.visitor_company && 
            this.isValidCompanyData(userData.userCompany)) {
          
          await this.prisma.event_visitor.update({
            where: { id: visitor.id },
            data: {
              visitor_company: userData.userCompany,
            },
          });

          searchText += ` ${userData.userCompany}`;
          shouldFlush = true;
        }

        // Update designation information (only if empty)
        if (userData.designation && 
            !visitor.visitor_designation && 
            this.isValidDesignationData(userData.designation)) {
          
          const updateData: any = {
            visitor_designation: userData.designation,
          };

          if (userData.designationId) {
            updateData.designation_id = userData.designationId;
          }

          await this.prisma.event_visitor.update({
            where: { id: visitor.id },
            data: updateData,
          });

          searchText += ` ${userData.designation}`;
          shouldFlush = true;
        }

        // Update phone information (with duplicate check)
        // if (userData.phone && !visitor.visitor_phone) {
        //   const phoneUpdateAllowed = await this.checkPhoneUpdateAllowed(
        //     visitor.edition, 
        //     userData.phone, 
        //     userData.id
        //   );

        //   this.logger.log(`Phone update allowed: ${phoneUpdateAllowed}`);

        //   if (phoneUpdateAllowed) {
        //     await this.prisma.event_visitor.update({
        //       where: { id: visitor.id },
        //       data: {
        //         visitor_phone: userData.phone,
        //       },
        //     });

        //     shouldFlush = true;
        //   }
        // }

        // Add this debug logging in the phone section:
        this.logger.log(`Phone update check:`);
        this.logger.log(`userData.phone: ${userData.phone}`);
        this.logger.log(`visitor.visitor_phone: ${visitor.visitor_phone}`);
        this.logger.log(`Condition (!visitor.visitor_phone): ${!visitor.visitor_phone}`);

        if (userData.phone && !visitor.visitor_phone) {
          this.logger.log(`Checking phone update allowed for edition: ${visitor.edition}`);
          
          const phoneUpdateAllowed = await this.checkPhoneUpdateAllowed(
            visitor.edition, 
            userData.phone, 
            userData.id
          );
          
          this.logger.log(`Phone update allowed result: ${phoneUpdateAllowed}`);

          if (phoneUpdateAllowed) {
            this.logger.log(`Updating visitor ${visitor.id} with phone: ${userData.phone}`);
            
            await this.prisma.event_visitor.update({
              where: { id: visitor.id },
              data: {
                visitor_phone: userData.phone,
              },
            });

            shouldFlush = true;
            this.logger.log(`Phone updated successfully`);
          } else {
            this.logger.log(`Phone update not allowed - duplicate check failed`);
          }
        } else {
          this.logger.log(`Phone update condition not met`);
        }

        // Check if visitor record is now complete
        const updatedVisitor = await this.prisma.event_visitor.findUnique({
          where: { id: visitor.id },
        });

        if (updatedVisitor && this.isVisitorComplete(updatedVisitor, userData.name)) {
          shouldComplete = true;
        }

        // Update search text and completion status
        if (shouldFlush || shouldComplete) {
          const updateData: any = {};

          if (shouldFlush) {
            updateData.search = searchText.trim();
          }

          if (shouldComplete && !updatedVisitor?.completed_on) {
            updateData.completed_on = new Date();
          }

          if (Object.keys(updateData).length > 0) {
            await this.prisma.event_visitor.update({
              where: { id: visitor.id },
              data: updateData,
            });
          }
        }

        // Generate badge if visitor is completed and doesn't have one
        // if (shouldComplete && 
        //     !updatedVisitor?.badge && 
        //     !this.shouldSkipBadgeGeneration(requestData)) {
        //   await this.triggerBadgeGeneration(visitor, requestData);
        // }

        this.logger.debug(`Event visitor ${visitor.id} synced for user ${userData.id}`);
      }

      this.logger.log(`Synced ${eventVisitors.length} event visitor records for user ${userData.id}`);

    } catch (error) {
      this.logger.error(`Event visitor sync failed for user ${userData.id}: ${error.message}`);
      throw error;
    }
  }

  private async checkPhoneUpdateAllowed(
    editionId: number, 
    phone: string, 
    userId: number
  ): Promise<boolean> {
    try {
      const existingPhoneCount = await this.prisma.event_visitor.count({
        where: {
          edition: editionId,
          visitor_phone: phone,
          user: { not: userId },
        },
      });

      return existingPhoneCount === 0;

    } catch (error) {
      this.logger.error(`Phone duplicate check failed: ${error.message}`);
      return false;
    }
  }

 
  private isVisitorComplete(visitor: any, userName?: string): boolean {
    return !!(
      visitor.visitor_phone &&
      visitor.visitor_city &&
      visitor.visitor_country &&
      visitor.visitor_company &&
      visitor.visitor_designation &&
      userName
    );
  }

  private isValidCompanyData(company: string): boolean {
    if (!company || company.trim().length < 2) {
      return false;
    }

    // Check for invalid patterns
    const invalidPatterns = [
      /https?:\/\//i,  // URLs
      /www\./i,        // Website patterns
      /\.(com|in|co\.in|org|net)/i,  // Domain extensions
      /\d{7,}/,        // Long number sequences
      /@/,             // Email patterns
    ];

    return !invalidPatterns.some(pattern => pattern.test(company));
  }

  private isValidDesignationData(designation: string): boolean {
    if (!designation || designation.trim().length < 2) {
      return false;
    }

    // Check for invalid patterns 
    const invalidPatterns = [
      /https?:\/\//i,
      /www\./i,
      /\.(com|in|co\.in|org|net)/i,
      /\d{7,}/,
      /@/,
    ];

    return !invalidPatterns.some(pattern => pattern.test(designation));
  }

  // private shouldSkipBadgeGeneration(requestData: UserUpsertRequestDto): boolean {
  //   // Skip badge generation for certain event contexts
  //   return !!(
  //     requestData.eventId && 
  //     ['attend', 'follow', 'interest', 'going', 'bookmark', 'connect', 'signup'].includes(requestData.action ?? '')
  //   );
  // }

  // private async triggerBadgeGeneration(visitor: any, requestData: UserUpsertRequestDto): Promise<void> {
  //   try {
  //     // This would typically trigger an async badge generation process
  //     // For now, we'll just log the requirement
  //     this.logger.log(`Badge generation triggered for visitor ${visitor.id}, event ${visitor.event}`);

  //     // In a real implementation, this might:
  //     // 1. Create an async task
  //     // 2. Call a badge generation service
  //     // 3. Queue a background job
      
  //     // Example async task creation (commented out as it needs async task table):
  //     /*
  //     await this.prisma.async_process.create({
  //       data: {
  //         url: '/user/createBadge',
  //         http_method: 'POST',
  //         http_payload: `event_id=${visitor.event}&visitor_id=${visitor.id}&for=1&source=edit profile&curl=true`,
  //         http_header: JSON.stringify(['Content-Type: application/x-www-form-urlencoded']),
  //         priority: 1,
  //         published: 1,
  //         created: new Date(),
  //       },
  //     });
  //     */

  //   } catch (error) {
  //     this.logger.error(`Badge generation trigger failed: ${error.message}`);
  //     // Don't throw - badge generation is not critical
  //   }
  // }

  async getIncompleteVisitorCount(userId: number): Promise<number> {
    try {
      return await this.prisma.event_visitor.count({
        where: {
          user: userId,
          completed_on: null,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to get incomplete visitor count: ${error.message}`);
      return 0;
    }
  }

  async getCompletedVisitorCount(userId: number): Promise<number> {
    try {
      return await this.prisma.event_visitor.count({
        where: {
          user: userId,
          completed_on: { not: null },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to get completed visitor count: ${error.message}`);
      return 0;
    }
  }

  // profile score 

  async updateProfileScore(userId: number): Promise<{
    profileScore: number;
    speakerScore: number;
    profileCompleted: boolean;
  }> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          company_user_companyTocompany: true,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      let profileScore = 0;
      let speakerScore = 0;

      // Basic profile fields (5 points each)
      if (user.name && user.name.trim() !== '') {
        profileScore += 5;
      }

      if (user.city) {
        profileScore += 5;
        speakerScore += 3;
      }

      if (user.country) {
        speakerScore += 8;
      }

      if (user.user_company && user.user_company.trim() !== '') {
        profileScore += 5;
        speakerScore += 6;
      }

      if (user.designation && user.designation.trim() !== '') {
        profileScore += 5;
        speakerScore += 6;
      }

      // Contact information (5 points)
      if (user.phone || user.email) {
        profileScore += 5;
      }

      // About section (10 points for profile, 5 for speaker)
      if (user.about && user.about.trim() !== '') {
        profileScore += 10;
        speakerScore += 5;
      }

      // Profile picture (5 points for profile, 12 for speaker)
      if (user.profile_picture && user.profile_picture.trim() !== '') {
        profileScore += 5;
        speakerScore += 12;
      }

      // Social media presence (5 points for having any, up to 10 for speaker)
      const hasSocial = !!(user.facebook_id || user.linkedin_id || user.twitter_id);
      if (hasSocial) {
        profileScore += 5;
      }

      // Speaker social media score (up to 10 points)
      let speakerSocialScore = 0;
      if (user.facebook_id) speakerSocialScore += 10;
      if (user.linkedin_id) speakerSocialScore += 10;
      if (user.twitter_id) speakerSocialScore += 10;
      if (user.wikipedia) speakerSocialScore += 10;
      if (user.website) speakerSocialScore += 10;

      speakerScore += Math.min(speakerSocialScore, 10);

      // Email verification (5 points)
      if (user.email_verified) {
        profileScore += 5;
      }

      // Phone verification (5 points)
      if (user.phone_verified) {
        profileScore += 5;
      }

      // Event participation (10 points if >= 5 events)
      const eventCount = await this.prisma.event_visitor.count({
        where: { user: userId },
      });

      if (eventCount >= 5) {
        profileScore += 10;
      }

      // Connection count (10 points if >= 5 connections)
      const connectionCount = await this.prisma.connect.count({
        where: {
          OR: [
            { sender: userId },
            { receiver: userId },
          ],
          status: 1,
        },
        take: 5,
      });

      if (connectionCount >= 5) {
        profileScore += 10;
      }

      // User interests (5 points for industry/product/search interests)
      const hasInterests = await this.prisma.user_interests.findFirst({
        where: {
          user: userId,
          interest: {
            in: ['industry', 'product', 'search'],
          },
          confirmed: true,
        },
      });

      if (hasInterests) {
        profileScore += 5;
      }

      // Opportunity interests (5 points for speaker/exhibitor/visitor/sponsor)
      const hasOpportunityInterests = await this.prisma.user_interests.findFirst({
        where: {
          user: userId,
          interest: 'opportunity',
          value: {
            in: ['speaker', 'exhibitor', 'visitor', 'sponsor'],
          },
          confirmed: true,
        },
      });

      if (hasOpportunityInterests) {
        profileScore += 5;
      }

      // Speaker-specific scoring
      // Speaking engagements (2 points per agenda, max 10)
      const agendaCount = await this.prisma.event_agenda_speaker.count({
        where: { speaker: userId },
      });

      const agendaScore = Math.min(agendaCount * 2, 10);
      speakerScore += agendaScore;

      // Event speaking (4 points per event, max 20)
      const speakingEventCount = await this.prisma.event_speaker.count({
        where: { user_id: userId },
      });

      const speakingEventScore = Math.min(speakingEventCount * 4, 20);
      speakerScore += speakingEventScore;

      // Follower count (1 point per follower, max 10)
      const followerCount = await this.prisma.follow_user.count({
        where: { user_id: userId },
        take: 10,
      });

      speakerScore += Math.min(followerCount, 10);

      // Company bonus (15 points if company has name and website)
      if (user.company_user_companyTocompany) {
        const company = user.company_user_companyTocompany;
        if (company.name && company.website) {
          profileScore += 15;
        }
      }

      // Check if profile is complete
      const isComplete = !!(
        user.name &&
        (user.email || user.phone) &&
        user.city &&
        user.country &&
        user.user_company &&
        user.designation
      );

      // Update user with calculated scores
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          profile_score_completed: profileScore,
          speaker_profile_score: speakerScore,
          profile_completed: isComplete && !user.profile_completed ? new Date() : user.profile_completed,
          url: user.url || (user.name ? await this.generateUserUrl(userId, user.name, user.email ?? undefined) : user.url),
          modified: new Date(),
        },
      });

      this.logger.log(`Profile score updated for user ${userId}: ${profileScore} (speaker: ${speakerScore})`);

      return {
        profileScore,
        speakerScore,
        profileCompleted: isComplete,
      };

    } catch (error) {
      this.logger.error(`Profile score calculation failed for user ${userId}: ${error.message}`);
      throw error;
    }
  }

  private async generateUserUrl(userId: number, name: string, email?: string): Promise<string> {
    try {
      // Create base slug from name or email
      let baseSlug = '';
      
      if (name && name.trim() !== '') {
        baseSlug = name
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-+|-+$/g, '');
      } else if (email) {
        const emailPart = email.split('@')[0];
        baseSlug = emailPart
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-+|-+$/g, '');
      }

      if (!baseSlug) {
        baseSlug = `user-${userId}`;
      }

      // Check if URL already exists
      let finalUrl = baseSlug;
      let counter = 1;

      while (true) {
        const existingUser = await this.prisma.user.findFirst({
          where: {
            url: finalUrl,
            id: { not: userId },
          },
        });

        if (!existingUser) {
          break;
        }

        finalUrl = `${baseSlug}-${counter}`;
        counter++;

        // Prevent infinite loop
        if (counter > 1000) {
          finalUrl = `${baseSlug}-${userId}`;
          break;
        }
      }

      return finalUrl;

    } catch (error) {
      this.logger.error(`URL generation failed: ${error.message}`);
      return `user-${userId}`;
    }
  }

  async getProfileCompletionPercentage(userId: number): Promise<number> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return 0;
      }

      const fields = [
        user.name,
        user.email,
        user.phone,
        user.city,
        user.country,
        user.user_company,
        user.designation,
        user.about,
        user.profile_picture,
        user.website,
      ];

      const completedFields = fields.filter(field => field && field.toString().trim() !== '').length;
      const totalFields = fields.length;

      return Math.round((completedFields / totalFields) * 100);

    } catch (error) {
      this.logger.error(`Profile completion calculation failed: ${error.message}`);
      return 0;
    }
  }

  async saveSocialProfile(data: SocialProfileData): Promise<void> {
    try {
      const { userId, source, metadata } = data;

      // Save or update social profile
      const existingSocialProfile = await this.prisma.social_profile.findFirst({
        where: { user_id: userId },
      });

      if (existingSocialProfile) {
        // Update existing profile
        const updateData: any = {};
        
        switch (source) {
          case 'facebook':
            updateData.facebook_profile = metadata;
            break;
          case 'linkedin':
            updateData.linkedin_profile = metadata;
            break;
          case 'google':
            updateData.google_profile = metadata;
            break;
        }

        await this.prisma.social_profile.update({
          where: { id: existingSocialProfile.id },
          data: updateData,
        });
      } else {
        // Create new profile
        const createData: any = {
          user_id: userId,
        };

        switch (source) {
          case 'facebook':
            createData.facebook_profile = metadata;
            break;
          case 'linkedin':
            createData.linkedin_profile = metadata;
            break;
          case 'google':
            createData.google_profile = metadata;
            break;
        }

        await this.prisma.social_profile.create({
          data: createData,
        });
      }

      await this.saveUserHistory(userId, source, metadata);

      this.logger.log(`Social profile saved for user ${userId}, source: ${source}`);

    } catch (error) {
      this.logger.error(`Save social profile failed: ${error.message}`);
      throw error;
    }
  }

  private async saveUserHistory(userId: number, source: string, profileData: string): Promise<void> {
    try {
      // Delete existing history for this source
      await this.prisma.user_history.deleteMany({
        where: {
          user_id: userId,
          created_source: source,
        },
      });

      // Parse profile data
      let profile: any;
      try {
        profile = JSON.parse(profileData);
      } catch {
        this.logger.warn(`Invalid JSON in profile data for user ${userId}, source: ${source}`);
        return;
      }

      if (!Array.isArray(profile) && typeof profile !== 'object') {
        return;
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return;
      }

      switch (source) {
        case 'facebook':
          await this.processFacebookProfile(userId, profile, user);
          break;
        case 'linkedin':
          await this.processLinkedInProfile(userId, profile, user);
          break;
        case 'google':
          await this.processGoogleProfile(userId, profile, user);
          break;
      }

    } catch (error) {
      this.logger.error(`Save user history failed: ${error.message}`);
      throw error;
    }
  }

  private async processFacebookProfile(userId: number, profile: any, user: any): Promise<void> {
    const updateData: any = {};

    // Date of birth
    if (profile.birthday) {
      const dob = new Date(profile.birthday);
      if (!isNaN(dob.getTime()) && dob.getFullYear() > 1900) {
        updateData.date_of_birth = dob;
      }
    }

    // Gender
    if (profile.gender) {
      updateData.gender = profile.gender.toLowerCase() === 'male' ? 'M' : 'F';
    }

    // Location
    if (profile.location?.name) {
      await this.processLocationData(profile.location.name, user, updateData);
    }

    // Update user if we have changes
    if (Object.keys(updateData).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: updateData,
      });
    }

    // Process education
    if (profile.education) {
      const educationArray = Array.isArray(profile.education) ? profile.education : [profile.education];
      
      for (const edu of educationArray) {
        await this.createUserHistoryEntry(userId, {
          entryType: 1, // Education
          company: edu.school?.name,
          description: edu.type,
          dateTo: edu.year?.name ? new Date(`${edu.year.name}-01-01`) : undefined,
        });
      }
    }

    // Process work experience
    if (profile.work) {
      const workArray = Array.isArray(profile.work) ? profile.work : [profile.work];
      
      for (const work of workArray) {
        const entry: UserHistoryEntry = {
          entryType: 2, // Work
          company: work.employer?.name,
          designation: work.position?.name,
          description: work.description,
        };

        // Parse dates
        if (work.start_date) {
          entry.dateFrom = this.parseWorkDate(work.start_date);
        }
        if (work.end_date) {
          entry.dateTo = this.parseWorkDate(work.end_date);
        }

        // Location
        if (work.location?.name) {
          const locationData = await this.parseLocationString(work.location.name);
          entry.city = locationData.cityId;
          entry.country = locationData.countryCode;
        }

        await this.createUserHistoryEntry(userId, entry);
      }
    }
  }

  private async processLinkedInProfile(userId: number, profile: any, user: any): Promise<void> {
    const updateData: any = {};

    // Date of birth
    if (profile.dateOfBirth) {
      const { day = 1, month = 1, year = 1900 } = profile.dateOfBirth;
      if (year > 1900) {
        updateData.date_of_birth = new Date(year, month - 1, day);
      }
    }

    // Gender
    if (profile.gender) {
      updateData.gender = profile.gender.toLowerCase() === 'male' ? 'M' : 'F';
    }

    // Location
    if (profile.location?.name) {
      await this.processLocationData(profile.location.name, user, updateData);
    }

    // Update user if we have changes
    if (Object.keys(updateData).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: updateData,
      });
    }

    // Process education
    if (profile.educations?.values) {
      for (const edu of profile.educations.values) {
        const entry: UserHistoryEntry = {
          entryType: 1, // Education
          company: edu.schoolName,
          description: edu.degree,
        };

        if (edu.startDate?.year) {
          entry.dateFrom = new Date(edu.startDate.year, 0, 1);
        }
        if (edu.endDate?.year) {
          entry.dateTo = new Date(edu.endDate.year, 0, 1);
        }

        await this.createUserHistoryEntry(userId, entry);
      }
    }

    // Process positions
    if (profile.positions?.values) {
      for (const position of profile.positions.values) {
        const entry: UserHistoryEntry = {
          entryType: 2, // Work
          company: position.company?.name,
          designation: position.title,
          description: position.summary,
        };

        // Parse dates
        if (position.startDate?.year && position.startDate?.month) {
          entry.dateFrom = new Date(position.startDate.year, position.startDate.month - 1, 1);
        }
        if (position.endDate?.year && position.endDate?.month) {
          entry.dateTo = new Date(position.endDate.year, position.endDate.month - 1, 1);
        }

        await this.createUserHistoryEntry(userId, entry);
      }
    }
  }

  private async processGoogleProfile(userId: number, profile: any, user: any): Promise<void> {
    const updateData: any = {};

    // Gender
    if (profile.result?.gender) {
      updateData.gender = profile.result.gender.toLowerCase() === 'male' ? 'M' : 'F';
    }

    // Update user if we have changes
    if (Object.keys(updateData).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: updateData,
      });
    }

    // Process organizations
    if (profile.result?.organizations) {
      for (const org of profile.result.organizations) {
        const entry: UserHistoryEntry = {
          entryType: 2, // Work
          company: org.name,
          designation: org.title,
        };

        if (org.startDate && org.startDate !== '0000') {
          entry.dateFrom = new Date(org.startDate, 0, 1);
        }
        if (org.endDate && org.endDate !== '0000') {
          entry.dateTo = new Date(org.endDate, 0, 1);
        }

        await this.createUserHistoryEntry(userId, entry);
      }
    }
  }

  private async createUserHistoryEntry(userId: number, entry: UserHistoryEntry): Promise<void> {
    try {
      await this.prisma.user_history.create({
        data: {
          user_id: userId,
          created_source: 'social_import',
          entry_type: entry.entryType,
          company: entry.company,
          designation: entry.designation,
          description: entry.description,
          date_from: entry.dateFrom,
          date_to: entry.dateTo,
          city: entry.city,
          country: entry.country,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create user history entry: ${error.message}`);
    }
  }

  private async processLocationData(locationName: string, user: any, updateData: any): Promise<void> {
    if (user.country) {
      return; // Don't override existing location
    }

    const locationData = await this.parseLocationString(locationName);
    
    if (locationData.cityId) {
      updateData.city = locationData.cityId;
    }
    if (locationData.countryCode) {
      updateData.country = locationData.countryCode;
    }
  }

  private async parseLocationString(location: string): Promise<{
    cityId?: number;
    countryCode?: string;
  }> {
    try {
      const parts = location.split(',').map(part => part.trim());
      
      if (parts.length < 2) {
        return {};
      }

      const cityName = parts[0];
      const countryName = parts[parts.length - 1];

      // Try to find country first
      const country = await this.prisma.country.findFirst({
        where: {
          OR: [
            { name: { contains: countryName} },
            // { iso: countryName.toUpperCase() },
          ],
        },
      });

      if (!country) {
        return {};
      }

      // Try to find city
      const city = await this.prisma.city.findFirst({
        where: {
          name: { contains: cityName },
          country: country.id,
        },
      });

      return {
        cityId: city?.id,
        countryCode: country.id,
      };

    } catch (error) {
      this.logger.error(`Location parsing failed: ${error.message}`);
      return {};
    }
  }

  private parseWorkDate(dateStr: string): Date | undefined {
    try {
      // Handle YYYY-MM format
      if (/^\d{4}-\d{2}$/.test(dateStr) && dateStr !== '0000-00') {
        return new Date(`${dateStr}-01`);
      }

      // Handle full date
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr) && dateStr !== '0000-00-00') {
        return new Date(dateStr);
      }

      return undefined;
    } catch {
      return undefined;
    }
  }


  async getUserSocialProfiles(userId: number): Promise<any> {
    try {
      return await this.prisma.social_profile.findFirst({
        where: { user_id: userId },
      });
    } catch (error) {
      this.logger.error(`Get social profiles failed: ${error.message}`);
      return null;
    }
  }

  
  async getUserWorkHistory(userId: number): Promise<any[]> {
    try {
      return await this.prisma.user_history.findMany({
        where: {
          user_id: userId,
          entry_type: 2, // Work experience
        },
        orderBy: {
          date_from: 'desc',
        },
      });
    } catch (error) {
      this.logger.error(`Get work history failed: ${error.message}`);
      return [];
    }
  }

  async getUserEducationHistory(userId: number): Promise<any[]> {
    try {
      return await this.prisma.user_history.findMany({
        where: {
          user_id: userId,
          entry_type: 1, // Education
        },
        orderBy: {
          date_from: 'desc',
        },
      });
    } catch (error) {
      this.logger.error(`Get education history failed: ${error.message}`);
      return [];
    }
  }

  async calculateAndSaveSpamScore(userId: number): Promise<SpamScoreResult> {
    try {
      // First calculate the spam score
      const scoreResult = await this.getSpamScore(userId);
      
      if (scoreResult.status === 0) {
        return scoreResult;
      }

      // Save the calculated score to the user
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          spam_score: scoreResult.data?.score,
          last_flagged: new Date(),
          modified: new Date(),
        },
      });

      this.logger.log(`Spam score updated for user ${userId}: ${scoreResult.data?.score}`);

      return {
        ...scoreResult,
        message: 'Spam score calculated and saved successfully',
      };

    } catch (error) {
      this.logger.error(`Calculate and save spam score failed for user ${userId}: ${error.message}`);
      return {
        status: 0,
        message: 'Failed to calculate and save spam score',
      };
    }
  }

  async getSpamScore(userId: number): Promise<SpamScoreResult> {
    try {
      if (!userId) {
        return {
          status: 0,
          message: 'User id cannot be empty',
        };
      }

      // Check if user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          spam_score: true,
          ip_address: true,
          euser: true,
        },
      });

      if (!user) {
        return {
          status: 0,
          message: 'User does not exist',
        };
      }

      // If spam score already exceeds 250, return early
      if (user.spam_score && user.spam_score >= 250) {
        return {
          status: 1,
          message: 'Already crossed 250 spam score',
          data: { score: user.spam_score },
        };
      }

      // Calculate date ranges
      const date28DaysAgo = new Date();
      date28DaysAgo.setDate(date28DaysAgo.getDate() - 28);
      
      const date7DaysAgo = new Date();
      date7DaysAgo.setDate(date7DaysAgo.getDate() - 7);
      
      const date1DayAgo = new Date();
      date1DayAgo.setDate(date1DayAgo.getDate() - 1);

      const currentDate = new Date();

      // Calculate spam scores for different time periods
      const last24hrs = await this.calculateThreadSpamScore(userId, date1DayAgo, currentDate);
      const last7days = await this.calculateThreadSpamScore(userId, date7DaysAgo, currentDate);
      const last28days = await this.calculateThreadSpamScore(userId, date28DaysAgo, currentDate);

      // Add spam request scores
      const last24hrsReqSpam = await this.calculateReqSpamScore(userId, date1DayAgo, currentDate);
      const last7daysReqSpam = await this.calculateReqSpamScore(userId, date7DaysAgo, currentDate);
      const last28daysReqSpam = await this.calculateReqSpamScore(userId, date28DaysAgo, currentDate);

      // Add refused request scores (only for 24hrs and 7days)
      const last24hrsReqRefused = await this.calculateReqRefusedScore(userId, date1DayAgo, currentDate);
      const last7daysReqRefused = await this.calculateReqRefusedScore(userId, date7DaysAgo, currentDate);

      // Add IP-based scores (if not whitelisted)
      const whitelistedIPs = [
        '52.207.76.247', '35.170.231.39', '35.174.131.209', '3.232.173.5',
        '54.89.113.14', '18.204.190.22', '35.172.252.78', '52.20.186.222',
        '107.20.55.138', '52.54.140.248'
      ];

      let last24hrsIP = 0;
      let last7daysIP = 0;
      let last28daysIP = 0;

      if (user.ip_address && !whitelistedIPs.includes(user.ip_address)) {
        last24hrsIP = await this.calculateIPSpamScore(user.ip_address, userId, date1DayAgo, currentDate);
        last7daysIP = await this.calculateIPSpamScore(user.ip_address, userId, date7DaysAgo, currentDate);
        last28daysIP = await this.calculateIPSpamScore(user.ip_address, userId, date28DaysAgo, currentDate);
      }

      // Combine all scores
      let final24hrs = last24hrs + last24hrsReqSpam + last24hrsReqRefused + last24hrsIP;
      let final7days = last7days + last7daysReqSpam + last7daysReqRefused + last7daysIP;
      let final28days = last28days + last28daysReqSpam + last28daysIP;

      // Apply caps
      if (final24hrs >= 1000) final24hrs = 1000;
      if (final7days >= 500) final7days = 500;
      if (final28days >= 500) final28days = 500;

      // Calculate final weighted score
      const finalScore = (0.5 * final24hrs) + (0.3 * final7days) + (0.2 * final28days);

      return {
        status: 1,
        message: 'Spam score calculated successfully',
        data: {
          score: Math.round(finalScore),
          breakdown: {
            last24hrs: final24hrs,
            last7days: final7days,
            last28days: final28days,
          },
        },
      };

    } catch (error) {
      this.logger.error(`Get spam score failed for user ${userId}: ${error.message}`);
      return {
        status: 0,
        message: 'Failed to calculate spam score',
      };
    }
  }

  private async calculateThreadSpamScore(
    userId: number,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    try {
      // Get spam flagged threads grouped by date and spam flag
      const spamThreads = await this.prisma.$queryRaw<Array<{
        tcreated: string;
        spamFlag: number;
        cnt: number;
      }>>`
        SELECT DATE_FORMAT(created, '%Y-%m-%d') as tcreated, spam_flag as spamFlag, COUNT(id) as cnt
        FROM thread
        WHERE sender = ${userId}
        AND created >= ${startDate}
        AND created <= ${endDate}
        AND spam_flag IN (1, 2, 3, 4)
        GROUP BY tcreated, spam_flag
      `;

      let totalScore = 0;
      let flag1Score = 0;
      let flag2Score = 0;
      let flag3Score = 0;
      let flag4Score = 0;

      for (const thread of spamThreads) {
        const count = Number(thread.cnt);
        
        switch (thread.spamFlag) {
          case 1:
            const score1 = Math.min(flag1Score + (count * 5), 50);
            totalScore += (score1 - flag1Score);
            flag1Score = score1;
            break;
          case 2:
            const score2 = Math.min(flag2Score + (count * 15), 105);
            totalScore += (score2 - flag2Score);
            flag2Score = score2;
            break;
          case 3:
            const score3 = Math.min(flag3Score + (count * 10), 150);
            totalScore += (score3 - flag3Score);
            flag3Score = score3;
            break;
          case 4:
            const score4 = Math.min(flag4Score + (count * 50), 200);
            totalScore += (score4 - flag4Score);
            flag4Score = score4;
            break;
        }
      }

      return totalScore;

    } catch (error) {
      this.logger.error(`Calculate thread spam score failed: ${error.message}`);
      return 0;
    }
  }

  private async calculateReqSpamScore(
    userId: number,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    try {
      const reqSpamThreads = await this.prisma.$queryRaw<Array<{
        tcreated: string;
        cnt: number;
      }>>`
        SELECT DATE_FORMAT(created, '%Y-%m-%d') as tcreated, COUNT(sender) as cnt
        FROM thread
        WHERE receiver = ${userId}
        AND created >= ${startDate}
        AND created <= ${endDate}
        AND message = '#Req-spam'
        GROUP BY tcreated
      `;

      let totalScore = 0;
      let currentScore = 0;

      for (const thread of reqSpamThreads) {
        const count = Number(thread.cnt);
        const score = Math.min(currentScore + (count * 60), 250);
        totalScore += (score - currentScore);
        currentScore = score;
      }

      return totalScore;

    } catch (error) {
      this.logger.error(`Calculate req spam score failed: ${error.message}`);
      return 0;
    }
  }

  private async calculateReqRefusedScore(
    userId: number,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    try {
      const reqRefusedThreads = await this.prisma.$queryRaw<Array<{
        tcreated: string;
        cnt: number;
      }>>`
        SELECT DATE_FORMAT(created, '%Y-%m-%d') as tcreated, COUNT(sender) as cnt
        FROM thread
        WHERE receiver = ${userId}
        AND created >= ${startDate}
        AND created <= ${endDate}
        AND message = '#Req-refused'
        GROUP BY tcreated
      `;

      let totalScore = 0;
      let currentScore = 0;

      for (const thread of reqRefusedThreads) {
        const count = Number(thread.cnt);
        const score = Math.min(currentScore + (count * 10), 100);
        totalScore += (score - currentScore);
        currentScore = score;
      }

      return totalScore;

    } catch (error) {
      this.logger.error(`Calculate req refused score failed: ${error.message}`);
      return 0;
    }
  }

  private async calculateIPSpamScore(
    ipAddress: string,
    excludeUserId: number,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    try {
      const ipUsers = await this.prisma.$queryRaw<Array<{
        tcreated: string;
        cnt: number;
      }>>`
        SELECT DATE_FORMAT(created, '%Y-%m-%d') as tcreated, COUNT(id) as cnt
        FROM user
        WHERE ip_address = ${ipAddress}
        AND created >= ${startDate}
        AND created <= ${endDate}
        AND euser = 0
        AND id != ${excludeUserId}
        GROUP BY tcreated
      `;

      let totalScore = 0;
      let currentScore = 0;

      for (const user of ipUsers) {
        const count = Number(user.cnt);
        const score = Math.min(currentScore + (count * 50), 200);
        totalScore += (score - currentScore);
        currentScore = score;
      }

      return totalScore;

    } catch (error) {
      this.logger.error(`Calculate IP spam score failed: ${error.message}`);
      return 0;
    }
  }

  async createUserCreationReview(
    userData: UserUpsertRequestDto,
    createdUser: any,
    prismaClient?: any
  ): Promise<void> {
    try {
      const incomingData = this.prepareIncomingUserData(userData, createdUser);
      
      // Create pre-review with incoming data
      const preReviewData: ReviewData = {
        entityType: 'user',
        entityId: createdUser.id,
        entityName: createdUser.name || createdUser.email || `User ${createdUser.id}`,
        reviewType: 'C', // Create
        modifyType: 'E', // Edit
        byUser: userData.changesMadeBy,
        addedBy: userData.changesMadeBy,
        qcBy: userData.changesMadeBy,
        status: 'A', // Always approved since bypassing QC
        systemVerified: true, // Bypassing QC
        content: incomingData,
        remark: `User created via ${userData.source || 'direct'}`,
        cityId: createdUser.city,
        countryId: createdUser.country,
        companyId: createdUser.company,
      };

      const preReviewId = await this.reviewService.createPreReview(preReviewData, prismaClient);
      
      // Create post-review with same data and link to pre-review
      const postReviewData = {
        ...preReviewData,
        postStatus: 'A' as const, // Approved
      };

      await this.reviewService.createPostReview({
        ...postReviewData,
        preReviewId: preReviewId
      }, prismaClient);
      
      this.logger.log(`Created reviews for user creation: ${createdUser.id}`);
    } catch (error) {
      this.logger.error(`Failed to create user creation review: ${error.message}`);
      // Don't throw - review creation should not fail the main operation
    }
  }

  /**
   * Create review for user update - stores existing data in pre-review, updated data in post-review
   */
  async createUserUpdateReview(
    userData: UserUpsertRequestDto,
    oldUser: any,
    updatedUser: any,
    prismaClient?: any
  ): Promise<void> {
    try {
      const changes = this.detectChanges(oldUser, updatedUser);
      
      if (changes.hasChanges) {
        // Create pre-review with existing (old) data
        const preReviewData: ReviewData = {
          entityType: 'user',
          entityId: updatedUser.id,
          entityName: updatedUser.name || updatedUser.email || `User ${updatedUser.id}`,
          reviewType: 'M', // Modify
          modifyType: 'E', // Edit
          byUser: userData.changesMadeBy,
          addedBy: userData.changesMadeBy,
          qcBy: userData.changesMadeBy,
          status: 'A', // Always approved since bypassing QC
          systemVerified: true, // Bypassing QC
          content: this.sanitizeUserData(oldUser), // Store existing data
          remark: `User updated: ${changes.changes.length} fields changed`,
          cityId: updatedUser.city,
          countryId: updatedUser.country,
          companyId: updatedUser.company,
        };

        const preReviewId = await this.reviewService.createPreReview(preReviewData, prismaClient);
        
        // Create post-review with updated data and link to pre-review
        const postReviewData = {
          ...preReviewData,
          content: this.sanitizeUserData(updatedUser), // Store updated data
          postStatus: 'A' as const, // Approved
          remark: `User updated: ${changes.changesList}`,
        };

        await this.reviewService.createPostReview({
          ...postReviewData,
          preReviewId: preReviewId
        }, prismaClient);
        
        this.logger.log(`Created reviews for user update: ${updatedUser.id}`);
      }
    } catch (error) {
      this.logger.error(`Failed to create user update review: ${error.message}`);
      // Don't throw - review creation should not fail the main operation
    }
  }

  /**
   * Create review for user reactivation
   */
  async createUserReactivationReview(
    userData: UserUpsertRequestDto,
    reactivatedUser: any,
    prismaClient?: any
  ): Promise<void> {
    try {
      const reactivationData = {
        operation: 'user_reactivation',
        deactivateId: userData.deactivateId,
        userData: this.sanitizeUserData(reactivatedUser),
        timestamp: new Date().toISOString(),
      };

      // Create pre-review with reactivation data
      const preReviewData: ReviewData = {
        entityType: 'user',
        entityId: reactivatedUser.id,
        entityName: reactivatedUser.name || reactivatedUser.email || `User ${reactivatedUser.id}`,
        reviewType: 'M', // Modify
        modifyType: 'R', // Reactivation
        byUser: userData.changesMadeBy,
        addedBy: userData.changesMadeBy,
        qcBy: userData.changesMadeBy,
        status: 'A', // Always approved since bypassing QC
        systemVerified: true, // Bypassing QC
        content: reactivationData,
        remark: `User reactivated from deactivate_id: ${userData.deactivateId}`,
        cityId: reactivatedUser.city,
        countryId: reactivatedUser.country,
        companyId: reactivatedUser.company,
      };

      const preReviewId = await this.reviewService.createPreReview(preReviewData, prismaClient);
      
      // Create post-review with same data and link to pre-review
      const postReviewData = {
        ...preReviewData,
        postStatus: 'A' as const, // Approved
      };

      await this.reviewService.createPostReview({
        ...postReviewData,
        preReviewId: preReviewId
      }, prismaClient);
      
      this.logger.log(`Created reviews for user reactivation: ${reactivatedUser.id}`);
    } catch (error) {
      this.logger.error(`Failed to create user reactivation review: ${error.message}`);
    }
  }

  private prepareIncomingUserData(userData: UserUpsertRequestDto, createdUser: any): any {
    return {
      operation: 'user_creation',
      source: userData.source || 'direct',
      platform: userData.platform,
      incomingData: {
        name: userData.name,
        email: userData.email,
        phone: userData.phone,
        company: userData.company,
        designation: userData.designation,
        about: userData.about,
        website: userData.website,
        cityCode: userData.city,
        countryCode: userData.country,
        place_id: userData.placeId,
        facebookId: userData.facebookId,
        linkedinId: userData.linkedinId,
        googleId: userData.googleId,
        twitterId: userData.twitterId,
        profilePicture: userData.profilePicture,
      },
      createdUserData: this.sanitizeUserData(createdUser),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Detect changes between old and new user data
   */
  private detectChanges(oldUser: any, newUser: any): {
    hasChanges: boolean;
    changes: string[];
    changesList: string;
  } {
    const changes: string[] = [];
    const fieldsToCheck = [
      'name', 'email', 'phone', 'user_company', 'designation', 
      'city', 'country', 'about', 'website', 'published',
      'facebook_id', 'linkedin_id', 'google_id', 'twitter_id',
      'profile_picture', 'company', 'designation_id'
    ];

    for (const field of fieldsToCheck) {
      if (oldUser[field] !== newUser[field]) {
        changes.push(`${field}: "${oldUser[field]}" → "${newUser[field]}"`);
      }
    }

    return {
      hasChanges: changes.length > 0,
      changes,
      changesList: changes.join('; '),
    };
  }

  /**
   * Sanitize user data for review storage (remove sensitive fields)
   */
  private sanitizeUserData(user: any): any {
    const sensitiveFields = ['password', 'ip_address'];
    const sanitized = { ...user };
    
    for (const field of sensitiveFields) {
      delete sanitized[field];
    }

    // Convert dates to strings for JSON storage
    if (sanitized.created) sanitized.created = sanitized.created.toISOString();
    if (sanitized.modified) sanitized.modified = sanitized.modified.toISOString();
    if (sanitized.email_verified) sanitized.email_verified = sanitized.email_verified.toISOString();
    if (sanitized.phone_verified) sanitized.phone_verified = sanitized.phone_verified.toISOString();
    if (sanitized.profile_verified) sanitized.profile_verified = sanitized.profile_verified.toISOString();
    if (sanitized.profile_completed) sanitized.profile_completed = sanitized.profile_completed.toISOString();

    return sanitized;
  }

  private sanitizeForLatin1(data: any): any {
    if (typeof data === 'string') {
      // Convert UTF-8 to latin1 compatible characters
      return data
        .replace(/[^\x00-\xFF]/g, '?') // Replace non-latin1 chars with ?
        .substring(0, 65535); // Ensure it's not too long
    }
    
    if (typeof data === 'object' && data !== null) {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(data)) {
        sanitized[key] = this.sanitizeForLatin1(value);
      }
      return sanitized;
    }
    
    return data;
  }
}