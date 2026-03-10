import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { CasesService, CaseListItem } from '../../services/cases.service';
import {
  DocumentsService,
  DocumentListItem,
  DocumentQueryResponse
} from '../../services/documents.service';

const POLL_INTERVAL_MS = 3000;

@Component({
  standalone: false,
  selector: 'app-documents-page',
  templateUrl: './documents.page.html',
  styleUrl: './documents.page.css'
})
export class DocumentsPage implements OnInit, OnDestroy {
  cases: CaseListItem[] = [];
  selectedCaseId: string | null = null;
  documents: DocumentListItem[] = [];
  listBusy = false;
  listError: string | null = null;
  uploadBusy = false;
  uploadError: string | null = null;
  queryBusy = false;
  queryError: string | null = null;
  question = '';
  queryResult: DocumentQueryResponse | null = null;
  deleteBusy: Record<string, boolean> = {};
  retryBusy: Record<string, boolean> = {};
  dragOver = false;
  showDeleteConfirm = false;
  documentToDelete: DocumentListItem | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly casesApi: CasesService,
    private readonly documentsApi: DocumentsService
  ) {}

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigateByUrl('/login');
      return;
    }
    if (this.auth.mustCompleteRegistration()) {
      void this.router.navigateByUrl('/register');
      return;
    }
    this.loadCases();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  private hasProcessingOrUploaded(): boolean {
    return this.documents.some(
      (d) => d.status === 'processing' || d.status === 'uploaded'
    );
  }

  private startPolling(): void {
    this.stopPolling();
    if (!this.hasProcessingOrUploaded()) return;
    this.pollTimer = setInterval(() => {
      if (!this.selectedCaseId || this.listBusy) {
        this.stopPolling();
        return;
      }
      void this.loadDocuments().then(() => {
        if (!this.hasProcessingOrUploaded()) this.stopPolling();
      });
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Administrator, Petitioner Attorney, or Legal Assistant can run document Q&A. */
  get canRunDocumentQuery(): boolean {
    return this.auth.hasRole(3, 5, 6);
  }

  /** Only administrators may delete documents (e.g. when petitioner is unavailable). */
  get canDeleteDocuments(): boolean {
    return this.auth.isAdmin();
  }

  get selectedCase(): CaseListItem | null {
    if (!this.selectedCaseId) return null;
    return this.cases.find((c) => c.id === this.selectedCaseId) ?? null;
  }

  get deleteConfirmTitle(): string {
    const name = this.documentToDelete?.originalName ?? 'document';
    return `Delete "${name}"?`;
  }

  get deleteConfirmMessage(): string {
    return 'This cannot be undone.';
  }

  get canUpload(): boolean {
    const c = this.selectedCase;
    if (!c) return false;
    const userId = this.auth.getUserIdFromToken();
    return c.petitioner?.id === userId;
  }

  async loadCases(): Promise<void> {
    try {
      this.cases = await this.casesApi.list();
      if (this.cases.length > 0 && !this.selectedCaseId) {
        this.selectedCaseId = this.cases[0].id;
        this.loadDocuments();
      } else if (this.selectedCaseId) {
        this.loadDocuments();
      }
    } catch (e: unknown) {
      const err = e as { status?: number; error?: { error?: string } };
      if (err?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
        return;
      }
      this.listError = err?.error?.error ?? 'Failed to load cases';
    }
  }

  onCaseChange(): void {
    this.documents = [];
    this.listError = null;
    if (this.selectedCaseId) this.loadDocuments();
  }

  async loadDocuments(): Promise<void> {
    if (!this.selectedCaseId) return;
    this.listBusy = true;
    this.listError = null;
    try {
      this.documents = await this.documentsApi.listByCase(this.selectedCaseId);
      if (this.hasProcessingOrUploaded()) this.startPolling();
      else this.stopPolling();
    } catch (e: unknown) {
      const err = e as { status?: number; error?: { error?: string } };
      if (err?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
        return;
      }
      this.listError = err?.error?.error ?? 'Failed to load documents';
    } finally {
      this.listBusy = false;
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.uploadFile(file);
      input.value = '';
    }
  }

  onDragOver(event: DragEvent): void {
    if (!this.selectedCaseId || !this.canUpload || this.uploadBusy) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.dragOver = true;
  }

  onDragLeave(_event: DragEvent): void {
    this.dragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver = false;
    if (!this.selectedCaseId || !this.canUpload || this.uploadBusy) return;
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    const pdfs = Array.from(files).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) {
      this.uploadError = 'Only PDF files are allowed.';
      return;
    }
    this.uploadError = null;
    this.uploadFiles(pdfs);
  }

  /** Upload a single file (used by both file input and drag-drop). */
  uploadFile(file: File): void {
    if (!this.selectedCaseId || !this.canUpload) return;
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      this.uploadError = 'Only PDF files are allowed.';
      return;
    }
    this.uploadError = null;
    this.uploadBusy = true;
    this.documentsApi
      .upload(this.selectedCaseId, file)
      .then(() => void this.loadDocuments())
      .catch((e: unknown) => {
        const err = e as { status?: number; error?: { error?: string } };
        if (err?.status === 401) {
          this.auth.logout();
          void this.router.navigateByUrl('/login');
          return;
        }
        this.uploadError = err?.error?.error ?? 'Upload failed';
      })
      .finally(() => {
        this.uploadBusy = false;
      });
  }

  /** Upload multiple PDFs in sequence. */
  private uploadFiles(files: File[]): void {
    if (files.length === 0) return;
    this.uploadBusy = true;
    let index = 0;
    const next = (): void => {
      if (index >= files.length) {
        this.uploadBusy = false;
        void this.loadDocuments();
        return;
      }
      const file = files[index++];
      this.documentsApi
        .upload(this.selectedCaseId!, file)
        .then(() => next())
        .catch((e: unknown) => {
          const err = e as { status?: number; error?: { error?: string } };
          if (err?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
            this.uploadBusy = false;
            return;
          }
          this.uploadError = err?.error?.error ?? 'Upload failed';
          this.uploadBusy = false;
          void this.loadDocuments();
        });
    };
    next();
  }

  async download(doc: DocumentListItem): Promise<void> {
    if (!this.selectedCaseId) return;
    try {
      const { url } = await this.documentsApi.getDownloadUrl(this.selectedCaseId, doc.id);
      window.open(url, '_blank');
    } catch (e: unknown) {
      const err = e as { error?: { error?: string } };
      alert(err?.error?.error ?? 'Download failed');
    }
  }

  async retry(doc: DocumentListItem): Promise<void> {
    if (!this.selectedCaseId || doc.status !== 'failed') return;
    this.retryBusy[doc.id] = true;
    try {
      await this.documentsApi.retry(this.selectedCaseId, doc.id);
      void this.loadDocuments();
    } catch (e: unknown) {
      const err = e as { error?: { error?: string } };
      alert(err?.error?.error ?? 'Retry failed');
    } finally {
      this.retryBusy[doc.id] = false;
    }
  }

  openDeleteConfirm(doc: DocumentListItem): void {
    if (!this.selectedCaseId) return;
    this.documentToDelete = doc;
    this.showDeleteConfirm = true;
  }

  onCancelDeleteConfirm(): void {
    this.showDeleteConfirm = false;
    this.documentToDelete = null;
  }

  onConfirmDeleteDoc(): void {
    const doc = this.documentToDelete;
    if (!doc || !this.selectedCaseId) {
      this.onCancelDeleteConfirm();
      return;
    }
    this.showDeleteConfirm = false;
    this.documentToDelete = null;
    this.deleteBusy[doc.id] = true;
    this.documentsApi
      .delete(this.selectedCaseId, doc.id)
      .then(() => void this.loadDocuments())
      .catch((e: unknown) => {
        const err = e as { error?: { error?: string } };
        alert(err?.error?.error ?? 'Delete failed');
      })
      .finally(() => {
        this.deleteBusy[doc.id] = false;
      });
  }

  runQuery(): void {
    const q = this.question.trim();
    if (!q) {
      this.queryError = 'Enter a question.';
      return;
    }
    this.queryError = null;
    this.queryResult = null;
    this.queryBusy = true;
    this.documentsApi
      .query(q)
      .then((result) => {
        this.queryResult = result;
      })
      .catch((e: unknown) => {
        const err = e as { status?: number; error?: { error?: string } };
        if (err?.status === 401) {
          this.auth.logout();
          void this.router.navigateByUrl('/login');
          return;
        }
        if (err?.status === 403) {
          this.queryError = 'Only staff or administrators can run document Q&A.';
          return;
        }
        this.queryError = err?.error?.error ?? 'Query failed';
      })
      .finally(() => {
        this.queryBusy = false;
      });
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'uploaded':
        return 'Queued';
      case 'processing':
        return 'Processing…';
      case 'ready':
        return 'Ready';
      case 'failed':
        return 'Failed';
      default:
        return status;
    }
  }
}
