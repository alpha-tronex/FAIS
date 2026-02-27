import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Reusable confirm dialog. Control visibility with [open], handle [confirm] and [cancel].
 * Optionally set [dismissText] to show a third button that closes without confirming or cancelling; (dismiss) is also emitted on backdrop click when dismissText is set.
 * Example:
 *   <app-confirm-popup
 *     [open]="showConfirm"
 *     title="Delete item"
 *     message="This cannot be undone."
 *     confirmText="Delete"
 *     [danger]="true"
 *     (confirm)="doDelete(); showConfirm = false"
 *     (cancel)="showConfirm = false"
 *   />
 */
@Component({
  standalone: false,
  selector: 'app-confirm-popup',
  templateUrl: './confirm-popup.component.html',
  styleUrl: './confirm-popup.component.css'
})
export class ConfirmPopupComponent {
  @Input() title = 'Confirm';
  @Input() message = 'Are you sure?';
  @Input() confirmText = 'Confirm';
  @Input() cancelText = 'Cancel';
  /** Optional third button that closes the dialog without confirming or cancelling (e.g. "Close" when user changes mind). */
  @Input() dismissText: string | null = null;
  /** When true, styles the confirm button as a destructive action (e.g. delete). */
  @Input() danger = false;
  @Input() open = false;

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
  @Output() dismiss = new EventEmitter<void>();

  onConfirm(): void {
    this.confirm.emit();
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onDismiss(): void {
    this.dismiss.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).hasAttribute('data-confirm-backdrop')) {
      this.dismissText != null ? this.dismiss.emit() : this.cancel.emit();
    }
  }
}
