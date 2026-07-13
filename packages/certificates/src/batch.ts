import JSZip from 'jszip';
import {
  mergePdfs,
  stampAndCompressDigital,
  stampCertificate,
} from './stamp.js';
import type { CertificateLayout, CertificateRow } from './types.js';

export interface BatchPerson {
  id: string;
  fileName: string;
  row: CertificateRow;
}

export interface BatchResult {
  mergedPdf: Uint8Array;
  zipBytes: Uint8Array;
  individuals: Array<{ id: string; fileName: string; pdf: Uint8Array; byteSize: number }>;
  digital: Array<{
    id: string;
    fileName: string;
    pdf: Uint8Array;
    byteSize: number;
    underTarget: boolean;
  }>;
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'certificate';
}

export async function generateCertificateBatch(
  templateBytes: Uint8Array,
  layout: CertificateLayout,
  people: BatchPerson[],
): Promise<BatchResult> {
  const individuals: BatchResult['individuals'] = [];
  const digital: BatchResult['digital'] = [];
  const zip = new JSZip();

  for (const person of people) {
    const pdf = await stampCertificate(templateBytes, layout, person.row);
    const fileName = `${safeFileName(person.fileName)}.pdf`;
    individuals.push({ id: person.id, fileName, pdf, byteSize: pdf.byteLength });
    zip.file(fileName, pdf);

    const dig = await stampAndCompressDigital(templateBytes, layout, person.row);
    digital.push({
      id: person.id,
      fileName,
      pdf: dig.pdf,
      byteSize: dig.byteSize,
      underTarget: dig.underTarget,
    });
  }

  const mergedPdf = await mergePdfs(individuals.map((i) => i.pdf));
  const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });

  return { mergedPdf, zipBytes, individuals, digital };
}
