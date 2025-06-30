import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ReviewData } from '../../common/review.service';

const dateStringToDate = (dateStr?: string): Date | undefined => {
  return dateStr ? new Date(dateStr) : undefined;
};


export const createEventReviewData = (
  eventId: number,
  eventName: string,
  userId: number,
  options: {
    description?: string;
    startDate?: string;
    endDate?: string;
    functionality?: string;
    website?: string;
    eventAudience?: string;
    isRehost?: boolean;
    bypassQC?: boolean;
  } = {}
): ReviewData => ({
  entityType: 'event',
  entityId: eventId,
  entityName: eventName,
  reviewType: 'M',
  modifyType: options.isRehost ? 'R' : 'E',
  byUser: userId,
  addedBy: userId,
  qcBy: userId,
  status: options.bypassQC ? 'A' : 'P',
  title: `Review for event: ${eventName}`,
  content: options.description || `Event ${eventName} review`,
  startDate: dateStringToDate(options.startDate),
  endDate: dateStringToDate(options.endDate),
  functionality: options.functionality,
  website: options.website,
  eventAudience: options.eventAudience,
});