/** Light theme CSS override block for the KOTA web UI. */

export const STYLES_THEME_CSS = `
body.light {
  --bg: #f0f0f8;
  --bg-secondary: #e4e4f0;
  --bg-chat: #f8f8fc;
  --text: #1a1a2e;
  --text-muted: #555577;
  --accent: #5a52d5;
  --accent-hover: #4840b8;
  --user-bg: #ddddf0;
  --assistant-bg: #ebebf8;
  --border: #c8c8e0;
  --input-bg: #ebebf8;
}

body.light #theme-toggle { color: var(--text-muted); }
`;
