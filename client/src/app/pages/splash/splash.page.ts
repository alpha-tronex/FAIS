import { Component } from '@angular/core';

type Feature = { title: string; copy: string };
type FaqItem = { question: string; answer: string };
type Step = { title: string; copy: string };

@Component({
  standalone: false,
  selector: 'app-splash-page',
  templateUrl: './splash.page.html',
  styleUrl: './splash.page.css'
})
export class SplashPage {
  readonly problemBullets = [
    'The same documents get typed twice—into spreadsheets, then into court PDFs.',
    'Small errors surface at filing time, when fixes are most expensive.',
    'Paralegal time goes to mechanical work instead of strategy and client care.'
  ];

  readonly steps: Step[] = [
    {
      title: 'Upload',
      copy:
        'Staff or the petitioner uploads PDFs tied to the case: pay documents, statements, bills—what the matter already has.'
    },
    {
      title: 'Extract and map',
      copy:
        'Purpose-built handling for scans and messy layouts. Data is structured for affidavit sections—employment, liabilities, household expenses—as you wire them.'
    },
    {
      title: 'Review and print',
      copy:
        'Your team confirms or edits proposed fields, then generates the official financial affidavit output your process uses.'
    }
  ];

  readonly features: Feature[] = [
    {
      title: 'Document-first intake',
      copy: 'Stop starting at blank forms. Start from what the client already provided.'
    },
    {
      title: 'Built for real PDFs',
      copy: 'Scans and odd layouts are normal—not edge cases. Extraction is designed for messy inputs.'
    },
    {
      title: 'Review before filing',
      copy: 'Automation suggests; your team decides. Sensitive fields stay visible before commit or print.'
    },
    {
      title: 'Affidavit-native workflow',
      copy: 'Not generic document AI—mapped to the financial affidavit journey FAIS already runs.'
    }
  ];

  readonly proofRows: { claim: string; notes: string }[] = [
    {
      claim: 'Affidavit workflow, not just templates',
      notes: 'End-to-end path from case documents to the sections that feed the affidavit.'
    },
    {
      claim: 'Paralegal-in-the-loop by design',
      notes: 'Confidence and review are first-class, not an afterthought.'
    },
    {
      claim: 'Built for family law operations',
      notes: 'Language and flows match how small and mid-size firms actually work.'
    }
  ];

  readonly audienceBullets = [
    'Family law firms with paralegals and clerks handling heavy intake.',
    'Practices that want speed without sacrificing accuracy at filing.',
    'Firms ready to standardize intake without a generic enterprise stack they never finish implementing.'
  ];

  readonly faq: FaqItem[] = [
    {
      question: 'Is this fully automatic with no human review?',
      answer:
        'No—and that is intentional. The product is built so staff can verify extracted data before print or filing. Automation handles the tedious part; your team owns the decision.'
    },
    {
      question: 'What documents work best?',
      answer:
        'Pay-related documents (for example W-2s), debt and card statements, mortgage and utility bills—depending on what you enable. Clearer scans and consistent uploads improve results.'
    },
    {
      question: 'Does this replace our paralegals?',
      answer:
        'It replaces repetitive retyping. Your team spends time on exceptions, client communication, and case strategy.'
    },
    {
      question: 'Is this only Florida?',
      answer:
        'FAIS leads with Florida financial affidavit workflows. Other jurisdictions follow as field mappings are productized.'
    },
    {
      question: 'How do you handle security?',
      answer:
        'Configure encryption, access control, retention, and hosting to match your firm’s requirements—document the posture you actually deploy.'
    }
  ];
}
