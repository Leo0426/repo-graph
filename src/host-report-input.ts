import { z } from 'zod';

export const maxHostReportBytes = 1024 * 1024;
export const maxHostReportItems = 5000;
export const hostReportSeverity = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export const submittedTextFiles = z.array(z.object({
    name: z.string().trim().min(1).max(240).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
    content: z.string().max(maxHostReportBytes).nullish().transform(value => value ?? '')
})).max(32).nullish().transform(value => value ?? []);
