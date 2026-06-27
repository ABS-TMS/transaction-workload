exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key not configured — check Netlify environment variables" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body — could not parse JSON" }) };
  }

  const { pdfBase64 } = body;
  if (!pdfBase64) {
    return { statusCode: 400, body: JSON.stringify({ error: "No PDF data received" }) };
  }

  const SYSTEM_PROMPT = `You are a Texas real estate contract data extractor. You will be given the text of an executed TREC One to Four Family Residential Contract (Resale) -- either the 20-18 form (used through June 2026) or the 20-19 form (mandatory starting July 1, 2026). Detect which version it is from the form number printed in the footer of each page, and extract fields accordingly, accounting for differences between the two versions:
- 20-19 reorganized broker compensation into paragraph 12/12B (this was paragraph 12 in 20-18, worded differently)
- 20-19 added a new water rights disclosure at paragraph 7(I), not present in 20-18
- 20-19 renamed "Federal Tax Requirements" to "Federal Requirements" at paragraph 19
- The option period and earnest money provisions sit at paragraph 5 in both versions, with minor wording changes in 20-19 (e.g. explicit Legal Holiday handling) -- extract the same underlying dates/amounts regardless of exact wording.

Extract the following fields and return ONLY a valid JSON object with no preamble, no markdown, no explanation. If a field is not found or not applicable, use null.

Return this exact JSON structure:
{
  "contract_form_version": "20-18 or 20-19, based on the form number you detected",
  "buyer_names": "full names of all buyers",
  "seller_names": "full names of all sellers",
  "property_address": "full property address including city and state",
  "sales_price": "formatted dollar amount",
  "effective_date": "MM/DD/YYYY",
  "closing_date": "MM/DD/YYYY",
  "option_period_days": 10,
  "option_fee": "formatted dollar amount or null",
  "option_expiry_date": "MM/DD/YYYY calculated from effective date + option days or null",
  "earnest_money": "formatted dollar amount",
  "earnest_money_deadline": "MM/DD/YYYY",
  "earnest_money_holder": "name of title company or escrow holder",
  "finance_contingency_date": "MM/DD/YYYY or null",
  "title_company": "name of title company",
  "hoa_applicable": false,
  "listing_agent": "listing agent name or null",
  "buyers_agent": "buyer agent name or null"
}

Rules: Return ONLY the JSON object. Ignore DocuSign or Authentisign certificate pages at the end. All dates in MM/DD/YYYY format. Calculate option_expiry_date by adding option_period_days to effective_date.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfBase64 }
            },
            { type: "text", text: "Extract all fields from this executed TREC contract (detect whether it is the 20-18 or 20-19 form) and return the JSON object only." }
          ]
        }]
      })
    });

    const resultText = await response.text();

    if (!response.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Anthropic API error: " + response.status + " — " + resultText.slice(0, 300) })
      };
    }

    const result = JSON.parse(resultText);
    const raw = result.content.map(b => b.text || "").join("");
    const clean = raw.replace(/```json|```/g, "").trim();
    const data = JSON.parse(clean);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Function error: " + err.message })
    };
  }
};
