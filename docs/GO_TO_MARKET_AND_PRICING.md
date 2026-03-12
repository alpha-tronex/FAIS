# FAIS Go-To-Market and Pricing Playbook

## Positioning

- Category: family-law operations platform for Florida firms
- Core message: FAIS combines workflow depth for affidavit-heavy matters with flat monthly firm pricing
- Primary wedge against MyCase-style platforms:
  - FAIS is specialized for Florida family-law workflow
  - FAIS does not charge per internal user on standard plans

## Ideal Customer Profile

- Small Florida family-law firms with 1-10 attorneys
- Matters involving divorce, support, paternity, mediation, and recurring financial affidavits
- Teams where multiple staff members touch the same case
- Buyers:
  - managing attorney
  - firm owner
- Internal champions:
  - legal assistant
  - paralegal
  - office manager

## Packaging and Pricing

- `Launch`: `$399/month`
  - best for solo and very small firms
  - includes core case workflow, client portal, affidavits, messaging, scheduling, and documents
- `Growth`: `$699/month`
  - best for firms with heavier staff collaboration or higher case volume
  - includes everything in Launch plus priority support and advanced workflow setup
- `Pilot`: `$500-$1,500 one time`
  - 30-day guided pilot
  - can be credited toward first paid term
- Add-ons:
  - AI package: `$99-$199/month`
  - white-glove onboarding or migration: `$1,000-$3,000 one time`
  - custom branding or enterprise setup: custom quote

## Commercial Guardrails

- Standard plans assume small-firm usage
- Standard plans include unlimited internal users and unlimited client portal users
- Move to custom pricing if any of the following are true:
  - firm is larger than the defined small-firm band
  - firm has multiple offices
  - unusually high support or onboarding burden is expected
  - custom controls or branding materially expand scope

## Demo Narrative

Use one realistic family-law matter and walk through the following path:

1. Open the case and assign the right staff
2. Invite the client into the portal
3. Collect profile, financial, and supporting document information
4. Coordinate messages and appointments around the matter
5. Complete and review the financial affidavit workflow
6. Reinforce the pricing model: one monthly fee for the firm, not per-seat software

## Discovery Qualification

Ask enough to learn:

- How many internal staff touch a typical family-law case?
- How often do you prepare or update financial affidavits?
- What tools are you using today for case tracking, intake, scheduling, and client communication?
- Where do you lose the most time: client follow-up, documents, affidavit prep, or coordination?
- Are you frustrated with per-user pricing or tool sprawl?

## Objection Handling

- `Do you replace every MyCase feature?`
  - FAIS is not sold as generic breadth. It is sold as better fit for the family-law workflows your team feels every week.
- `Why flat-fee pricing?`
  - Because small firms often have multiple staff on the same case. FAIS keeps software cost predictable as your team grows.
- `What if we are larger than a normal small-firm deployment?`
  - Standard plans cover small-firm usage. Larger teams move to custom pricing so support and delivery stay aligned.

## Early Pipeline Targets

- Build a list of 100-150 small Florida family-law firms
- Target firms where several staff members work the same matter
- Prioritize founder-led outbound and referral channels before paid acquisition

## Messaging Tests

Test both of these in outreach and on landing pages:

- `Flat-fee legal software for family-law firms`
- `Florida family-law workflow platform`

Also test two value frames:

- cost savings versus per-user systems
- predictable economics as the team grows

## Success Metrics

- discovery-to-demo conversion
- demo-to-pilot conversion
- pilot-to-paid conversion
- reply rate by pricing message
- number of staff at signed firms
- time-to-close for flat-fee deals versus general positioning

## Demo Request Flow

- Public route: `/demo`
- Form submits to: `POST /api/demo-request`
- Submission is emailed to:
  - `DEMO_REQUEST_TO`, or if unset
  - `SALES_CONTACT_EMAIL`, or if unset
  - `SMTP_USER`
- Recommended env setup:
  - set `DEMO_REQUEST_TO` to the inbox that should receive inbound FAIS demo requests
  - keep `SMTP_FROM` branded as `FAIS <address@domain>`
