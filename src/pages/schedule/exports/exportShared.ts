import { ReactElement } from 'react';

export async function renderPdfBlob(doc: ReactElement): Promise<Blob> {
  const { pdf } = await import('@react-pdf/renderer');
  return pdf(doc).toBlob();
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
