/**
 * Prompt for structuring raw job-posting text into the StructuredJd shape.
 * JD analysis/extraction is an explicitly permitted use of the AI layer
 * (PRD §10.3). The instruction forbids inventing fields not present in the
 * source — an empty array/null is correct when the posting omits something.
 */
export function buildJdExtractionPrompt(rawText: string): string {
  return [
    "Extract a structured job description from the raw posting text below.",
    "",
    "Rules:",
    "- Use ONLY information present in the text. Do not invent or infer requirements, skills, or details that are not stated.",
    "- Use null for an absent title/company/location; use an empty array for a section the posting does not contain.",
    "- `keywords`: salient ATS keywords/technologies actually present in the text.",
    "- `questions`: any explicit application/screening questions the posting asks the candidate to answer.",
    "- `formFields`: labels of any application form fields mentioned (e.g. 'LinkedIn URL', 'Years of experience'), if stated.",
    "- `extractionConfidence`: your 0–1 confidence that the structured result faithfully represents the posting. Use a low value when the text looks truncated, JS-rendered, or unrelated to a job posting.",
    "",
    "Return only the JSON object conforming to the provided schema.",
    "",
    "--- RAW JOB POSTING TEXT ---",
    rawText,
    "--- END ---",
  ].join("\n");
}
