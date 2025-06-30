// import { Injectable, Logger } from '@nestjs/common';
// import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// @Injectable()
// export class S3Service {
//   private readonly logger = new Logger(S3Service.name);
//   private readonly s3Client: S3Client;
//   private readonly bucketName = 'gifbt';
  
//   constructor() {
//     this.s3Client = new S3Client({
//       region: process.env.AWS_REGION || 'us-east-1',
//       credentials: {
//         accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'AKIAIEW2PE2TNNMTW5TA',
//         secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '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',
//       },
//     });
//   }

//   async uploadBannerImage(eventId: number, base64Image: string): Promise<string | null> {
//     try {
//       // Parse base64 data URL
//       const matches = base64Image.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
//       if (!matches) {
//         this.logger.error('Invalid base64 image format');
//         return null;
//       }

//       const imageType = matches[1]; // jpg, png, etc.
//       const imageData = matches[2];
      
//       // Validate image type
//       if (!['jpg', 'jpeg', 'png'].includes(imageType.toLowerCase())) {
//         this.logger.error(`Unsupported image type: ${imageType}`);
//         return null;
//       }

//       // Convert base64 to buffer
//       const imageBuffer = Buffer.from(imageData, 'base64');
      
//       // Generate filename
//       const fileName = `${eventId}_bannerImage`;
//       const fileExtension = imageType === 'jpg' ? 'jpg' : imageType;
      
//       // S3 destination path 
//       const s3Key = `dashboard/events/banner_image/${fileName}.${fileExtension}`;

//       // Upload to S3
//       const uploadCommand = new PutObjectCommand({
//         Bucket: this.bucketName,
//         Key: s3Key,
//         Body: imageBuffer,
//         ContentType: `image/${imageType}`,
//         // ACL: 'public-read',
//         CacheControl: 'max-age=315360000',
//         Expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
//       });

//       await this.s3Client.send(uploadCommand);

//       // Return a simple S3 URL 
//       const s3Url = `https://${this.bucketName}.s3.amazonaws.com/${s3Key}`;
//       this.logger.log(`Successfully uploaded banner image for event ${eventId} to S3: ${s3Url}`);
      
//       return s3Url;

//     } catch (error) {
//       this.logger.error(`Failed to upload banner image for event ${eventId}:`, error.message);
//       return null;
//     }
//   }

//   async processCustomizationBannerImage(customizationData: any, eventId: number): Promise<any> {
//     if (!customizationData.banner_link) {
//       return customizationData;
//     }

//     const imgStr = customizationData.banner_link;

//     // Check if it's a base64 data URL
//     if (imgStr.includes('data:image/')) {
//       this.logger.log(`Processing base64 banner image for event ${eventId}`);
      
//       const uploadedUrl = await this.uploadBannerImage(eventId, imgStr);
//       customizationData.banner_link = uploadedUrl;
      
//     } else if (imgStr.includes('c1.10times.com') || imgStr.includes('stg.10times.com')) {
//       // Keep existing URLs as they are
//       this.logger.log(`Keeping existing banner image URL for event ${eventId}: ${imgStr}`);
//       customizationData.banner_link = imgStr;
      
//     } else {
//       // Invalid or unknown format
//       this.logger.warn(`Invalid banner image format for event ${eventId}, setting to null`);
//       customizationData.banner_link = null;
//     }

//     return customizationData;
//   }
// }

import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as sharp from 'sharp';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client;
  private readonly bucketName = 'gifbt';
  private readonly maxFileSize = 1024 * 1024; // 1MB limit
  
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'AKIAIEW2PE2TNNMTW5TA',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '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',
      },
    });
  }

  async uploadBannerImage(eventId: number, base64Image: string): Promise<string | null> {
    try {
      // Parse base64 data URL
      const matches = base64Image.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
      if (!matches) {
        this.logger.error('Invalid base64 image format');
        return null;
      }

      const imageType = matches[1].toLowerCase(); // jpg, png, etc.
      const imageData = matches[2];
      
      // Validate image type
      if (!['jpg', 'jpeg', 'png'].includes(imageType)) {
        this.logger.error(`Unsupported image type: ${imageType}`);
        return null;
      }

      // Convert base64 to buffer
      let imageBuffer = Buffer.from(imageData, 'base64');
      
      // Process and compress image 
      imageBuffer = await this.processAndCompressImage(imageBuffer, imageType);
      
      // Generate filename 
      const fileName = `${eventId}_bannerImage`;
      const fileExtension = imageType === 'jpeg' ? 'jpg' : imageType;
      
      // S3 destination path
      const s3Key = `dashboard/events/banner_image/${fileName}.${fileExtension}`;

      // Upload to S3
      const uploadCommand = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: imageBuffer,
        ContentType: `image/${fileExtension}`,
        CacheControl: 'max-age=315360000',
        Expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      });

      await this.s3Client.send(uploadCommand);

      // Return CDN URL
      const environment = process.env.NODE_ENV;
      let cdnUrl: string;
      
      if (environment === 'development' || environment === 'staging') {
        cdnUrl = `https://stg.10times.com/S3Data/banner_image/${fileName}.${fileExtension}`;
      } else {
        cdnUrl = `https://c1.10times.com/dashboard/events/banner_image/${fileName}.${fileExtension}`;
      }
      
      this.logger.log(`Successfully uploaded banner image for event ${eventId} to S3: ${cdnUrl}`);
      
      return cdnUrl;

    } catch (error) {
      this.logger.error(`Failed to upload banner image for event ${eventId}:`, error.message);
      return null;
    }
  }

  async processCustomizationBannerImage(customizationData: any, eventId: number): Promise<any> {
    if (!customizationData.banner_link) {
      return customizationData;
    }

    const imgStr = customizationData.banner_link;

    // Check if it's a base64 data URL
    if (imgStr.includes('data:image/')) {
      this.logger.log(`Processing base64 banner image for event ${eventId}`);
      
      const uploadedUrl = await this.uploadBannerImage(eventId, imgStr);
      customizationData.banner_link = uploadedUrl;
      
    } else if (imgStr.includes('c1.10times.com') || imgStr.includes('stg.10times.com')) {
      // Keep existing CDN URLs as they are
      this.logger.log(`Keeping existing banner image URL for event ${eventId}: ${imgStr}`);
      customizationData.banner_link = imgStr;
      
    } else {
      // Invalid or unknown format
      this.logger.warn(`Invalid banner image format for event ${eventId}, setting to null`);
      customizationData.banner_link = null;
    }

    return customizationData;
  }

  private async processAndCompressImage(imageBuffer: Buffer, imageType: string): Promise<Buffer> {
    try {
      let processedBuffer = imageBuffer;

      // Check file size and compress if needed
      const fileSizeKB = imageBuffer.length / 1024;
      
      if (fileSizeKB > 1024) { // If larger than 1MB
        this.logger.log(`Image size ${fileSizeKB}KB exceeds limit, compressing...`);
        
        // Use sharp for compression
        processedBuffer = await sharp(imageBuffer)
          .jpeg({ 
            quality: 50,
            progressive: true 
          })
          .toBuffer();
          
        this.logger.log(`Compressed image from ${fileSizeKB}KB to ${processedBuffer.length / 1024}KB`);
      }

      return processedBuffer;
    } catch (error) {
      this.logger.error('Image processing failed:', error.message);
      return imageBuffer; // Return original if processing fails
    }
  }

  async uploadFile(
    file: Buffer, 
    fileName: string, 
    contentType: string, 
    folder: string = 'general'
  ): Promise<string | null> {
    try {
      const s3Key = `${folder}/${fileName}`;

      const uploadCommand = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: file,
        ContentType: contentType,
        CacheControl: 'max-age=315360000',
      });

      await this.s3Client.send(uploadCommand);

      const s3Url = `https://${this.bucketName}.s3.amazonaws.com/${s3Key}`;
      this.logger.log(`Successfully uploaded file to S3: ${s3Url}`);
      
      return s3Url;

    } catch (error) {
      this.logger.error(`Failed to upload file ${fileName}:`, error.message);
      return null;
    }
  }


  async uploadEventLogo(eventId: number, logoBuffer: Buffer, fileExtension: string): Promise<string | null> {
    const fileName = `${eventId}_logo.${fileExtension}`;
    const folder = 'events/logos';
    
    return this.uploadFile(logoBuffer, fileName, `image/${fileExtension}`, folder);
  }

  /**
   * Upload event wrapper image (auto-generated wrapper images)
   */
  async uploadEventWrapper(eventId: number, wrapperBuffer: Buffer): Promise<string | null> {
    const fileName = `${eventId}_wrapper.jpg`;
    const folder = 'events/wrappers';
    
    return this.uploadFile(wrapperBuffer, fileName, 'image/jpeg', folder);
  }

  async uploadEventDocument(
    eventId: number, 
    documentBuffer: Buffer, 
    originalName: string, 
    contentType: string
  ): Promise<string | null> {
    const timestamp = Date.now();
    const fileName = `${eventId}_${timestamp}_${originalName}`;
    const folder = 'events/documents';
    
    return this.uploadFile(documentBuffer, fileName, contentType, folder);
  }

  private getCdnUrl(s3Key: string): string {
    const environment = process.env.NODE_ENV;
    
    if (environment === 'development' || environment === 'staging') {
      return `https://stg.10times.com/S3Data/${s3Key}`;
    } else {
      return `https://c1.10times.com/${s3Key}`;
    }
  }

  async moveImageToS3(params: {
    entity: string;
    fileSource?: string;
    fileBuffer?: Buffer;
    fileDestination: string;
    contentType?: string;
  }): Promise<boolean> {
    try {
      let fileBuffer: Buffer;

      if (params.fileBuffer) {
        fileBuffer = params.fileBuffer;
      } else if (params.fileSource) {
        throw new Error('fileSource reading not implemented, use fileBuffer instead');
      } else {
        throw new Error('Either fileBuffer or fileSource must be provided');
      }

      const uploadCommand = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: params.fileDestination,
        Body: fileBuffer,
        ContentType: params.contentType || 'application/octet-stream',
        CacheControl: 'max-age=315360000',
      });

      await this.s3Client.send(uploadCommand);

      this.logger.log(`Successfully moved ${params.entity} file to S3: ${params.fileDestination}`);
      return true;

    } catch (error) {
      this.logger.error(`Failed to move ${params.entity} file to S3:`, error.message);
      return false;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      const testCommand = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: 'health-check/test.txt',
        Body: Buffer.from('health check'),
        ContentType: 'text/plain',
      });

      await this.s3Client.send(testCommand);

      return { healthy: true, message: 'S3 service is healthy' };
    } catch (error) {
      return { healthy: false, message: `S3 service error: ${error.message}` };
    }
  }
}