import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class FileSaveService {
  async savePdf(blob: Blob, suggestedName: string): Promise<void> {
    const w: any = window as any;

    // Preferred: File System Access API (Chromium, supported on localhost/https).
    if (typeof w.showSaveFilePicker === 'function') {
      try {
        const handle = await w.showSaveFilePicker({
          suggestedName,
          types: [
            {
              description: 'PDF',
              accept: { 'application/pdf': ['.pdf'] }
            }
          ]
        });

        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (e: any) {
        // User canceled the dialog; treat as a no-op.
        if (e?.name === 'AbortError') return;

        // Fall through to legacy download behavior.
      }
    }

    // Fallback: download via object URL (browser chooses default download location).
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}
