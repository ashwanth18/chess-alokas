import { z } from 'zod';

export const CertificateFieldAlignSchema = z.enum(['left', 'center', 'right']);
export type CertificateFieldAlign = z.infer<typeof CertificateFieldAlignSchema>;

/** Field position is normalized 0–1 relative to page width/height. */
export const CertificateFieldSchema = z.object({
  id: z.string().min(1),
  /** Column key from the data row (e.g. name, rank, category). */
  sourceColumn: z.string().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1).optional(),
  fontSize: z.number().positive().default(18),
  align: CertificateFieldAlignSchema.default('center'),
  color: z.string().default('#1a1208'),
  font: z.enum(['Helvetica', 'Helvetica-Bold', 'Times-Roman', 'Times-Bold']).default('Helvetica'),
});
export type CertificateField = z.infer<typeof CertificateFieldSchema>;

export const CertificateLayoutSchema = z.object({
  pageWidth: z.number().positive(),
  pageHeight: z.number().positive(),
  fields: z.array(CertificateFieldSchema),
});
export type CertificateLayout = z.infer<typeof CertificateLayoutSchema>;

export type CertificateRow = Record<string, string | number | null | undefined>;

export const DIGITAL_TARGET_BYTES = 900_000;
