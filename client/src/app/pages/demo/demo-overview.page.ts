import { Component } from '@angular/core';

type ChecklistItem = { title: string; copy: string };

@Component({
  standalone: false,
  selector: 'app-demo-overview-page',
  templateUrl: './demo-overview.page.html',
  styleUrl: './demo-overview.page.css'
})
export class DemoOverviewPage {
  imgError: Record<number, boolean> = {};
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
}
