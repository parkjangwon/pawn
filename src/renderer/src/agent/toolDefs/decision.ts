import type { ToolDefinition } from '../toolDefinitionsTypes'

/**
 * Decision-model tool. Only exposed while a decision provider is active
 * (Settings → Decision models), so its guidance rides with the tool and the
 * system prompt stays cache-stable.
 */
export const DECISION_TOOLS: ToolDefinition[] = [
  {
    name: 'decide',
    description:
      'Ask the configured decision model (TypeSafe Jev or a local Ollaya model) typed questions about text or JSON. ' +
      'It never writes text: it returns a choice, a score or a yes/no probability, calibrated, in well under a second, ' +
      'far cheaper than reasoning it out yourself. ' +
      'Use it for bounded judgments, especially over many inputs: triage or classify items (log lines, issues, files, search hits), ' +
      'rank or filter candidates, check whether a passage supports a claim, rate severity, or pick one option from a known list. ' +
      'Batch every question about one input into one call; pass `items` to judge many inputs with the same questions. ' +
      'Include an "other" or "unsure" option when the list may not cover every case, and treat low probability or confidence (< 0.6) as "not sure". ' +
      'Do not use it for arithmetic, counting, exact string work, extracting unknown values, or multi-step reasoning; ' +
      'do those in code or yourself. Answers are schema-valid but can still be wrong: verify before acting on anything irreversible. ' +
      'Send only what the decision needs (secrets are redacted; hosted providers receive the text).',
    parameters: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          description: 'The input to judge. For structured data pass JSON text (an object or array); it is sent as JSON.'
        },
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'Several independent inputs judged with the same questions (max 50). Use instead of state.'
        },
        questions: {
          type: 'array',
          description: 'One to 32 questions, all answered in the same call.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Short descriptive key, e.g. is_flaky or severity (letters, digits, _)' },
              type: {
                type: 'string',
                description: 'choice (pick one option) | score (ordered levels, low→high) | yes_no (probability it is true)'
              },
              question: {
                type: 'string',
                description: 'The question. Refer to JSON fields of the state in backticks, e.g. "Does `diff` change public APIs?"'
              },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: 'choice: 2–255 option labels. score: 2–10 level descriptions from lowest to highest.'
              },
              option_descriptions: {
                type: 'object',
                description: 'choice only: optional label → rubric text for what each option means.'
              }
            },
            required: ['id', 'type', 'question']
          }
        }
      },
      required: ['questions']
    }
  }
]
