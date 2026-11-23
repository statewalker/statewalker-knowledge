---
"@statewalker/notebook-build": minor
---

`jsx` and `tsx` fences are code cells. They are compiled with sucrase (types erased, JSX to `react/jsx-runtime`), React is resolved through the module server like any npm import, and a cell whose value is a React element, or a React element passed to `display`, is rendered with `react-dom/client`. The cache artifact keeps the two modes as `text/jsx`/`text/tsx` scripts.
