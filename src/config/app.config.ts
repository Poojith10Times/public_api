import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(2000),
  DATABASE_URL: z.string(),
});

export type AppConfig = z.infer<typeof envSchema>;

export const validateEnv = () => {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    throw new Error(`Environment validation failed: ${error}`);
  }
};