import { Component } from '@angular/core';
import { DemoContactService, type DemoRequestPayload } from '../../services/demo-contact.service';

type ChecklistItem = { title: string; copy: string };

@Component({
  standalone: false,
  selector: 'app-demo-page',
  templateUrl: './demo.page.html',
  styleUrl: './demo.page.css'
})
export class DemoPage {
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

  readonly demoChecklist: ChecklistItem[] = [
    {
      title: 'Workflow walkthrough',
      copy: 'See one family-law matter move from intake to affidavit completion, documents, and scheduling.'
    },
    {
      title: 'Pricing fit',
      copy: 'Review whether flat monthly pricing fits your staff count, case volume, and growth plans.'
    },
    {
      title: 'Implementation path',
      copy: 'Discuss pilot scope, onboarding support, and what would be needed to launch in your firm.'
    }
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
