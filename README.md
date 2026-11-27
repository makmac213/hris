# Halden HRIS prototype

A clickable prototype of the HRIS: employee management, timekeeping and Philippine payroll with overtime and correction requests. Built in Next.js (App Router) on in-memory mock data shaped like the planned Supabase schema.

**Docs:** all planning and documentation lives in [`docs/`](docs/README.md): the roadmap, architecture, design system, design critique, payroll rules with sources, and one page per module.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
npm run build          # production build and type check
npm run preview:build  # builds dist/preview/index.html, a single-file version you can share
```

Use **Prototype: view as** at the bottom of the sidebar to switch roles: Marisol (admin), Leah (HR), Priya (manager), Miguel (employee) and Paolo (employee on a half-day shift).
