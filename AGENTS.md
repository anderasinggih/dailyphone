# Daily Phone Project Rules

## Language Policy
- All UI text, system labels, table headers, buttons, navigation items, dialogs, alerts, and user-facing communications MUST be in **English**.
- Code identifiers, comments, commit messages, and documentation should be written in **English**.
- When communicating with the user, maintain English responses as the primary language unless the user asks in another language.

## Design Language
- Follow Apple's Human Interface Guidelines (HIG):
  - Clean typography scale (Helvetica / iOS SF style).
  - High legibility, purposeful layout, and generous whitespace.
  - Subtle borders (`border-border/60`), cards (`apple-card`), and liquid glass navigation (`backdrop-blur-2xl`).
  - Native iOS feel for mobile navigation and desktop macOS feel for top bars and panels.
- **Color Palette & Visual Restraint**:
  - Predominantly **Apple Blue** (`#007AFF` / `oklch(0.588 0.2 259)`) as the primary brand and interactive accent color.
  - Maintain a clean, minimalist, mostly monochromatic base (Apple light `#F5F5F7` / dark `#000000` & `#1C1C1E`).
  - Avoid excessive multi-color accents (yellows, purples, oranges, pinks). Only use subtle red/green for critical state signals (errors/active status).
  - Keep interfaces as simple, calm, and uncluttered as possible.
- Do not introduce unnecessary or dead code; keep dependencies and bundle size minimal.

## Tooling & Execution Rules

### Context7 Documentation Lookup
- Always use **Context7 MCP** to fetch up-to-date documentation whenever querying or working with libraries, frameworks, SDKs, or APIs (React, Inertia, Laravel, Tailwind, Vite, TypeScript, Lucide, etc.).
- Follow standard Context7 workflow: `resolve-library-id` followed by `query-docs`.

### RTK CLI Tooling (Mandatory for Git and CLI operations)
- For every git command and CLI operation where RTK is supported, **MUST use `rtk`** as the command prefix:
  - Git operations: use `rtk git status`, `rtk git diff`, `rtk git log`, `rtk git add`, `rtk git commit`, `rtk git push`, `rtk git branch`, etc., instead of bare `git`.
  - Directory & file inspection: prefer `rtk ls`, `rtk tree`, `rtk read`, `rtk grep` / `rtk rg`.
  - PHP & Artisan: use `rtk php artisan ...` when executing PHP/Artisan tasks.
  - NPM / NPX: use `rtk npm ...` and `rtk npx ...`.
- This ensures token efficiency and optimal CLI output parsing across the workspace.
