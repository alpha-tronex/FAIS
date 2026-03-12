import { Component } from '@angular/core';
import { DemoContactService, type DemoRequestPayload } from '../../services/demo-contact.service';

@Component({
  standalone: false,
  selector: 'app-demo-request-page',
  templateUrl: './demo-request.page.html',
  styleUrl: './demo-request.page.css'
})
export class DemoRequestPage {
  fullName = '';
  firmName = '';
  workEmail = '';
  phone = '';
  firmSize = '';
  monthlyAffidavits = '';
  currentSoftware = '';
  biggestPain = '';
  details = '';

  busy = false;
  submitted = false;
  error: string | null = null;
  introImgError = false;

  readonly firmSizeOptions = [
    'Solo attorney',
    '2-3 attorneys',
    '4-10 attorneys',
    '11+ attorneys'
  ];

  readonly affidavitVolumeOptions = [
    '1-5 per month',
    '6-15 per month',
    '16-30 per month',
    '30+ per month'
  ];

  constructor(private readonly demoContact: DemoContactService) {}

  async onSubmit() {
    this.busy = true;
    this.error = null;
    try {
      const payload: DemoRequestPayload = {
        fullName: this.fullName.trim(),
        firmName: this.firmName.trim(),
        workEmail: this.workEmail.trim(),
        phone: this.phone.trim() || undefined,
        firmSize: this.firmSize.trim(),
        monthlyAffidavits: this.monthlyAffidavits.trim(),
        currentSoftware: this.currentSoftware.trim() || undefined,
        biggestPain: this.biggestPain.trim(),
        details: this.details.trim() || undefined
      };
      await this.demoContact.submit(payload);
      this.submitted = true;
    } catch (e: any) {
      this.error = e?.error?.error ?? 'Failed to send request';
    } finally {
      this.busy = false;
    }
  }
}
