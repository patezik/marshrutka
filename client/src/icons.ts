// Инлайновые SVG-иконки для интерфейса (вместо эмодзи — одинаково везде).
const svg = (body: string, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  coin: svg('<circle cx="12" cy="12" r="8.5" fill="currentColor" fill-opacity=".18"/><path d="M12 7.5v9M9.5 9.5h4a1.8 1.8 0 0 1 0 3.6h-3a1.8 1.8 0 0 0 0 3.6h4"/>'),
  fuel: svg('<path d="M4 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15M3 20h12M14 9h2.5a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 3 0V8l-3-3"/><path d="M6.5 7.5h5v4h-5z" fill="currentColor" fill-opacity=".25"/>'),
  key: svg('<circle cx="8" cy="14" r="4"/><path d="M11 11l8-8M16 6l2 2M14 8l2 2"/>'),
  camera: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.5-3h5L16 7"/><circle cx="12" cy="13.5" r="3.5"/>'),
  angry: svg('<circle cx="12" cy="12" r="9"/><path d="M8 9l2.5 1.2M16 9l-2.5 1.2M8.5 16.5c2-1.6 5-1.6 7 0"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  brain: svg('<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>'),
  fall: svg('<circle cx="15" cy="5" r="2"/><path d="M13 8l-4 4 3 2-2 6M9 12l-5 1M12 14l5-1 2 4"/>'),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="currentColor" fill-opacity=".2"/>'),
  play: svg('<path d="M7 5l12 7-12 7z" fill="currentColor"/>'),
  home: svg('<path d="M3 11l9-7 9 7M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>'),
  seat: svg('<path d="M7 3v10h10M7 13l-1 8M17 13v8M9 13V7"/>'),
  speed: svg('<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/>'),
  stand: svg('<circle cx="12" cy="4.5" r="2"/><path d="M12 7v8M12 15l-3 6M12 15l3 6M8 10h8M12 2v0"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/>'),
  tree: svg('<path d="M12 3l6 9h-3l4 6H5l4-6H6z" fill="currentColor" fill-opacity=".25"/><path d="M12 18v3"/>'),
  calc: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><rect x="8" y="6" width="8" height="4" fill="currentColor" fill-opacity=".3"/><path d="M8.5 14h.01M12 14h.01M15.5 14h.01M8.5 17.5h.01M12 17.5h.01M15.5 17.5h.01"/>'),
  spring: svg('<path d="M6 4h12M6 20h12M8 4l8 3-8 3 8 3-8 3 8 3"/>'),
  engine: svg('<path d="M4 10h3l2-3h5l2 3h3v7h-3l-2 2H9l-2-2H4z"/><path d="M11 10l-1 3h3l-1 3"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
};
