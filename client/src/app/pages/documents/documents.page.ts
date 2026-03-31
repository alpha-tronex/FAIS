import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { CasesService, CaseListItem } from '../../services/cases.service';
import {
  DocumentsService,
  DocumentIntakeExtraction,
  DocumentListItem,
  DocumentQueryResponse
} from '../../services/documents.service';

const POLL_INTERVAL_MS = 3000;
/** After apply succeeds, show message then close the intake popup. */
const INTAKE_APPLY_SUCCESS_DISMISS_MS = 2500;

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
  /** null = not yet determined; false = server returned 503 (feature off). */
  intakeFeatureAvailable: boolean | null = null;
  intakeByDocumentId = new Map<string, DocumentIntakeExtraction>();
  intakeListError: string | null = null;
  intakeAnalyzeBusy: Record<string, boolean> = {};
  intakeRejectBusy: Record<string, boolean> = {};
  intakeApplyBusy = false;
  /** Shown in intake popup after successful apply; popup auto-closes after a short delay. */
  intakeApplySuccessMessage: string | null = null;
  /** Shown in intake popup when apply fails (replaces blocking alert). */
  intakeApplyError: string | null = null;
  /** Affidavit intake detail modal */
  intakeDetailOpen = false;
  intakeDetailDoc: DocumentListItem | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private intakeApplySuccessTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.clearIntakeApplySuccessTimer();
  }

  private clearIntakeApplySuccessTimer(): void {
    if (this.intakeApplySuccessTimer) {
      clearTimeout(this.intakeApplySuccessTimer);
      this.intakeApplySuccessTimer = null;
    }
  }

  private hasProcessingOrUploaded(): boolean {
    return this.documents.some(
      (d) => d.status === 'processing' || d.status === 'uploaded'
    );
  }

  private hasIntakeProcessing(): boolean {
    for (const e of this.intakeByDocumentId.values()) {
      if (e.status === 'processing') return true;
    }
    return false;
  }

  private hasReasonToPoll(): boolean {
    return this.hasProcessingOrUploaded() || this.hasIntakeProcessing();
  }

  private mergeLatestIntake(rows: DocumentIntakeExtraction[]): Map<string, DocumentIntakeExtraction> {
    const m = new Map<string, DocumentIntakeExtraction>();
    for (const e of rows) {
      const cur = m.get(e.documentId);
      if (!cur || e.extractionVersion > cur.extractionVersion) {
        m.set(e.documentId, e);
      }
    }
    return m;
  }

  private startPolling(): void {
    this.stopPolling();
    if (!this.hasReasonToPoll()) return;
    this.pollTimer = setInterval(() => {
      if (!this.selectedCaseId) {
        this.stopPolling();
        return;
      }
      void this.loadDocuments(true).then(() => {
        if (!this.hasReasonToPoll()) this.stopPolling();
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

  /** Administrator (any case), petitioner, petitioner attorney, or assigned legal assistant. */
  get canUpload(): boolean {
    const c = this.selectedCase;
    if (!c) return false;
    if (this.auth.isAdmin()) return true;
    const userId = this.auth.getUserIdFromToken();
    if (!userId) return false;
    if (c.petitioner?.id === userId) return true;
    if (c.petitionerAttorney?.id === userId) return true;
    if (c.legalAssistant?.id === userId) return true;
    return false;
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
    this.closeIntakeDetail();
    this.documents = [];
    this.listError = null;
    this.intakeByDocumentId = new Map();
    this.intakeFeatureAvailable = null;
    this.intakeListError = null;
    if (this.selectedCaseId) this.loadDocuments();
  }

  /**
   * @param silent When true (e.g. polling), skip full-page list busy state.
   */
  async loadDocuments(silent = false): Promise<void> {
    if (!this.selectedCaseId) return;
    if (!silent) {
      this.listBusy = true;
    }
    this.listError = null;
    try {
      this.documents = await this.documentsApi.listByCase(this.selectedCaseId);
      await this.refreshIntakeForCase();
      if (this.hasReasonToPoll()) this.startPolling();
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
      if (!silent) {
        this.listBusy = false;
      }
    }
  }

  private async refreshIntakeForCase(): Promise<void> {
    if (!this.selectedCaseId) return;
    try {
      const { extractions } = await this.documentsApi.listIntakeForCase(this.selectedCaseId);
      this.intakeFeatureAvailable = true;
      this.intakeListError = null;
      this.intakeByDocumentId = this.mergeLatestIntake(extractions);
    } catch (e: unknown) {
      const err = e as { status?: number; error?: { error?: string } };
      if (err?.status === 503) {
        this.intakeFeatureAvailable = false;
        this.intakeByDocumentId = new Map();
        this.intakeListError = null;
        return;
      }
      if (err?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
        return;
      }
      this.intakeListError = err?.error?.error ?? 'Failed to load affidavit intake data';
    }
  }

  intakeFor(doc: DocumentListItem): DocumentIntakeExtraction | undefined {
    return this.intakeByDocumentId.get(doc.id);
  }

  get intakeDetailExtraction(): DocumentIntakeExtraction | null {
    if (!this.intakeDetailDoc) return null;
    return this.intakeFor(this.intakeDetailDoc) ?? null;
  }

  get intakeDetailSummary(): string | null {
    const e = this.intakeDetailExtraction;
    if (!e) return null;
    return this.intakeSummaryLine(e);
  }

  openIntakeDetail(doc: DocumentListItem): void {
    this.intakeApplyError = null;
    this.intakeApplySuccessMessage = null;
    this.clearIntakeApplySuccessTimer();
    this.intakeDetailDoc = doc;
    this.intakeDetailOpen = true;
  }

  closeIntakeDetail(): void {
    this.clearIntakeApplySuccessTimer();
    this.intakeApplySuccessMessage = null;
    this.intakeApplyError = null;
    this.intakeDetailOpen = false;
    this.intakeDetailDoc = null;
  }

  intakeLinkLabel(doc: DocumentListItem): string {
    const e = this.intakeFor(doc);
    if (!e) return 'Not analyzed';
    return this.intakeStatusLabel(e.status);
  }

  async onIntakeDetailReAnalyze(): Promise<void> {
    const doc = this.intakeDetailDoc;
    if (!doc || !this.intakeFeatureAvailable) return;
    await this.runIntakeAnalyze(doc);
  }

  async onIntakeDetailReject(): Promise<void> {
    const doc = this.intakeDetailDoc;
    if (!doc || !this.intakeFeatureAvailable) return;
    await this.rejectIntake(doc);
    this.closeIntakeDetail();
  }

  async onIntakeDetailApply(): Promise<void> {
    const doc = this.intakeDetailDoc;
    if (!doc || !this.selectedCaseId || !this.intakeFeatureAvailable) return;
    this.intakeApplyError = null;
    this.intakeApplySuccessMessage = null;
    this.clearIntakeApplySuccessTimer();
    this.intakeApplyBusy = true;
    try {
      const result = await this.documentsApi.applyIntake(this.selectedCaseId, doc.id);
      await this.refreshIntakeForCase();
      const label = this.affidavitCollectionLabel(result.affidavitCollection);
      const actionWord = result.applyAction === 'update' ? 'Updated' : 'Saved';
      this.intakeApplySuccessMessage = `${actionWord} to ${label}. You can review or edit on the affidavit.`;
      this.intakeApplySuccessTimer = setTimeout(() => {
        this.intakeApplySuccessTimer = null;
        this.intakeApplySuccessMessage = null;
        this.closeIntakeDetail();
      }, INTAKE_APPLY_SUCCESS_DISMISS_MS);
    } catch (e: unknown) {
      const err = e as { status?: number; error?: { error?: string } };
      if (err?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
        return;
      }
      this.intakeApplyError = err?.error?.error ?? 'Apply failed';
    } finally {
      this.intakeApplyBusy = false;
    }
  }

  private affidavitCollectionLabel(collection: string): string {
    switch (collection) {
      case 'employment':
        return 'employment';
      case 'liabilities':
        return 'liabilities';
      case 'monthlyhouseholdexpense':
        return 'monthly household expenses';
      default:
        return collection;
    }
  }

  intakeStatusLabel(status: string): string {
    switch (status) {
      case 'processing':
        return 'Analyzing…';
      case 'pending_review':
        return 'Ready for review';
      case 'failed':
        return 'Intake failed';
      case 'rejected':
        return 'Rejected';
      case 'applied':
        return 'Applied';
      default:
        return status;
    }
  }

  intakeTypeShort(docType: string): string {
    switch (docType) {
      case 'w2':
        return 'W-2';
      case 'mortgage_statement':
        return 'Mortgage';
      case 'utility_electric':
        return 'Electric';
      case 'credit_card_mastercard':
        return 'Card stmt.';
      case 'unknown':
        return 'Unknown';
      default:
        return docType;
    }
  }

  intakeSummaryLine(e: DocumentIntakeExtraction): string {
    const p = e.rawPayload;
    const classified = (p['classifiedType'] as string) || e.documentType;
    const parts: string[] = [this.intakeTypeShort(classified)];
    if (classified === 'w2' && p['box1WagesTipsOther'] != null) {
      parts.push(`Box 1: $${p['box1WagesTipsOther']}`);
    }
    if (classified === 'mortgage_statement' && p['principalBalance'] != null) {
      parts.push(`Balance: $${p['principalBalance']}`);
    }
    if (classified === 'utility_electric' && p['amountDue'] != null) {
      parts.push(`Due: $${p['amountDue']}`);
    }
    if (classified === 'credit_card_mastercard' && p['statementBalance'] != null) {
      parts.push(`Balance: $${p['statementBalance']}`);
    }
    return parts.join(' · ');
  }

  async runIntakeAnalyze(doc: DocumentListItem): Promise<void> {
    if (!this.selectedCaseId || !this.intakeFeatureAvailable) return;
    this.intakeAnalyzeBusy[doc.id] = true;
    try {
      await this.documentsApi.analyzeIntake(this.selectedCaseId, doc.id);
      await this.refreshIntakeForCase();
      this.startPolling();
    } catch (e: unknown) {
      const err = e as { status?: number; error?: { error?: string } };
      if (err?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
        return;
      }
      alert(err?.error?.error ?? 'Intake analysis could not be started');
    } finally {
      this.intakeAnalyzeBusy[doc.id] = false;
    }
  }

  async rejectIntake(doc: DocumentListItem): Promise<void> {
    if (!this.selectedCaseId || !this.intakeFeatureAvailable) return;
    this.intakeRejectBusy[doc.id] = true;
    try {
      await this.documentsApi.rejectIntake(this.selectedCaseId, doc.id);
      await this.refreshIntakeForCase();
    } catch (e: unknown) {
      const err = e as { error?: { error?: string } };
      alert(err?.error?.error ?? 'Reject failed');
    } finally {
      this.intakeRejectBusy[doc.id] = false;
    }
  }

  canStartIntakeAnalyze(doc: DocumentListItem): boolean {
    const e = this.intakeFor(doc);
    if (!e) return true;
    return e.status !== 'processing';
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
