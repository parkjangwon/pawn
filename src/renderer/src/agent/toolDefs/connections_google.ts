import type { ToolDefinition } from '../toolDefinitionsTypes'

export const GOOGLE_CONNECTION_TOOLS: ToolDefinition[] = [
{
    name: 'google_whoami',
    description: 'Return the connected Google account email/name. Requires Google connection in Settings.',
    parameters: { type: 'object', properties: {} }
  },
{
    name: 'google_drive_search',
    description:
      'Search Google Drive files. query uses Drive query syntax (e.g. "name contains \'report\'" or "mimeType=\'application/vnd.google-apps.spreadsheet\'"). Requires Google connection.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Drive search query' },
        max_results: { type: 'number', description: 'Max files (default 20, max 50)' }
      },
      required: ['query']
    }
  },
{
    name: 'google_drive_read',
    description:
      'Read a Drive file by id. Exports Docs/Sheets/Slides to text/csv when possible. Requires Google connection.',
    parameters: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'Drive file id' },
        max_chars: { type: 'number', description: 'Max characters to return (default 40000)' }
      },
      required: ['file_id']
    }
  },
{
    name: 'google_gmail_search',
    description:
      'Search Gmail (read-only). query uses Gmail search syntax (e.g. "from:alice newer_than:7d", "subject:invoice"). Cannot send mail. Returns message ids + metadata. Requires Google connection.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query' },
        max_results: { type: 'number', description: 'Max messages (default 10, max 30)' }
      },
      required: ['query']
    }
  },
{
    name: 'google_gmail_read',
    description: 'Read a full Gmail message by id (from google_gmail_search). Requires Google connection.',
    parameters: {
      type: 'object',
      properties: { message_id: { type: 'string', description: 'Gmail message id' } },
      required: ['message_id']
    }
  },
{
    name: 'google_calendar_list',
    description:
      'List Google Calendar events. Defaults to primary calendar, from now through +7 days. ISO8601 for time_min/time_max. Requires Google connection.',
    parameters: {
      type: 'object',
      properties: {
        time_min: { type: 'string', description: 'ISO start (optional)' },
        time_max: { type: 'string', description: 'ISO end (optional)' },
        max_results: { type: 'number', description: 'Max events (default 20)' },
        calendar_id: { type: 'string', description: 'Calendar id (default primary)' }
      }
    }
  },
{
    name: 'google_tasks_list',
    description:
      'List Google Task lists, or tasks in a list when task_list_id is set. Requires Google connection.',
    parameters: {
      type: 'object',
      properties: {
        task_list_id: { type: 'string', description: 'Task list id (omit to list lists)' },
        max_results: { type: 'number', description: 'Max tasks (default 30)' }
      }
    }
  },
{
    name: 'google_sheets_read',
    description:
      'Read a Google Sheet. Pass spreadsheet_id (Drive file id). Omit range to list sheet names; pass range like "Sheet1!A1:D50" for values. Requires Google connection.',
    parameters: {
      type: 'object',
      properties: {
        spreadsheet_id: { type: 'string', description: 'Spreadsheet file id' },
        range: { type: 'string', description: 'A1 range (optional)' }
      },
      required: ['spreadsheet_id']
    }
  },
{
    name: 'google_docs_read',
    description: 'Read a Google Doc by document_id (Drive file id) as plain text. Requires Google connection.',
    parameters: {
      type: 'object',
      properties: { document_id: { type: 'string', description: 'Document id' } },
      required: ['document_id']
    }
  },
{
    name: 'google_slides_read',
    description: 'Read a Google Slides presentation by id as text per slide. Requires Google connection.',
    parameters: {
      type: 'object',
      properties: { presentation_id: { type: 'string', description: 'Presentation id' } },
      required: ['presentation_id']
    }
  }
]
