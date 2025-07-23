// import { Injectable, Logger } from '@nestjs/common';
// import { PrismaService } from '../prisma/prisma.service';

// interface PipedriveContactData {
//   userId: number;
//   companyId: number;
// }

// interface PipedriveRelationship {
//   id: number;
//   company: number;
//   user: number;
//   prospect_score?: number | null;
//   pd_deal_id?: number | null;
//   pd_deal_status?: string | null;
//   pd_deal_last_activity?: Date | null;
//   created: Date;
//   modified?: Date | null;
//   published: number;
//   odash_last_login?: Date | null;
//   activityCount?: string | null;
// }

// @Injectable()
// export class PipedriveService {
//   private readonly logger = new Logger(PipedriveService.name);

//   constructor(private readonly prisma: PrismaService) {}

//   async insertContact(contactData: PipedriveContactData[]): Promise<{
//     success: boolean;
//     message?: string;
//     processedCount: number;
//   }> {
//     try {
//       let processedCount = 0;

//       for (const data of contactData) {
//         // Check if relationship already exists using the unique constraint
//         const existingPipedrive = await this.prisma.pipedrive.findFirst({
//           where: {
//             company: data.companyId,
//             user: data.userId,
//           },
//         });

//         if (!existingPipedrive) {
//           // Verify company exists and is published
//           const company = await this.prisma.company.findFirst({
//             where: { 
//               id: data.companyId,
//               published: true 
//             },
//           });

//           if (!company) {
//             this.logger.warn(`Company with ID ${data.companyId} not found or not published, skipping Pipedrive entry`);
//             continue;
//           }

//           // Verify user exists
//           const user = await this.prisma.user.findFirst({
//             where: { 
//               id: data.userId,
//               published: true
//             },
//           });

//           if (!user) {
//             this.logger.warn(`User with ID ${data.userId} not found or not published, skipping Pipedrive entry`);
//             continue;
//           }

//           // Create new Pipedrive relationship
//           await this.prisma.pipedrive.create({
//             data: {
//               company: data.companyId,
//               user: data.userId,
//               created: new Date(),
//               published: 1,
//               prospect_score: null,
//               pd_deal_id: null,
//               pd_deal_status: null,
//               pd_deal_last_activity: null,
//               modified: null,
//               odash_last_login: null,
//               activityCount: null,
//             },
//           });

//           processedCount++;
//           this.logger.debug(`Created Pipedrive relationship: User ${data.userId} <-> Company ${data.companyId}`);
          
//           this.logger.debug(`Company: ${company.name}, User: ${user.email || user.name || `ID-${user.id}`}`);
//         } else {
//           this.logger.debug(`Pipedrive relationship already exists: User ${data.userId} <-> Company ${data.companyId}`);
//         }
//       }

//       return {
//         success: true,
//         processedCount,
//         message: `Processed ${processedCount} Pipedrive relationships`,
//       };

//     } catch (error) {
//       this.logger.error('Failed to process Pipedrive contacts:', error);
//       return {
//         success: false,
//         processedCount: 0,
//         message: `Failed to process Pipedrive contacts: ${error.message}`,
//       };
//     }
//   }

//   async getPipedriveRelationship(userId: number, companyId: number): Promise<PipedriveRelationship | null> {
//     try {
//       const pipedrive = await this.prisma.pipedrive.findFirst({
//         where: {
//           company: companyId,
//           user: userId,
//         },
//         include: {
//           company_relation: {
//             select: {
//               id: true,
//               name: true,
//               website: true,
//               published: true,
//             }
//           },
//           user_relation: {
//             select: {
//               id: true,
//               email: true,
//               name: true,
//               published: true,
//             }
//           }
//         },
//       });

//       return pipedrive;
//     } catch (error) {
//       this.logger.error('Failed to get Pipedrive relationship:', error);
//       return null;
//     }
//   }

// }