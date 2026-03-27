import type { PDFFont } from 'pdf-lib';

function byWidgetX(a: any, b: any): number {
  const ax = Number(a?.getRectangle?.()?.x ?? 0);
  const bx = Number(b?.getRectangle?.()?.x ?? 0);
  return ax - bx;
}

/**
 * Applies different rendered text to each widget of one text field.
 * This is needed when one Acro field name is reused for petitioner/respondent cells.
 */
export function setTextByWidgetIndex(
  form: { getTextField: (name: string) => any },
  fieldName: string,
  values: string[],
  font: PDFFont
): void {
  try {
    const field: any = form.getTextField(fieldName);
    const widgets = [...(field?.acroField?.getWidgets?.() ?? [])].sort(byWidgetX);
    if (widgets.length === 0) return;
    for (let i = 0; i < widgets.length; i += 1) {
      const text = values[i] ?? values[values.length - 1] ?? '';
      field.setText(text);
      if (typeof field.updateWidgetAppearance === 'function') {
        field.updateWidgetAppearance(widgets[i], font);
      } else if (typeof field.updateAppearances === 'function') {
        field.updateAppearances(font);
      }
    }
  } catch {
    // Ignore missing/unsupported fields for template compatibility.
  }
}
