import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserUpsertRequestDto } from '../dto/user-upsert-request.dto';
import { PhoneValidationService } from './phone-validation.service';
import { UserValidationService } from './user-validation.service';

export interface ProcessingOptions {
  isFullUpdate?: boolean;
  sourceFlags: {
    noPublishedFlag: boolean;
    autoPhoneVerify: boolean;
  };
  locationData?: any;
  companyData?: any;
  designationData?: any;
}

@Injectable()
export class UserProcessingService {
  private readonly logger = new Logger(UserProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly phoneValidationService: PhoneValidationService,
    private readonly userValidationService: UserValidationService
  ) {}


  async updateUser(
    existingUser: any,
    userData: UserUpsertRequestDto,
    options: ProcessingOptions,
    tx?: any
  ): Promise<any> {
    const db = tx || this.prisma;
    
    try {
      const userId = existingUser.id;
      const isFullUpdate = options.isFullUpdate || false;
      let userPersistFlag = false;
      let profileModified = false;
      let visitorES = false;
    //   let callChnl = false;

      const updateData: any = {
        modified: new Date(),
        modifiedby: userData.changesMadeBy,
      };

      this.processBasicFields(userData, existingUser, updateData, isFullUpdate);
      this.processLocationFields(userData, existingUser, updateData, options.locationData, isFullUpdate);
      this.processCompanyFields(userData, existingUser, updateData, options.companyData, isFullUpdate);
      this.processDesignationFields(userData, existingUser, updateData, options.designationData, isFullUpdate);
      this.processSocialFields(userData, existingUser, updateData, isFullUpdate);
      this.processVerificationFields(userData, existingUser, updateData, isFullUpdate);
      this.processProfileFields(userData, existingUser, updateData, isFullUpdate);

      const finalUser = { ...existingUser, ...updateData };
  
      const isProfileComplete = !!(
        finalUser.name &&
        (finalUser.email || finalUser.phone) &&
        finalUser.city &&
        finalUser.country &&
        finalUser.user_company &&
        finalUser.designation
      );

      if (isProfileComplete && !existingUser.profile_completed) {
        updateData.profile_completed = new Date();
        userPersistFlag = true;
      }

      // Handle deactivation/reactivation
      if (userData.deactivate) {
        if (userData.deactivate === 'true') {
          updateData.published = false;
          visitorES = true;
          // Delete user connections for deactivated users
          // await this.deleteUserConnections(userId, db);
        } else if (userData.deactivate === 'false' && !options.sourceFlags.noPublishedFlag) {
          updateData.published = true;
          visitorES = true;
        }
        userPersistFlag = true;
      }

      // Handle verification updates
      if (!existingUser || existingUser.verified !== true) {
        updateData.verified = true;
        if ((existingUser?.email || userData.email) && userData.action !== 'redeemCredits') {
          updateData.email_verified = new Date();
        }
        userPersistFlag = true;
      }

      // Handle geographic data
      if (userData.geoLat && userData.geoLong) {
        updateData.geo_long = parseFloat(userData.geoLong.toString());
        updateData.geo_lat = parseFloat(userData.geoLat.toString());
        userPersistFlag = true;
      }

      // Handle published status
      if (existingUser.published === -1 && !options.sourceFlags.noPublishedFlag) {
        updateData.published = true;
        visitorES = true;
        userPersistFlag = true;
      }

      // Handle eUser flag
      if (existingUser.e_user === true && userData.platform === 'mp') {
        updateData.euser = false;
        userPersistFlag = true;
      }

      // Profile verification
      if (userData.name) {
        updateData.profile_verified = new Date();
        userPersistFlag = true;
      }

      // Update user if changes detected
      if (userPersistFlag || Object.keys(updateData).length > 2) {
        if (profileModified) {
          updateData.profile_modified = new Date();
        }

        const updatedUser = await db.user.update({
          where: { id: userId },
          data: updateData,
          include: {
            city_user_cityTocity: true,
            country_user_countryTocountry: true,
            company_user_companyTocompany: true,
          },
        });

        this.logger.log(`User ${userId} updated successfully`);
        return updatedUser;
      } else {
        return await db.user.findUnique({
          where: { id: userId },
          include: {
            city_user_cityTocity: true,
            country_user_countryTocountry: true,
            company_user_companyTocompany: true,
          },
        });
      }

    } catch (error) {
      this.logger.error(`Update user processing failed: ${error.message}`);
      throw error;
    }
  }

  async createUser(
    userData: UserUpsertRequestDto,
    options: ProcessingOptions,
    tx?: any
  ): Promise<any> {
    const db = tx || this.prisma;

    try {
      const createData: any = {
        created: new Date(),
        verified: false,
        total_event_attend: 0,
        total_event_speak: 0,
        crawl_status: 0,
        profile_page: 0,
        show_profile: true,
        autointroduce: true,
        unsubscribe: 1,
        createdby: userData.changesMadeBy,
        language: userData.lang || 'en',
      };

      this.processBasicFields(userData, null, createData, true);
      this.processLocationFields(userData, null, createData, options.locationData, true);
      this.processCompanyFields(userData, null, createData, options.companyData, true);
      this.processDesignationFields(userData, null, createData, options.designationData, true);
      this.processSocialFields(userData, null, createData, true);
      this.processVerificationFields(userData, null, createData, true);
      this.processProfileFields(userData, null, createData, true);

      const isProfileComplete = !!(
        createData.name &&
        (createData.email || createData.phone) &&
        (createData.city || options.locationData?.cityId) &&
        (createData.country || options.locationData?.countryId) &&
        createData.user_company &&
        createData.designation
      );

      if (isProfileComplete) {
        createData.profile_completed = new Date();
      }

      if (this.shouldSetEUser(userData)) {
        createData.euser = true;
      } else {
        createData.euser = false;
      }

      if (options.sourceFlags.noPublishedFlag) {
        createData.published = false; // Unpublished
      } else {
        createData.published = true; // Published
      }

      // Handle geographic data
      if (userData.geoLat && userData.geoLong) {
        createData.geo_long = parseFloat(userData.geoLong.toString());
        createData.geo_lat = parseFloat(userData.geoLat.toString());
      }

      // Override with explicit published status
      if (userData.published !== undefined) {
        const publishedValue = parseInt(userData.published.toString());
        createData.published = publishedValue === 1; // Convert to boolean
      }

      const newUser = await db.user.create({
        data: createData,
        include: {
          city_user_cityTocity: true,
          country_user_countryTocountry: true,
          company_user_companyTocompany: true,
        },
      });

      this.logger.log(`New user created: ${newUser.id}`);
      return newUser;

    } catch (error) {
      this.logger.error(`Create user processing failed: ${error.message}`);
      throw error;
    }
  }

  private processBasicFields(
    userData: UserUpsertRequestDto,
    existingUser: any | null, // null for create, user object for update
    updateData: any,
    isFullUpdate: boolean
    ): void {
    const isCreateMode = existingUser === null;

    // Name processing
    if (userData.name && userData.name.trim() !== '') {
        if (isCreateMode) {
        // Create mode: Always set if provided
        updateData.name = userData.name;
        } else if (isFullUpdate) {
        // Full update: Update if different
        if (existingUser.name !== userData.name) {
            updateData.name = userData.name;
        }
        } else {
        // Partial update: Only if existing name is empty
        if (!existingUser.name) {
            updateData.name = userData.name;
        }
        }
    }

    // Company processing
    if (userData.company && userData.company.trim() !== '' && userData.company.length > 1) {
        if (isCreateMode) {
        // Create mode: Always set if provided
        updateData.user_company = userData.company;
        } else if (isFullUpdate) {
        // Full update: Update if different
        if (existingUser.user_company !== userData.company) {
            updateData.user_company = userData.company;
        }
        } else {
        // Partial update: Only if existing company is empty/null
        if (!existingUser.user_company || 
            existingUser.user_company.trim() === '' || 
            existingUser.user_company === 'NULL') {
            updateData.user_company = userData.company;
        }
        }
    }

    // Designation processing
    if (userData.designation && userData.designation.trim() !== '' && userData.designation.length > 1) {
        if (isCreateMode) {
        // Create mode: Always set if provided
        updateData.designation = userData.designation;
        } else if (isFullUpdate) {
        // Full update: Update if different
        if (existingUser.designation !== userData.designation) {
            updateData.designation = userData.designation;
        }
        } else {
        // Partial update: Only if existing designation is empty/null
        if (!existingUser.designation || 
            existingUser.designation.trim() === '' || 
            existingUser.designation === 'NULL') {
            updateData.designation = userData.designation;
        }
        }
    }

    // Email processing
    if (userData.newVerifiedEmail && userData.newVerifiedEmail !== '') {
        updateData.email = userData.newVerifiedEmail;
        updateData.email_verified = new Date();
    } else if (userData.mapEmail) {
        if (isCreateMode || isFullUpdate || !existingUser?.email || existingUser.email === '') {
        updateData.email = userData.mapEmail;
        }
    } else if (userData.email) {
        if (isCreateMode) {
        // Create mode: Always set if provided
        updateData.email = userData.email;
        } else if (isFullUpdate) {
        // Full update: Can update existing email
        if (existingUser.email !== userData.email) {
            updateData.email = userData.email;
        }
        } else {
        // Partial update: Only if no existing email
        if (!existingUser.email) {
            updateData.email = userData.email;
        }
        }
    }

    if (userData.phone && userData.phone.trim() !== '' && userData.phone.length > 6) {
      if (isCreateMode) {
        // For create mode, set phone immediately
        updateData.phone = userData.phone;
      } else if (isFullUpdate) {
        if (existingUser.phone !== userData.phone) {
          updateData.phone = userData.phone;
        }
      } else {
        // Partial update: only if no existing phone or phone is too short
        if (!existingUser.phone || existingUser.phone.length <= 6) {
          updateData.phone = userData.phone;
        }
      }
    }

    // About processing
    if (userData.about && userData.about.trim() !== '') {
        if (isCreateMode) {
        // Create mode: Always set if provided
        updateData.about = userData.about;
        } else if (isFullUpdate) {
        // Full update: Update if different
        if (existingUser.about !== userData.about) {
            updateData.about = userData.about;
        }
        } else {
        // Partial update: Only if existing about is empty/null
        if (!existingUser.about || 
            existingUser.about.trim() === '' || 
            existingUser.about === 'NULL') {
            updateData.about = userData.about;
        }
        }
    }

    // Website processing
    if (userData.website && userData.website.trim() !== '') {
        if (isCreateMode) {
        // Create mode: Always set if provided
        updateData.website = userData.website;
        } else if (isFullUpdate) {
        // Full update: Update if different
        if (existingUser.website !== userData.website) {
            updateData.website = userData.website;
        }
        } else {
        // Partial update: Only if existing website is empty/null
        if (!existingUser.website || 
            existingUser.website.trim() === '' || 
            existingUser.website === 'NULL') {
            updateData.website = userData.website;
        }
        }
    }

    // Password
    if (userData.newPassword && userData.newPassword.trim() !== '') {
        updateData.password = userData.newPassword;
    }

    // Business type
    if (userData.bizType) {
        updateData.biz_type = userData.bizType;
    }
  }

 
  private processLocationFields(
    userData: UserUpsertRequestDto,
    existingUser: any | null,
    updateData: any,
    locationData: any,
    isFullUpdate: boolean
  ): void {
    const isCreateMode = existingUser === null;

    // City processing with relation
    if (locationData?.cityId) {
      if (isCreateMode) {
        // Create mode: Always set if provided
        updateData.city_user_cityTocity = {
          connect: { id: locationData.cityId }
        };
      } else if (isFullUpdate) {
        // Full update: Update if different
        if (existingUser.city !== locationData.cityId) {
          updateData.city_user_cityTocity = {
            connect: { id: locationData.cityId }
          };
        }
      } else {
        // Partial update: Only if existing city is empty/null
        if (!existingUser.city || 
            existingUser.city === '' || 
            existingUser.city === null) {
          updateData.city_user_cityTocity = {
            connect: { id: locationData.cityId }
          };
        }
      }
    }

    // Country processing with relation
    if (locationData?.countryId) {
      if (isCreateMode) {
        // Create mode: Always set if provided
        updateData.country_user_countryTocountry = {
          connect: { id: locationData.countryId }
        };
      } else if (isFullUpdate) {
        // Full update: Update if different
        if (existingUser.country !== locationData.countryId) {
          updateData.country_user_countryTocountry = {
            connect: { id: locationData.countryId }
          };
        }
      } else {
        // Partial update: Only if existing country is empty/null
        if (!existingUser.country || 
            existingUser.country === '' || 
            existingUser.country === null) {
          updateData.country_user_countryTocountry = {
            connect: { id: locationData.countryId }
          };
        }
      }
    }
  }

  private processCompanyFields(
    userData: UserUpsertRequestDto,
    existingUser: any | null,
    updateData: any,
    companyData: any,
    isFullUpdate: boolean
  ): void {
    const isCreateMode = existingUser === null;

    if (companyData?.companyId) {
      if (isCreateMode) {
        // Create mode: Always set if provided
        updateData.company_user_companyTocompany = {
          connect: { id: companyData.companyId }
        };
      } else if (isFullUpdate) {
        // Full update: Always update
        updateData.company_user_companyTocompany = {
          connect: { id: companyData.companyId }
        };
      } else {
        // Partial update: Only if no existing company
        if (!existingUser.company) {
          updateData.company_user_companyTocompany = {
            connect: { id: companyData.companyId }
          };
        }
      }
    } else if (companyData?.shouldUpdateCompany && companyData?.companyId === undefined) {
      // Disconnect company if shouldUpdateCompany is true but no companyId provided
      if (!isCreateMode) {
        updateData.company_user_companyTocompany = {
          disconnect: true
        };
      }
    }
  }


  private processDesignationFields(
    userData: UserUpsertRequestDto,
    existingUser: any | null,
    updateData: any,
    designationData: any,
    isFullUpdate: boolean
    ): void {
    const isCreateMode = existingUser === null;

    // Designation ID processing
    if (designationData?.designationId) {
        if (isCreateMode) {
        // Create mode: Always set if provided
        updateData.designation_id = designationData.designationId;
        } else if (isFullUpdate) {
        // Full update: Update if different
        if (existingUser.designation_id !== designationData.designationId) {
            updateData.designation_id = designationData.designationId;
        }
        } else {
        // Partial update: Only if existing designation_id is empty
        if (!existingUser.designation_id) {
            updateData.designation_id = designationData.designationId;
        }
      }
    }
  }

  private processSocialFields(
    userData: UserUpsertRequestDto,
    existingUser: any | null,
    updateData: any,
    isFullUpdate: boolean
    ): void {
    const isCreateMode = existingUser === null;

    // LinkedIn processing
    if (userData.linkedinId) {
        const linkedinId = this.extractSocialId('linkedin', userData.linkedinId);
        if (linkedinId) {
        if (isCreateMode) {
            // Create mode: Always set if provided
            updateData.linkedin_id = linkedinId;
            updateData.verified = true;
            if (userData.email || (existingUser && existingUser.email)) {
                updateData.email_verified = new Date();
            }
        } else if (isFullUpdate) {
            // Full update: Update if different
            if (existingUser.linkedin_id !== linkedinId) {
            updateData.linkedin_id = linkedinId;
            updateData.verified = true;
            if (userData.email || (existingUser && existingUser.email)) {
                updateData.email_verified = new Date();
            }
            }
        } else {
            // Partial update: Only if existing LinkedIn ID is empty
            if (!existingUser.linkedin_id || 
                existingUser.linkedin_id === '' || 
                existingUser.linkedin_id === null || 
                existingUser.linkedin_id === 'NULL') {
            updateData.linkedin_id = linkedinId;
            updateData.verified = true;
            if (userData.email || (existingUser && existingUser.email)) {
                updateData.email_verified = new Date();
            }
            }
        }
        }
        
        // LinkedIn profile metadata
        if (userData.metadata) {
        if (isCreateMode) {
            // Create mode: Always set if provided
            updateData.linkedin_profile = userData.metadata;
        } else if (isFullUpdate) {
            updateData.linkedin_profile = userData.metadata;
        } else {
            if (!existingUser.linkedin_profile || existingUser.linkedin_profile === '') {
            updateData.linkedin_profile = userData.metadata;
            }
        }
        }
    }

    // Facebook processing
    if (userData.facebookId) {
        const facebookId = this.extractSocialId('facebook', userData.facebookId);
        if (facebookId) {
        if (isCreateMode) {
            // Create mode: Always set if provided
            updateData.facebook_id = facebookId;
            updateData.verified = true;
            if (userData.email || (existingUser && existingUser.email)) {
                updateData.email_verified = new Date();
            }
        } else if (isFullUpdate) {
            // Full update: Update if different
            if (existingUser.facebook_id !== facebookId) {
            updateData.facebook_id = facebookId;
            updateData.verified = true;
            if (userData.email || (existingUser && existingUser.email)) {
                updateData.email_verified = new Date();
            }
            }
        } else {
            // Partial update: Only if existing Facebook ID is empty
            if (!existingUser.facebook_id || 
                existingUser.facebook_id === '' || 
                existingUser.facebook_id === null || 
                existingUser.facebook_id === 'NULL') {
            updateData.facebook_id = facebookId;
            updateData.verified = true;
            if (userData.email || (existingUser && existingUser.email)) {
                updateData.email_verified = new Date();
            }
            }
        }
        }

        // Facebook profile metadata
        if (userData.metadata) {
        if (isCreateMode) {
            // Create mode: Always set if provided
            updateData.profile = userData.metadata;
        } else if (isFullUpdate) {
            updateData.profile = userData.metadata;
        } else {
            if (!existingUser.profile || existingUser.profile === '') {
            updateData.profile = userData.metadata;
            }
        }
        }
    }

    // Google processing
    if (userData.googleId) {
        const googleId = this.extractSocialId('google', userData.googleId);
        if (googleId) {
        if (isCreateMode) {
            // Create mode: Always set if provided
            updateData.google_id = googleId;
            updateData.verified = true;
            if (userData.email || (existingUser && existingUser.email)) {
                updateData.email_verified = new Date();
            }
        } else if (isFullUpdate) {
            // Full update: Update if different
            if (existingUser.google_id !== googleId) {
            updateData.google_id = googleId;
            updateData.verified = true;
            if (userData.email || (existingUser && existingUser.email)) {
                updateData.email_verified = new Date();
            }
            }
        } else {
            // Partial update: Only if existing Google ID is empty
            if (!existingUser.google_id || 
                existingUser.google_id === '' || 
                existingUser.google_id === null || 
                existingUser.google_id === 'NULL') {
            updateData.google_id = googleId;
            updateData.verified = true;
            if (userData.email || (existingUser && existingUser.email)) {
                updateData.email_verified = new Date();
            }
            }
        }
        }

        // Google profile metadata
        if (userData.metadata) {
        if (isCreateMode) {
            // Create mode: Always set if provided
            updateData.google_profile = userData.metadata;
        } else if (isFullUpdate) {
            updateData.google_profile = userData.metadata;
        } else {
            if (!existingUser.google_profile || existingUser.google_profile === '') {
            updateData.google_profile = userData.metadata;
            }
        }
        }
    }

    // Twitter processing
    if (userData.twitterId) {
        if (isCreateMode) {
        // Create mode: Always set if provided
        updateData.twitter_id = userData.twitterId;
        } else if (isFullUpdate) {
        // Full update: Update if different
        if (existingUser.twitter_id !== userData.twitterId) {
            updateData.twitter_id = userData.twitterId;
        }
        } else {
        // Partial update: Only if existing Twitter ID is empty
        if (!existingUser.twitter_id || 
            existingUser.twitter_id === '' || 
            existingUser.twitter_id === null || 
            existingUser.twitter_id === 'NULL') {
            updateData.twitter_id = userData.twitterId;
        }
        }
    }

    // Wikipedia processing
    if (userData.wikipediaId) {
        if (isCreateMode) {
        // Create mode: Always set if provided
        updateData.wikipedia = userData.wikipediaId;
        } else if (isFullUpdate) {
        // Full update: Update if different
        if (existingUser.wikipedia !== userData.wikipediaId) {
            updateData.wikipedia = userData.wikipediaId;
        }
        } else {
        // Partial update: Only if existing Wikipedia is empty
        if (!existingUser.wikipedia || 
            existingUser.wikipedia === '' || 
            existingUser.wikipedia === null || 
            existingUser.wikipedia === 'NULL') {
            updateData.wikipedia = userData.wikipediaId;
        }
        }
    }

    // Social media removal (only applies to update mode)
    if (!isCreateMode && userData.facebookId === 'remove') {
      updateData.facebook_id = null;
      updateData.profile = null;
      return;
    }
    if (!isCreateMode && userData.linkedinId === 'remove') {
      updateData.linkedin_id = null;
      updateData.linkedin_profile = null;
      return;
    }

    if (!isCreateMode && userData.googleId === 'remove') {
      updateData.google_id = null;
      updateData.google_profile = null;
      return;
    }


  }

  private processVerificationFields(
    userData: UserUpsertRequestDto,
    existingUser: any | null,
    updateData: any,
    isFullUpdate: boolean
    ): void {
    const isCreateMode = existingUser === null;

    // Email verification
    if (
        (updateData.email || existingUser?.email) && 
        userData.action !== 'redeemCredits') {
      
      if (isCreateMode || !existingUser.email_verified) {
        updateData.email_verified = new Date();
      }
    }

    // Phone verification
    let shouldVerifyPhone = false;
  
    // Check verification source
    if (userData.verificationSource && 
        ['sms', 'autocall', 'whatsapp'].includes(userData.verificationSource)) {
      shouldVerifyPhone = true;
    }
    
    // Check SMS verification flags
    if (userData.userVerified && userData.inviteVerify) {
      shouldVerifyPhone = true;
    }
    
    // Apply phone verification if conditions are met and phone exists
    if (shouldVerifyPhone && 
        (updateData.phone || userData.phone) && 
        (isCreateMode || !existingUser?.phone_verified)) {
      updateData.phone_verified = new Date();
      updateData.verified = true;
    }

    // **FIXED: Profile verification**
    // Profile should be verified when name is provided
    if ((updateData.name || userData.name) && userData.name?.trim() !== '') {
      updateData.profile_verified = new Date();
    }
  }

  private processProfileFields(
    userData: UserUpsertRequestDto,
    existingUser: any | null,
    updateData: any,
    isFullUpdate: boolean
    ): void {
    const isCreateMode = existingUser === null;

    // Profile picture processing
    // if (userData.profilePicture && userData.profilePicture.trim() !== '') {
    //     if (isCreateMode) {
    //     // Create mode: Always set if provided
    //     updateData.profile_picture = userData.profilePicture;
    //     } else if (isFullUpdate) {
    //     // Full update: Handle social picture logic
    //     if (userData.pictureFromSocial && existingUser.profile_picture) {
    //         // Don't update if picture is from social and user already has one
    //     } else {
    //         updateData.profile_picture = userData.profilePicture;
    //     }
    //     } else {
    //     // Partial update: Only if empty or handle social media sources
    //     if (userData.pictureFromSocial && existingUser.profile_picture) {
    //         // Don't update
    //     } else if (!existingUser.profile_picture || 
    //                 existingUser.profile_picture === '' || 
    //                 existingUser.profile_picture === null || 
    //                 existingUser.profile_picture === 'NULL') {
    //         updateData.profile_picture = userData.profilePicture;
    //     }
    //     }
    // }

    if (!isCreateMode && userData.profilePicture === 'remove') {
      updateData.profile_picture = null;
    }

    if (userData.profilePicture && userData.profilePicture.trim() !== '' && userData.profilePicture!=='remove') {
      if (isCreateMode) {
        // Create mode: Always set if provided
        updateData.profile_picture = userData.profilePicture;
      } else if (isFullUpdate) {
        // Full update mode: Check social source logic 
        const source = this.determineSource(userData); // facebook/linkedin/google
        
        if (userData.pictureFromSocial && existingUser.profile_picture && 
            existingUser.profile_picture !== '' && existingUser.profile_picture !== null) {
          // Don't update if picture is from social and user already has one
        } else if (existingUser.profile_picture && existingUser.profile_picture !== '' && 
                  existingUser.profile_picture !== null && 
                  (source === 'linkedin' || source === 'facebook' || source === 'google')) {
          // Don't update if user has picture and source is social
        } else {
          updateData.profile_picture = userData.profilePicture;
        }
      } else {
        // Partial update: Only if existing picture is empty/null 
        if (!existingUser.profile_picture || 
            existingUser.profile_picture === '' || 
            existingUser.profile_picture === null || 
            existingUser.profile_picture === 'NULL') {
          
          // Check pictureFromSocial flag
          if (userData.pictureFromSocial && existingUser.profile_picture) {
            // Don't update
          } else {
            updateData.profile_picture = userData.profilePicture;
          }
        }
      }
    }

    // Profile settings
    if (userData.showMe !== undefined) {
        updateData.show_profile = this.normalizeBoolean(userData.showMe);
    }

    if (userData.introduceMe !== undefined) {
        updateData.autointroduce = this.normalizeBoolean(userData.introduceMe);
    }

    // Subscription
    if (userData.subscription !== undefined) {
      updateData.unsubscribe = this.normalizeToInt(userData.subscription);
    }

    // IP Address - only if empty
    if (userData.ip && (isCreateMode || !existingUser.ip_address)) {
        const ipArray = userData.ip.split(',');
        updateData.ip_address = ipArray[0];
    }

    if (userData.name && userData.name.trim() !== '') {
      updateData.profile_verified = new Date();
    }
  }

  private determineSource(userData: UserUpsertRequestDto): string | null {
    if (userData.facebookId || userData.source === 'facebook') return 'facebook';
    if (userData.linkedinId || userData.source === 'linkedin') return 'linkedin';
    if (userData.googleId || userData.source === 'google') return 'google';
    return null;
  }

  private normalizeToInt(value: any): number {
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    if (typeof value === 'string') {
      return ['1', 'true', 'yes'].includes(value.toLowerCase()) ? 1 : 0;
    }
    if (typeof value === 'number') {
      return value > 0 ? 1 : 0;
    }
    return 0;
  }


  private extractSocialId(platform: string, input: string): string {
    if (!input || input.trim() === '') {
      return input;
    }

    const urlParts = input.split('/');

    switch (platform) {
      case 'linkedin':
        return urlParts.length > 4 ? urlParts[4] : input;
      
      case 'facebook':
        if (urlParts.length > 4 && /^\d+$/.test(urlParts[4])) {
          return urlParts[4];
        }
        return input;
      
      case 'google':
        if (urlParts.length > 3) {
          if (!/^\d+$/.test(urlParts[3])) {
            return urlParts.length > 5 ? urlParts[5] : input;
          } else {
            return urlParts[3];
          }
        }
        return input;
      
      default:
        return input;
    }
  }

  private shouldSetEUser(userData: UserUpsertRequestDto): boolean {
    if (userData.platform === 'nmp') {
      return true;
    }

    if (userData.source) {
      const sourceArray = userData.source.split('-');
      if ((sourceArray[0] === '10t' || sourceArray[0] === 'track_10t') &&
          (sourceArray[1] === 'IosEapp' || sourceArray[1] === 'AndroidEapp')) {
        return true;
      }
    }

    return false;
  }

  private async deleteUserConnections(userId: number, db: any): Promise<void> {
    try {
      // Get user connections
      const connections = await db.connect.findMany({
        where: { user_reference: userId },
        select: {
          id: true,
          entity_id: true,
          entity_type: true,
          role_id: true,
          metadata: true,
        },
      });

      // Delete each connection with reason
      for (const connection of connections) {
        let metadata: any = {};
        try {
          metadata = connection.metadata ? JSON.parse(connection.metadata) : {};
        } catch {
          metadata = {};
        }
        
        metadata.reason = 'User-deactivated';

        // TODO: Implement contact deletion logic 
        // This would involve calling contactDelete method
        this.logger.log(`Connection ${connection.id} marked for deletion`);
      }

    } catch (error) {
      this.logger.error(`Delete user connections failed: ${error.message}`);
      throw error;
    }
  }

  private normalizeBoolean(value: any): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return ['1', 'true', 'yes'].includes(value.toLowerCase());
    }
    if (typeof value === 'number') {
      return value > 0;
    }
    return false;
  }

  async formatUserData(user: any, isExistingUser: boolean = false): Promise<any> {
    try {
      // const isNewUser = this.isNewlyCreatedUser(user);
      const isNewUser = isExistingUser ? false : this.isNewlyCreatedUser(user);

      const result: any = {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        userCompany: user.user_company,
        designation: user.designation,
        city: user.city,
        country: user.country,
        about: user.about,
        website: user.website,
        verified: user.verified || 0,
        lastActive: user.last_active ? user.last_active.toISOString().split('T')[0] : null,
        profilePage: user.profile_page, 
        membership: user.membership,
        spamFlag: user.spam_flag, 
        userExists: isNewUser ? 0 : 1,
        userCreated: user.created.toISOString().replace('T', ' ').split('.')[0], 
      };

      result.profileScore = user.profile_score_completed || null;
      result.speakerProfileScore = user.speaker_profile_score || null;
      result.profileComplete = user.profile_completed ? 1 : 0;

      result.firstVerified = 0;
      if (user.name && user.email && user.city && user.country && user.verified) {
        result.firstVerified = 0; // Set to 1 if first time
      }

      // Location data enhancement
      await this.enhanceLocationData(result, user);

      // Phone validation and formatting
      await this.enhancePhoneData(result, user);

      // Email validation
      this.enhanceEmailData(result, user);

      // Profile picture resolution
      await this.enhanceProfilePicture(result, user);

      // Social media URL construction
      this.enhanceSocialMediaUrls(result, user);

      // Verification status
      this.enhanceVerificationStatus(result, user);

      // Profile completeness analysis
      this.enhanceProfileCompleteness(result, user);

      // Missing data analysis
      this.enhanceMissingDataAnalysis(result);

      // Password status
      this.enhancePasswordStatus(result, user);

      return result;

    } catch (error) {
      this.logger.error(`Format user data failed: ${error.message}`);
      throw error;
    }
  }

  // private async enhanceLocationData(result: any, user: any): Promise<void> {
  //   try {
  //     // Initialize defaults
  //     result.cityName = '';
  //     result.stateName = '';
  //     result.countryName = '';
  //     result.placeId = ''; // Fixed camelCase
  //     result.cityUrl = '';
  //     result.countryUrl = '';

  //     if (user.city && typeof user.city === 'number') {
  //       // Get city with country relation
  //       const city = user.city_user_cityTocity || await this.prisma.city.findUnique({
  //         where: { id: user.city },
  //         // include: {
  //         //   country_city_countryTocountry: true,
  //         // },
  //       });

  //       if (city) {
  //         result.cityName = city.name || '';
  //         result.stateName = city.state || '';
  //         result.placeId = city.place_id || ''; // Fixed camelCase
  //         result.cityUrl = city.url || '';
          
  //         // Get country data
  //         if (city.country_city_countryTocountry) {
  //           result.countryName = city.country_city_countryTocountry.name || '';
  //           result.countryUrl = city.country_city_countryTocountry.url || '';
  //         }
  //       }
  //     } else if (user.country && user.country !== '') {
  //       // Only country, no city
  //       const country = user.country_user_countryTocountry || await this.prisma.country.findUnique({
  //         where: { id: user.country },
  //       });

  //       if (country) {
  //         result.countryName = country.name || '';
  //         result.countryUrl = country.url || '';
  //       }
  //     }

  //   } catch (error) {
  //     this.logger.error(`Enhance location data failed: ${error.message}`);
  //   }
  // }

  private async enhanceLocationData(result: any, user: any): Promise<void> {
    try {
      result.cityName = '';
      result.stateName = '';
      result.countryName = '';
      result.placeId = '';
      result.cityUrl = '';
      result.countryUrl = '';

      if (user.city && typeof user.city === 'number') {
        const city = user.city_user_cityTocity || await this.prisma.city.findUnique({
          where: { id: user.city },
        });

        if (city) {
          result.cityName = city.name || '';
          result.stateName = city.state || '';
          result.placeId = city.place_id || '';
          result.cityUrl = city.url || '';

          let country: any = null;
          if (city.country) {
            country = await this.prisma.country.findUnique({
              where: { id: city.country },
            });
          }

          if (country) {
            result.countryName = country.name || '';
            result.countryUrl = country.url || '';
          }
        }

      } else if (user.country && user.country !== '') {
        const country = user.country_user_countryTocountry || await this.prisma.country.findUnique({
          where: { id: user.country },
        });

        if (country) {
          result.countryName = country.name || '';
          result.countryUrl = country.url || '';
        }
      }

    } catch (error) {
      this.logger.error(`Enhance location data failed: ${error.message}`);
    }
  }


  private async enhancePhoneData(result: any, user: any): Promise<void> {
    try {
      const phoneValidation = this.phoneValidationService.validatePhone(user.phone || '');
      
      result.numberValid = { // Fixed structure
        numberType: phoneValidation.numberType || 0,
        isValid: phoneValidation.isValid,
        internationalFormat: phoneValidation.internationalFormat || '',
        countryCode: phoneValidation.countryCode || 0,
        nationalFormat: phoneValidation.nationalFormat || '',
      };

      result.isNumberValid = phoneValidation.isValid; // Fixed camelCase
      result.countryCode = phoneValidation.internationalFormat.split(' ')[0] || '';
      result.hasPhone = phoneValidation.isValid ? 1 : 0;

      // Create masked phone
      result.maskedPhone = this.phoneValidationService.createMaskedPhone(phoneValidation); // Fixed camelCase

    } catch (error) {
      this.logger.error(`Enhance phone data failed: ${error.message}`);
      // Set defaults
      result.numberValid = {
        numberType: 0,
        isValid: false,
        internationalFormat: '',
        countryCode: 0,
        nationalFormat: '',
      };
      result.isNumberValid = false; // Fixed camelCase
      result.countryCode = '';
      result.hasPhone = 0;
      result.maskedPhone = ''; // Fixed camelCase
    }
  }

  private enhanceEmailData(result: any, user: any): void {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    result.isEmailValid = user.email && emailRegex.test(user.email) ? 'true' : 'false'; // Fixed camelCase
  }

  private async enhanceProfilePicture(result: any, user: any): Promise<void> {
    try {
      let image = '';

      // Priority 1: Direct profile picture
      if (user.profile_picture && user.profile_picture.trim() !== '' && 
          user.profile_picture !== 'NULL' && user.profile_picture !== null && !user.profile_picture.includes('x-empty')) {
        image = user.profile_picture;
      }

      // Priority 2: LinkedIn profile picture
      if (!image && user.linkedin_profile && user.linkedin_profile.trim() !== '' && 
          user.linkedin_profile !== 'NULL') {
        try {
          const linkedinData = JSON.parse(user.linkedin_profile);
          if (linkedinData.pictureUrl) {
            image = linkedinData.pictureUrl;
          }
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Priority 3: Facebook profile picture
      if (!image && user.profile && user.profile.trim() !== '' && user.profile !== 'NULL') {
        try {
          const facebookData = JSON.parse(user.profile);
          if (facebookData.id) {
            image = `https://graph.facebook.com/${facebookData.id}/picture`;
          }
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Priority 4: Generated avatar from name
      if (!image && user.name && user.name.trim() !== '') {
        const nameArray = user.name.split('');
        for (const char of nameArray) {
          if (/[a-zA-Z]/.test(char)) {
            image = `${process.env.GIFBT_IMAGE_URL || ''}/userimages/${char.toLowerCase()}.jpg`;
            break;
          }
        }
      }

      // Priority 5: Default fallback
      if (!image) {
        image = `${process.env.GIFBT_IMAGE_URL || ''}/img/no-pic.jpg`;
      }

      result.profilePicture = image; // Fixed camelCase

    } catch (error) {
      this.logger.error(`Enhance profile picture failed: ${error.message}`);
      result.profilePicture = `${process.env.GIFBT_IMAGE_URL || ''}/img/no-pic.jpg`; // Fixed camelCase
    }
  }

  private enhanceSocialMediaUrls(result: any, user: any): void {
    try {
      // Initialize defaults with camelCase
      result.facebookId = '';
      result.linkedinId = '';
      result.googleId = '';
      result.twitterId = '';

      // Facebook URL from profile JSON
      if (user.profile && user.profile.trim() !== '' && user.profile !== 'NULL') {
        try {
          const facebookData = JSON.parse(user.profile);
          if (facebookData.id) {
            result.facebookId = `http://facebook.com/${facebookData.id}`;
          }
        } catch {
          // Ignore JSON parse errors
        }
      }

      // LinkedIn URL from linkedin_profile JSON
      if (user.linkedin_profile && user.linkedin_profile.trim() !== '' && user.linkedin_profile !== 'NULL') {
        try {
          const linkedinData = JSON.parse(user.linkedin_profile);
          if (linkedinData.publicProfileUrl) {
            result.linkedinId = linkedinData.publicProfileUrl;
          }
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Google URL - handle various formats
      if (user.google_id && user.google_id.trim() !== '' && user.google_id !== 'NULL') {
        result.googleId = user.google_id.trim();
        
        // Add URL prefix if it's just a numeric ID
        if (result.googleId && 
            !result.googleId.includes('plus.google.com') && 
            /^\d+$/.test(result.googleId)) {
          result.googleId = `https://plus.google.com/${result.googleId}`;
        }
      }

      // Twitter URL
      if (user.twitter_id && user.twitter_id.trim() !== '' && user.twitter_id !== 'NULL') {
        result.twitterId = user.twitter_id.trim();
        
        // Add URL prefix if it doesn't already have it
        if (result.twitterId && 
            !result.twitterId.includes('twitter.com')) {
          result.twitterId = `https://twitter.com/${result.twitterId}`;
        }
      }

    } catch (error) {
      this.logger.error(`Enhance social media URLs failed: ${error.message}`);
      // Keep defaults
    }
  }

  private enhanceVerificationStatus(result: any, user: any): void {
    // Phone verification
    result.phoneVerified = user.phone_verified ? 1 : 0;
    result.phoneVerifiedDate = user.phone_verified ? // Fixed camelCase
      user.phone_verified.toISOString().split('T')[0] : null;

    // Email verification
    result.emailVerified = user.email_verified ? 1 : 0;

    // Profile verification
    result.profileVerified = user.profile_verified ? 
      user.profile_verified.toISOString().split('T')[0] : null;

    // First-time verification flag
    result.firstVerified = 0;
    if (user.name && user.email && user.city && user.country && user.verified) {
      // Check if this is first time profile completion
      result.firstVerified = 0; // Simplified for now
    }
  }

  private enhanceProfileCompleteness(result: any, user: any): void {
    // Complete profile check
    const hasEmail = result.isEmailValid === "true";
    const hasValidPhone = result.isNumberValid === true;
    const hasLocation = result.placeId && result.placeId !== '';
    const hasCompany = result.userCompany && result.userCompany.trim() !== '';
    const hasDesignation = result.designation && result.designation.trim() !== '';
    const hasName = result.name && result.name.trim() !== '';
    
    // Complete profile requires: name + (email OR phone) + location + company + designation
    if (hasName && (hasEmail || hasValidPhone) && hasLocation && hasCompany && hasDesignation) {
      result.isCompleteProfile = 1;
    } else {
      result.isCompleteProfile = 0;
    }

    // Profile completion status (from database)
    result.profileComplete = user.profile_completed ? 1 : 0;

    // Profile score
    result.profileScore = user.profile_score_completed || null;
  }

  private enhanceMissingDataAnalysis(result: any): void {
    result.missingData = {
      name: result.name ? 0 : 1,
      placeId: (result.placeId && result.placeId !== '') ? 0 : 1, // Fixed camelCase
      userCompany: result.userCompany ? 0 : 1,
      designation: result.designation ? 0 : 1,
      phoneNumber: result.numberValid.isValid ? 0 : 1,
    };
  }

  private enhancePasswordStatus(result: any, user: any): void {
    const passwordLength = user.password ? user.password.toString().length : 0;
    result.hasPassword = passwordLength > 4;
  }

  private isNewlyCreatedUser(user: any): boolean {
    const now = new Date();
    const createdTime = new Date(user.created);
    const timeDiffInSeconds = (now.getTime() - createdTime.getTime()) / 1000;
    return timeDiffInSeconds < 10; // Less than 10 seconds = newly created
  }
}