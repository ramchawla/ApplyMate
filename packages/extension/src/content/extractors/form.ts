import { FormField } from "../../../../../lib/shared/types";
import { FIELD_TYPE_KEYWORDS } from "../../../../../lib/shared/constants";

export function extractFormFields(html: string): FormField[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const fields: FormField[] = [];
  const elements = doc.querySelectorAll("input, textarea, select");

  elements.forEach((element, index) => {
    const el = element as HTMLElement;
    // Skip hidden and submit/button inputs
    const inputType = el.getAttribute("type")?.toLowerCase();
    if (inputType && ["hidden", "submit", "button", "reset"].includes(inputType)) {
      return;
    }
    fields.push(parseFormField(el, doc, index));
  });

  return fields;
}

function parseFormField(
  element: HTMLElement,
  doc: Document,
  index: number,
): FormField {
  const tagName = element.tagName.toLowerCase();
  const id =
    element.getAttribute("id") ||
    element.getAttribute("name") ||
    `field-${index}`;
  const label = extractLabel(element, doc);
  const placeholder = element.getAttribute("placeholder") || "";
  const required = element.hasAttribute("required");

  let type: FormField["type"] = "text";
  if (tagName === "textarea") type = "textarea";
  else if (tagName === "select") type = "select";
  else {
    const htmlType = element.getAttribute("type")?.toLowerCase();
    if (
      htmlType &&
      ["email", "tel", "file", "checkbox", "radio"].includes(htmlType)
    ) {
      type = htmlType as FormField["type"];
    }
  }

  const { valueType, confidence } = inferFieldType(label, placeholder, type);

  return {
    id,
    label,
    type,
    placeholder,
    required,
    extractedValueType: valueType,
    matchConfidence: confidence,
    validated: false,
  };
}

function extractLabel(element: HTMLElement, doc: Document): string {
  const id = element.getAttribute("id");
  if (id) {
    const label = doc.querySelector(`label[for="${id}"]`);
    if (label && label.textContent) return label.textContent.trim();
  }

  const parentLabel = element.closest("label");
  if (parentLabel && parentLabel.textContent) {
    return parentLabel.textContent.trim();
  }

  return (
    element.getAttribute("placeholder") ||
    element.getAttribute("name") ||
    "Field"
  );
}

function inferFieldType(
  label: string,
  placeholder: string,
  htmlType: FormField["type"],
): { valueType: FormField["extractedValueType"]; confidence: number } {
  const combinedText = `${label} ${placeholder}`.toLowerCase();

  for (const [valueType, keywords] of Object.entries(FIELD_TYPE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (combinedText.includes(keyword)) {
        let confidence = 0.75;
        if (htmlType === "file" && valueType === "resume") confidence = 0.9;
        if (htmlType === "email" && valueType === "email") confidence = 0.95;
        if (htmlType === "tel" && valueType === "phone") confidence = 0.9;
        return {
          valueType: valueType as FormField["extractedValueType"],
          confidence: Math.min(confidence, 1.0),
        };
      }
    }
  }

  // HTML type hints when no keyword matched
  if (htmlType === "email") return { valueType: "email", confidence: 0.85 };
  if (htmlType === "tel") return { valueType: "phone", confidence: 0.85 };
  if (htmlType === "file") return { valueType: "resume", confidence: 0.7 };

  return { valueType: null, confidence: 0 };
}
