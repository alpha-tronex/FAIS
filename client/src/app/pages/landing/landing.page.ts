import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { map, Observable } from 'rxjs';
import { DEFAULT_LAYOUT_VERSION } from '../../core/layout-version.config';

type NavItem = { label: string; fragment: string };
type Card = { title: string; copy: string };
type Metric = { value: string; label: string };
type ComparisonRow = { label: string; fais: string; competitor: string };
type PricingPlan = {
  name: string;
  badge: string;
  price: string;
  copy: string;
  items: string[];
  featured?: boolean;
};
type FaqItem = { question: string; answer: string };

@Component({
  standalone: false,
  selector: 'app-landing-page',
  templateUrl: './landing.page.html',
  styleUrl: './landing.page.css'
})
export class LandingPage {
  /** Layout version from query param v=1, v=2, v=3...; falls back to DEFAULT_LAYOUT_VERSION. */
  readonly layoutVersion$: Observable<number>;

  constructor(private readonly route: ActivatedRoute) {
    this.layoutVersion$ = this.route.queryParamMap.pipe(
      map((q) => {
        const v = q.get('v');
        const n = v ? +v : DEFAULT_LAYOUT_VERSION;
        return Number.isFinite(n) && n >= 1 ? n : DEFAULT_LAYOUT_VERSION;
      })
    );
  }

  readonly navItems: NavItem[] = [
    { label: 'Product', fragment: 'product' },
    { label: 'Workflow', fragment: 'workflow' },
    { label: 'Compare', fragment: 'compare' },
    { label: 'Pricing', fragment: 'pricing' },
    { label: 'FAQ', fragment: 'faq' }
  ];

  readonly heroPoints = [
    'Flat monthly pricing for the whole firm',
    'Unlimited staff access on standard plans',
    'Built for Florida affidavit-heavy family-law matters'
  ];

  readonly heroMetrics: Metric[] = [
    { value: '$399', label: 'starting monthly price' },
    { value: 'Unlimited', label: 'staff and client users on standard plans' },
    { value: 'Florida', label: 'family-law positioning from day one' }
  ];

  readonly proofPoints: Card[] = [
    {
      title: 'Affidavit workflow',
      copy:
        'Collect income, expenses, assets, and liabilities in one place and generate court-ready affidavit output faster.'
    },
    {
      title: 'Client coordination',
      copy:
        'Give case participants a secure place to log in, update information, and complete work without endless follow-up.'
    },
    {
      title: 'Staff efficiency',
      copy:
        'Keep messaging, appointments, reminders, and case-linked documents together so attorneys and assistants stay aligned.'
    }
  ];

  readonly productFeatures: Card[] = [
    {
      title: 'Case-linked client portal',
      copy:
        'Petitioners, respondents, attorneys, assistants, and administrators get role-based access tied to the right matter.'
    },
    {
      title: 'Financial affidavit completion',
      copy:
        'Guide clients through income, expenses, assets, liabilities, and employment details without fragmented forms.'
    },
    {
      title: 'Documents and messaging',
      copy:
        'Keep communication and document exchange attached to the case instead of spread across inboxes and shared drives.'
    },
    {
      title: 'Scheduling and reminders',
      copy:
        'Coordinate appointments, send reminders, and reduce the manual calendar work that falls on staff.'
    },
    {
      title: 'Admin controls',
      copy:
        'Allow staff to manage users, cases, and affidavits on behalf of clients when a matter needs intervention.'
    },
    {
      title: 'AI-assisted workflows',
      copy:
        'Support prompt-based scheduling and document Q&A where it saves staff time instead of adding generic AI clutter.'
    }
  ];

  readonly workflowSteps: Card[] = [
    {
      title: 'Open the matter',
      copy:
        'Create the case, assign the right attorney or assistant, and give the client a secure place to log in.'
    },
    {
      title: 'Collect client data',
      copy:
        'Gather profile details, financial information, and supporting documents without repeated email chasing.'
    },
    {
      title: 'Coordinate the team',
      copy:
        'Use shared messaging, role-aware access, and appointments to keep the attorney, assistant, and client on the same page.'
    },
    {
      title: 'Produce the affidavit',
      copy:
        'Turn submitted financial data into standardized affidavit output that is easier for staff to review and finalize.'
    }
  ];

  readonly comparisonRows: ComparisonRow[] = [
    {
      label: 'Pricing model',
      fais: 'One monthly fee for the firm',
      competitor: 'Per-user pricing increases as you add staff'
    },
    {
      label: 'Family-law fit',
      fais: 'Positioned around Florida family-law workflow and affidavit-heavy matters',
      competitor: 'Built for general legal practice management across many matter types'
    },
    {
      label: 'Staff collaboration economics',
      fais: 'Add attorneys, assistants, and support staff without seat creep on standard plans',
      competitor: 'Each added internal user can increase cost'
    },
    {
      label: 'Sales story',
      fais: 'Workflow depth plus predictable economics for small firms',
      competitor: 'Broader feature set but more generic positioning and pricing'
    }
  ];

  readonly pricingPlans: PricingPlan[] = [
    {
      name: 'Launch',
      badge: 'Best for solo and very small firms',
      price: '$399/month',
      copy:
        'A flat-fee plan for firms that need a tighter client and affidavit workflow without per-seat pricing.',
      items: [
        'Core case workflow',
        'Unlimited internal users for standard small-firm usage',
        'Unlimited client portal users',
        'Affidavits, messaging, scheduling, and documents'
      ]
    },
    {
      name: 'Growth',
      badge: 'Best for heavier staff collaboration',
      price: '$699/month',
      copy:
        'For firms handling more matters, more staff coordination, and stronger onboarding or support needs.',
      items: [
        'Everything in Launch',
        'Priority support',
        'Advanced workflow setup',
        'Better fit for higher-volume family-law operations'
      ],
      featured: true
    },
    {
      name: 'Pilot',
      badge: 'Low-risk way to evaluate fit',
      price: '$500-$1,500 one time',
      copy:
        'A 30-day guided pilot with setup and training. Pilot fees can be credited toward the first paid term.',
      items: [
        'Guided onboarding',
        'Workflow setup assistance',
        'Live training sessions',
        'Conversion credit toward subscription'
      ]
    }
  ];

  readonly addons: Card[] = [
    {
      title: 'AI package',
      copy: '$99-$199/month for document Q&A and prompt-based workflow features.'
    },
    {
      title: 'White-glove onboarding',
      copy: '$1,000-$3,000 one time for migration help, setup, and launch support.'
    },
    {
      title: 'Custom branding or enterprise setup',
      copy: 'Quoted separately for larger firms, multi-office groups, or specialized requirements.'
    }
  ];

  readonly buyerProfiles: Card[] = [
    {
      title: 'Managing attorney or firm owner',
      copy:
        'Cares about predictable software cost, cleaner operations, and a stronger client experience without a seat-based bill.'
    },
    {
      title: 'Legal assistant or paralegal',
      copy:
        'Feels the pain of affidavit follow-up, document collection, scheduling, and fragmented communication first.'
    },
    {
      title: 'Small Florida family-law team',
      copy:
        'Best fit for firms with 1-10 attorneys handling divorce, support, paternity, mediation, and repeated affidavit work.'
    }
  ];

  readonly objections: FaqItem[] = [
    {
      question: 'Does FAIS replace every feature in a generic platform like MyCase?',
      answer:
        'The selling point is not generic breadth. FAIS is positioned to solve the family-law workflow problems small Florida firms actually feel, especially around affidavits, client coordination, and staff collaboration.'
    },
    {
      question: 'Why not charge per user like everyone else?',
      answer:
        'Because family-law matters often involve attorneys, assistants, and support staff on the same case. Flat-fee pricing keeps costs predictable as the firm adds internal users.'
    },
    {
      question: 'What happens if the firm is larger than a typical small-firm deployment?',
      answer:
        'Standard plans are for normal small-firm usage. Larger firms, multi-office groups, or unusually heavy support needs move to custom pricing.'
    }
  ];
}
