# tablecn source attribution

Source: https://github.com/sadmann7/tablecn
Revision: `f93eb975d15733e7cb086d0282b76274089f44a6` (local upstream checkout).

Adapted source files:
- `src/registry/bases/radix/ui/table.tsx` → `apps/web/components/ui/table.tsx`
- `src/registry/bases/radix/components/data-table/data-table.tsx` → bookmark table rendering
- `src/registry/bases/radix/components/data-table/data-table-column-header.tsx` → local column header
- `src/registry/bases/radix/components/data-table/data-table-view-options.tsx` → local view options
- `src/registry/bases/radix/ui/sortable.tsx` → local horizontal sortable header

Adaptations: TanStack Table v8 controlled state rather than upstream v9 subscriptions;
existing shadcn/Radix primitives and Lucide icons; a dropdown column chooser;
loaded-row-only sorting; device-local preferences; keyboard resize and move menus;
bookmark selection and existing per-row actions. Only these pieces are imported,
not the upstream application, URL-state, filters, pagination, or server dependencies.

# MIT License

Copyright (c) 2024 Sadman Sakib

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
