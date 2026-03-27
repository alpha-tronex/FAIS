# Document intake sample PDFs (local fixtures)

This folder holds **local-only** PDFs used for Phase 0–1 work on document classification and extraction (financial affidavit intake). **PDF files here are not committed** (see repo root `.gitignore`).

## Layout and expected document types

| Path | Expected use | v1 milestone |
|------|----------------|--------------|
| `income/W2/` | IRS-style W-2 forms | Yes — employment / wages |
| `income/pay stubs/` | Pay stubs | Supplement (e.g. pay frequency); not core v1 |
| `mortgage/` | Mortgage / loan statements | Yes — liabilities (and optional PITI rules later) |
| `utilities/electricity/` | Electric utility bills | Yes — monthly household expense |
| `utilities/water/` | Water bills | **Classifier negative** / non–v1 electric (still useful for “utility vs not”) |
| `liabilities/mastercard/` | Card statements commonly on Mastercard network | Yes — liabilities (statement balance) |
| `liabilities/*.pdf` (root) | Amex, Discover, Apple Card, etc. | **Contrast set** — not in the `mastercard/` training bucket |
| `assets/` | Bank / brokerage statements | Out of v1 scope; optional confusion testing or later features |

## Adding files

1. Place PDFs in the folder that matches the **expected** document class (for honest tests).
2. Prefer **redacted** or **synthetic** samples for anything you might screen-share.
3. Do not rely on this folder existing in fresh clones—each developer or CI job that needs fixtures must copy PDFs here locally.

## Licensing and demos

Many samples come from templates or document libraries (e.g. Scribd) and may be **copyrighted**. Use them only under terms that allow your use. **Do not** use real client statements in public demos, recordings, or shared environments.

## Related docs

- Milestones: `docs/milestones-document-intake-affidavit.md`
- Architecture: `docs/architecture-document-intake-affidavit.md`
